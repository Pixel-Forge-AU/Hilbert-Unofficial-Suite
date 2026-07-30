#!/usr/bin/env python3
import argparse
import base64
import json
import re
import threading
import time
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from ai_manager import ROOT, load_config


CONFIG = load_config()
ARTIFACT_DIR = Path(CONFIG.get("PLAYWRIGHT_ARTIFACT_DIR", ROOT / "playwright-artifacts"))
DEFAULT_TIMEOUT_MS = 30000
MAX_TEXT_CHARS = 40000
MAX_LINKS = 80


def browser_host(host):
    return "127.0.0.1" if host in ("0.0.0.0", "::") else host


def json_response(handler, payload, status=200):
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def text_response(handler, text, status=200, content_type="text/plain"):
    data = text.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def read_json(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def require_url(value):
    url = (value or "").strip()
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise ValueError("url must be an absolute http(s) URL")
    return url


def clean_text(text):
    return re.sub(r"\s+", " ", text or "").strip()


def truncate(text, limit=MAX_TEXT_CHARS):
    text = text or ""
    return text if len(text) <= limit else text[:limit] + "\n...[truncated]"


def artifact_url(filename):
    return "/artifacts/" + urllib.parse.quote(filename)


class BrowserSession:
    def __init__(self):
        self.lock = threading.Lock()
        self.playwright = None
        self.browser = None
        self.error = None

    def start(self):
        if self.browser:
            return
        try:
            from playwright.sync_api import sync_playwright

            self.playwright = sync_playwright().start()
            self.browser = self.playwright.chromium.launch(headless=True)
            self.error = None
        except Exception as exc:
            self.error = str(exc)
            self.stop()
            raise

    def stop(self):
        try:
            if self.browser:
                self.browser.close()
        finally:
            self.browser = None
        try:
            if self.playwright:
                self.playwright.stop()
        finally:
            self.playwright = None

    def page_snapshot(self, payload):
        url = require_url(payload.get("url"))
        timeout_ms = int(payload.get("timeout_ms") or DEFAULT_TIMEOUT_MS)
        wait_until = payload.get("wait_until") or "domcontentloaded"
        include_text = payload.get("text", True) is not False
        include_html = bool(payload.get("html"))
        include_links = payload.get("links", True) is not False
        screenshot = bool(payload.get("screenshot"))
        full_page = payload.get("full_page", True) is not False

        with self.lock:
            self.start()
            context = self.browser.new_context(ignore_https_errors=True)
            page = context.new_page()
            page.set_default_timeout(timeout_ms)
            try:
                response = page.goto(url, wait_until=wait_until, timeout=timeout_ms)
                try:
                    page.wait_for_load_state("networkidle", timeout=min(timeout_ms, 8000))
                except Exception:
                    pass

                result = {
                    "url": page.url,
                    "title": page.title(),
                    "status": response.status if response else None,
                }
                if include_text:
                    result["text"] = truncate(page.locator("body").inner_text(timeout=5000))
                if include_html:
                    result["html"] = truncate(page.content(), 200000)
                if include_links:
                    result["links"] = self.extract_links(page)
                if screenshot:
                    result["screenshot"] = self.take_screenshot(page, full_page)
                return result
            finally:
                context.close()

    def extract_links(self, page):
        links = page.eval_on_selector_all(
            "a[href]",
            """els => els.slice(0, 200).map(a => ({
                text: (a.innerText || a.textContent || '').trim(),
                href: a.href
            }))""",
        )
        cleaned = []
        seen = set()
        for item in links:
            href = item.get("href")
            if not href or href in seen:
                continue
            seen.add(href)
            cleaned.append({"text": clean_text(item.get("text"))[:180], "href": href})
            if len(cleaned) >= MAX_LINKS:
                break
        return cleaned

    def take_screenshot(self, page, full_page=True):
        ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
        filename = f"screenshot-{time.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:8]}.png"
        path = ARTIFACT_DIR / filename
        page.screenshot(path=str(path), full_page=full_page)
        return {"filename": filename, "path": str(path), "url": artifact_url(filename)}

    def search(self, payload):
        query = (payload.get("query") or "").strip()
        if not query:
            raise ValueError("query is required")
        limit = max(1, min(int(payload.get("limit") or 6), 20))
        url = "https://lite.duckduckgo.com/lite/?" + urllib.parse.urlencode({"q": query})

        with self.lock:
            self.start()
            context = self.browser.new_context(ignore_https_errors=True)
            browser_page = context.new_page()
            try:
                browser_page.goto(url, wait_until="domcontentloaded", timeout=DEFAULT_TIMEOUT_MS)
                results = browser_page.eval_on_selector_all(
                    "a.result-link",
                    """els => els.map(a => {
                        const row = a.closest('tr');
                        let snippet = '';
                        let next = row ? row.nextElementSibling : null;
                        while (next && !snippet) {
                            const cell = next.querySelector('.result-snippet');
                            if (cell) snippet = cell.innerText.trim();
                            next = next.nextElementSibling;
                        }
                        return { title: a.innerText.trim(), url: a.href, snippet };
                    })""",
                )
            finally:
                context.close()

        normalized = []
        for item in results:
            result_url = normalize_duckduckgo_url(item.get("url", ""))
            if not result_url:
                continue
            normalized.append(
                {
                    "title": clean_text(item.get("title")),
                    "url": result_url,
                    "snippet": clean_text(item.get("snippet")),
                }
            )
            if len(normalized) >= limit:
                break
        if normalized:
            return {"query": query, "results": normalized, "search_url": url, "backend": "playwright"}
        try:
            fallback = bing_rss_search(query, limit)
            fallback["backend"] = "bing-rss"
            return fallback
        except Exception:
            fallback = duckduckgo_http_search(query, limit)
            fallback["backend"] = "duckduckgo-http"
            return fallback


def normalize_duckduckgo_url(url):
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parsed.query)
    if "uddg" in query:
        return query["uddg"][0]
    return url


class DuckDuckGoLiteParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.results = []
        self.current = None
        self.in_link = False
        self.in_snippet = False
        self.link_text = []
        self.snippet_text = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "a" and "result-link" in attrs.get("class", ""):
            if self.current and self.current.get("title"):
                self.add_current()
            self.current = {"url": normalize_duckduckgo_url(attrs.get("href", "")), "title": "", "snippet": ""}
            self.in_link = True
            self.link_text = []
        elif tag == "td" and self.current and "result-snippet" in attrs.get("class", ""):
            self.in_snippet = True
            self.snippet_text = []

    def handle_endtag(self, tag):
        if tag == "a" and self.in_link:
            if self.current:
                self.current["title"] = clean_text(" ".join(self.link_text))
            self.in_link = False
        elif tag == "td" and self.in_snippet:
            if self.current:
                self.current["snippet"] = clean_text(" ".join(self.snippet_text))
            self.in_snippet = False

    def handle_data(self, data):
        if self.in_link:
            self.link_text.append(data)
        elif self.in_snippet:
            self.snippet_text.append(data)

    def close(self):
        super().close()
        if self.current:
            self.add_current()

    def add_current(self):
        item = self.current
        self.current = None
        if item and item.get("title") and item.get("url"):
            self.results.append(item)


def duckduckgo_http_search(query, limit):
    url = "https://lite.duckduckgo.com/lite/?" + urllib.parse.urlencode({"q": query})
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 LocalPlaywright/0.1"})
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8", "replace")
    parser = DuckDuckGoLiteParser()
    parser.feed(raw)
    parser.close()
    return {"query": query, "results": parser.results[:limit], "search_url": url}


def bing_rss_search(query, limit):
    url = "https://www.bing.com/search?" + urllib.parse.urlencode({"q": query, "format": "rss"})
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 LocalPlaywright/0.1"})
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read()
    root = ET.fromstring(raw)
    results = []
    for item in root.findall("./channel/item"):
        title = clean_text(item.findtext("title"))
        link = clean_text(item.findtext("link"))
        description = clean_text(item.findtext("description"))
        if title and link:
            results.append({"title": title, "url": link, "snippet": description})
        if len(results) >= limit:
            break
    return {"query": query, "results": results, "search_url": url}


class PlaywrightHandler(BaseHTTPRequestHandler):
    server_version = "LocalPlaywright/0.1"

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path in ("/", "/api/health"):
            json_response(
                self,
                {
                    "ok": self.server.session.error is None,
                    "browser": bool(self.server.session.browser),
                    "error": self.server.session.error,
                    "endpoints": ["/api/page", "/api/search", "/api/screenshot"],
                },
            )
            return
        if parsed.path.startswith("/artifacts/"):
            self.serve_artifact(parsed.path)
            return
        text_response(self, "Not found", 404)

    def do_POST(self):
        try:
            payload = read_json(self)
            if self.path == "/api/page":
                json_response(self, self.server.session.page_snapshot(payload))
                return
            if self.path == "/api/screenshot":
                payload["screenshot"] = True
                payload.setdefault("text", False)
                payload.setdefault("links", False)
                json_response(self, self.server.session.page_snapshot(payload))
                return
            if self.path == "/api/search":
                json_response(self, self.server.session.search(payload))
                return
            text_response(self, "Not found", 404)
        except Exception as exc:
            json_response(self, {"error": str(exc)}, status=500)

    def serve_artifact(self, path):
        name = Path(urllib.parse.unquote(path.removeprefix("/artifacts/"))).name
        target = ARTIFACT_DIR / name
        if not target.exists() or not target.is_file():
            text_response(self, "Not found", 404)
            return
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, fmt, *args):
        print(f"[playwright] {self.address_string()} {fmt % args}", flush=True)


def run(host, port):
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    session = BrowserSession()
    server = HTTPServer((host, port), PlaywrightHandler)
    server.session = session
    print(f"Local Playwright server running at http://{browser_host(host)}:{port}", flush=True)
    try:
        server.serve_forever()
    finally:
        session.stop()


def main():
    parser = argparse.ArgumentParser(description="Local Playwright automation server.")
    config = load_config()
    parser.add_argument("--host", default=config.get("PLAYWRIGHT_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(config.get("PLAYWRIGHT_PORT", "39005")))
    args = parser.parse_args()
    run(args.host, args.port)


if __name__ == "__main__":
    main()
