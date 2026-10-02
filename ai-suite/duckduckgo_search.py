"""Shared DuckDuckGo Lite HTML scraping - used both as hilbert_chat.py's own
web-search fallback and as playwright_server.py's last-resort search tier.

One implementation instead of two independently-maintained copies: the two
used to have different match conditions for what counts as a result link,
and only this (the more permissive) one still matches DuckDuckGo's current
markup - the other quietly returned zero results, with nothing anywhere
raising an error on "found nothing" to ever surface that as broken.
"""

import re
import html
import urllib.parse
import urllib.request
from html.parser import HTMLParser


def clean_text(text):
    return re.sub(r"\s+", " ", html.unescape(text or "")).strip()


def normalize_duckduckgo_url(url):
    url = html.unescape(url)
    parsed = urllib.parse.urlparse(url)
    query = urllib.parse.parse_qs(parsed.query)
    if "uddg" in query:
        return query["uddg"][0]
    if url.startswith("//"):
        return "https:" + url
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
        if tag == "a" and attrs.get("href"):
            href = attrs["href"]
            css = attrs.get("class", "")
            if "result-link" in css or "/l/?" in href or "uddg=" in href or href.startswith("http"):
                if self.current and self.current.get("title"):
                    self.add_current()
                self.current = {"url": normalize_duckduckgo_url(href), "title": "", "snippet": ""}
                self.in_link = True
                self.link_text = []
        elif tag in ("td", "span") and self.current and not self.current.get("snippet"):
            css = attrs.get("class", "")
            if "result-snippet" in css or "result-snippet" in attrs.get("id", ""):
                self.in_snippet = True
                self.snippet_text = []

    def handle_endtag(self, tag):
        if tag == "a" and self.in_link:
            title = clean_text(" ".join(self.link_text))
            if self.current and title:
                self.current["title"] = title
            self.in_link = False
        elif tag in ("td", "span") and self.in_snippet:
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
        if not item or not item.get("title") or not item.get("url"):
            return
        if item["url"].startswith(("javascript:", "#")):
            return
        if any(existing["url"] == item["url"] for existing in self.results):
            return
        self.results.append(item)


def duckduckgo_http_search(query, limit=6, user_agent="Mozilla/5.0 (compatible; ai-suite)"):
    url = "https://lite.duckduckgo.com/lite/?" + urllib.parse.urlencode({"q": query})
    request = urllib.request.Request(url, headers={"User-Agent": user_agent})
    with urllib.request.urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8", "replace")
    parser = DuckDuckGoLiteParser()
    parser.feed(raw)
    parser.close()
    return {"query": query, "results": parser.results[:limit], "search_url": url}
