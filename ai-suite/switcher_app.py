#!/usr/bin/env python3
import json
import subprocess
import tkinter as tk
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path
from tkinter import font, ttk

from ai_manager import ROOT, load_config


class Switcher(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("AI Suite V2 Switcher")
        self.geometry("820x640")
        self.minsize(720, 540)
        self.config_data = load_config()
        self.output = tk.StringVar(value="Ready.")
        self.display_safety = tk.StringVar(value="Display Safety: checking")
        self.display_safety_detail = tk.StringVar(value="")
        self.build_ui()
        self.refresh_status()
        self.refresh_display_safety()

    def build_ui(self):
        self.style = ttk.Style(self)
        self.style.configure("Title.TLabel", font=("Sans", 18, "bold"))
        self.style.configure("Section.TLabelframe", padding=10)
        self.style.configure("Section.TLabelframe.Label", font=("Sans", 10, "bold"))
        self.style.configure("Status.TLabel", padding=(8, 3))
        self.style.configure("Accent.TButton", padding=(8, 5))

        self.columnconfigure(0, weight=1)
        self.rowconfigure(6, weight=1)

        header = ttk.Frame(self, padding=16)
        header.grid(row=0, column=0, sticky="ew")
        header.columnconfigure(0, weight=1)
        ttk.Label(header, text="AI Suite V2 Switcher", style="Title.TLabel").grid(row=0, column=0, sticky="w")
        ttk.Label(header, text="Run one GPU-heavy stack at a time from /home/hilbert/ai-suite-v2.").grid(row=1, column=0, sticky="w")
        ttk.Label(header, textvariable=self.display_safety, style="Status.TLabel").grid(row=0, column=1, sticky="e")

        services = ttk.LabelFrame(self, text="Services", padding=10, style="Section.TLabelframe")
        services.grid(row=1, column=0, sticky="ew", padx=16, pady=(0, 8))
        for idx in range(10):
            services.columnconfigure(idx, weight=1)

        ttk.Button(services, text="Coding LLM", command=lambda: self.run("llama"), style="Accent.TButton").grid(row=0, column=0, sticky="ew", padx=4)
        ttk.Button(services, text="Heretic LLM", command=lambda: self.run("llama-heretic")).grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(services, text="ComfyUI", command=lambda: self.run("comfy")).grid(row=0, column=2, sticky="ew", padx=4)
        ttk.Button(services, text="Studio", command=lambda: self.run("studio")).grid(row=0, column=3, sticky="ew", padx=4)
        ttk.Button(services, text="Browser", command=lambda: self.run("playwright")).grid(row=0, column=4, sticky="ew", padx=4)
        ttk.Button(services, text="Chat", command=lambda: self.run("chat")).grid(row=0, column=5, sticky="ew", padx=4)
        ttk.Button(services, text="Ollama", command=lambda: self.run("ollama")).grid(row=0, column=6, sticky="ew", padx=4)
        ttk.Button(services, text="Stop All", command=lambda: self.run("stop")).grid(row=0, column=7, sticky="ew", padx=4)
        ttk.Button(services, text="Status", command=self.refresh_status).grid(row=0, column=8, sticky="ew", padx=4)
        ttk.Button(services, text="Diagnostics", command=lambda: self.run("diag")).grid(row=0, column=9, sticky="ew", padx=4)

        links = ttk.LabelFrame(self, text="Open & Monitor", padding=10, style="Section.TLabelframe")
        links.grid(row=2, column=0, sticky="new", padx=16, pady=(0, 8))
        for idx in range(10):
            links.columnconfigure(idx, weight=1)
        ttk.Button(links, text="Open LLM API", command=self.open_llama).grid(row=0, column=0, sticky="ew", padx=4)
        ttk.Button(links, text="Open ComfyUI", command=self.open_comfy).grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(links, text="Open Studio", command=self.open_studio).grid(row=0, column=2, sticky="ew", padx=4)
        ttk.Button(links, text="Open Chat", command=self.open_chat).grid(row=0, column=3, sticky="ew", padx=4)
        ttk.Button(links, text="Open Ollama API", command=self.open_ollama).grid(row=0, column=4, sticky="ew", padx=4)
        ttk.Button(links, text="Open Browser API", command=self.open_playwright).grid(row=0, column=5, sticky="ew", padx=4)
        ttk.Button(links, text="Start Monitor", command=lambda: self.run("monitor-start")).grid(row=0, column=6, sticky="ew", padx=4)
        ttk.Button(links, text="Stop Monitor", command=lambda: self.run("monitor-stop")).grid(row=0, column=7, sticky="ew", padx=4)
        ttk.Button(links, text="Health", command=lambda: self.run("health")).grid(row=0, column=8, sticky="ew", padx=4)
        ttk.Button(links, text="Open Health Log", command=self.open_health_log).grid(row=0, column=9, sticky="ew", padx=4)

        pipeline = ttk.LabelFrame(self, text="AI Build Pipeline", padding=10, style="Section.TLabelframe")
        pipeline.grid(row=3, column=0, sticky="ew", padx=16, pady=(0, 8))
        for idx in range(9):
            pipeline.columnconfigure(idx, weight=1)
        ttk.Button(pipeline, text="Planner Setup", command=lambda: self.run("planner-setup")).grid(row=0, column=0, sticky="ew", padx=4)
        ttk.Button(pipeline, text="Planner", command=lambda: self.run("planner"), style="Accent.TButton").grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(pipeline, text="Planner Stop", command=lambda: self.run("planner-stop")).grid(row=0, column=2, sticky="ew", padx=4)
        ttk.Button(pipeline, text="Open Planner", command=self.open_planner).grid(row=0, column=3, sticky="ew", padx=4)
        ttk.Button(pipeline, text="Orchestrator Setup", command=lambda: self.run("orchestrator-setup")).grid(row=1, column=0, sticky="ew", padx=4, pady=(4, 0))
        ttk.Button(pipeline, text="Orchestrator", command=lambda: self.run("orchestrator"), style="Accent.TButton").grid(row=1, column=1, sticky="ew", padx=4, pady=(4, 0))
        ttk.Button(pipeline, text="Orchestrator Stop", command=lambda: self.run("orchestrator-stop")).grid(row=1, column=2, sticky="ew", padx=4, pady=(4, 0))
        ttk.Button(pipeline, text="Open Orchestrator", command=self.open_orchestrator).grid(row=1, column=3, sticky="ew", padx=4, pady=(4, 0))
        ttk.Button(pipeline, text="Genesis", command=lambda: self.run("genesis"), style="Accent.TButton").grid(row=1, column=4, sticky="ew", padx=4, pady=(4, 0))
        ttk.Button(pipeline, text="Genesis Stop", command=lambda: self.run("genesis-stop")).grid(row=1, column=5, sticky="ew", padx=4, pady=(4, 0))
        ttk.Button(pipeline, text="Open Genesis", command=self.open_genesis).grid(row=1, column=6, sticky="ew", padx=4, pady=(4, 0))
        ttk.Button(pipeline, text="OpenHands", command=lambda: self.run("openhands"), style="Accent.TButton").grid(row=2, column=0, sticky="ew", padx=4, pady=(4, 0))
        ttk.Button(pipeline, text="OpenHands Stop", command=lambda: self.run("openhands-stop")).grid(row=2, column=1, sticky="ew", padx=4, pady=(4, 0))
        ttk.Button(pipeline, text="Open OpenHands", command=self.open_openhands).grid(row=2, column=2, sticky="ew", padx=4, pady=(4, 0))

        safety = ttk.LabelFrame(self, text="Display Safety", padding=10, style="Section.TLabelframe")
        safety.grid(row=4, column=0, sticky="ew", padx=16, pady=(0, 8))
        safety.columnconfigure(1, weight=1)
        self.safety_button = ttk.Button(safety, text="Toggle", command=self.toggle_display_safety, style="Accent.TButton")
        self.safety_button.grid(row=0, column=0, sticky="ew", padx=(0, 10))
        ttk.Label(safety, textvariable=self.display_safety_detail).grid(row=0, column=1, sticky="w")

        performance = ttk.LabelFrame(self, text="Performance", padding=10, style="Section.TLabelframe")
        performance.grid(row=5, column=0, sticky="ew", padx=16, pady=(0, 8))
        for idx in range(5):
            performance.columnconfigure(idx, weight=1)
        ttk.Button(performance, text="Open Tuning", command=self.open_performance, style="Accent.TButton").grid(row=0, column=0, sticky="ew", padx=4)
        ttk.Button(performance, text="Tuning Status", command=self.performance_status).grid(row=0, column=1, sticky="ew", padx=4)
        ttk.Button(performance, text="Optimize Active", command=self.optimize_active_models).grid(row=0, column=2, sticky="ew", padx=4)
        ttk.Button(performance, text="Restart LLM", command=lambda: self.run("llama-restart")).grid(row=0, column=3, sticky="ew", padx=4)
        ttk.Button(performance, text="Open Config", command=self.open_config).grid(row=0, column=4, sticky="ew", padx=4)

        log_frame = ttk.Frame(self, padding=16)
        log_frame.grid(row=6, column=0, sticky="nsew")
        log_frame.columnconfigure(0, weight=1)
        log_frame.rowconfigure(0, weight=1)
        self.log = tk.Text(log_frame, wrap="word", height=18)
        self.log.configure(font=font.nametofont("TkFixedFont"), padx=10, pady=10)
        self.log.grid(row=0, column=0, sticky="nsew")
        self.log.insert("1.0", self.output.get())

    def run(self, command, update_safety=True):
        self.log.delete("1.0", "end")
        self.log.insert("end", f"Running: {command}\n")
        self.update_idletasks()
        result = subprocess.run(
            [str(ROOT / "ai-switch"), command],
            cwd=str(ROOT),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        self.log.insert("end", result.stdout)
        if update_safety:
            self.refresh_display_safety(write_log=False)
        return result.stdout

    def refresh_status(self):
        self.run("status")

    def command_output(self, command):
        result = subprocess.run(
            [str(ROOT / "ai-switch"), command],
            cwd=str(ROOT),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        return result.stdout.strip()

    def refresh_display_safety(self, write_log=False):
        status = self.command_output("display-safe-status")
        if "display-safety: on" in status:
            self.display_safety.set("Display Safety: on")
            self.display_safety_detail.set("Auto screen-off and suspend are disabled for this session.")
            self.safety_button.configure(text="Restore COSMIC Idle")
        elif "display-safety: off" in status:
            self.display_safety.set("Display Safety: off")
            self.display_safety_detail.set("COSMIC idle defaults are active.")
            self.safety_button.configure(text="Enable Safety Mode")
        else:
            self.display_safety.set("Display Safety: partial")
            self.display_safety_detail.set(status)
            self.safety_button.configure(text="Normalize Safety Mode")
        if write_log:
            self.log.delete("1.0", "end")
            self.log.insert("end", status + "\n")

    def toggle_display_safety(self):
        self.run("display-safe-toggle", update_safety=False)
        self.refresh_display_safety()

    def _browser_host(self, host):
        return "localhost" if host in ("0.0.0.0", "::") else host

    def open_llama(self):
        host = self._browser_host(self.config_data["LLAMA_HOST"])
        webbrowser.open(f"http://{host}:{self.config_data['LLAMA_PORT']}")

    def open_comfy(self):
        host = self._browser_host(self.config_data["COMFY_HOST"])
        webbrowser.open(f"http://{host}:{self.config_data['COMFY_PORT']}")

    def open_chat(self):
        host = self._browser_host(self.config_data["CHAT_HOST"])
        webbrowser.open(f"http://{host}:{self.config_data['CHAT_PORT']}")

    def open_ollama(self):
        host = self._browser_host(self.config_data.get("OLLAMA_HOST", "127.0.0.1"))
        webbrowser.open(f"http://{host}:{self.config_data.get('OLLAMA_PORT', '11434')}/api/version")

    def open_studio(self):
        host = self._browser_host(self.config_data.get("STUDIO_HOST", "127.0.0.1"))
        webbrowser.open(f"http://{host}:{self.config_data.get('STUDIO_PORT', '39000')}")

    def studio_base_url(self):
        host = self._browser_host(self.config_data.get("STUDIO_HOST", "127.0.0.1"))
        return f"http://{host}:{self.config_data.get('STUDIO_PORT', '39000')}"

    def ensure_studio(self):
        try:
            with urllib.request.urlopen(f"{self.studio_base_url()}/api/health", timeout=1.5):
                return
        except Exception:
            self.run("studio", update_safety=False)

    def open_performance(self):
        self.ensure_studio()
        webbrowser.open(f"{self.studio_base_url()}/#performance")

    def performance_api(self, path, method="GET"):
        self.ensure_studio()
        url = f"{self.studio_base_url()}{path}"
        data = b"{}" if method == "POST" else None
        request = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method=method,
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                body = response.read().decode("utf-8", errors="replace")
                try:
                    return json.dumps(json.loads(body), indent=2)
                except json.JSONDecodeError:
                    return body
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            try:
                body = json.dumps(json.loads(body), indent=2)
            except json.JSONDecodeError:
                pass
            return f"HTTP {exc.code}\n{body}"
        except Exception as exc:
            return f"Performance API failed: {exc}"

    def performance_status(self):
        self.log.delete("1.0", "end")
        self.log.insert("end", self.performance_api("/api/performance/strix-halo") + "\n")

    def optimize_active_models(self):
        self.log.delete("1.0", "end")
        self.log.insert("end", self.performance_api("/api/performance/models/optimize-active", method="POST") + "\n")

    def open_config(self):
        subprocess.Popen(["xdg-open", str(ROOT / "config.env")])

    def open_playwright(self):
        host = self._browser_host(self.config_data.get("PLAYWRIGHT_HOST", "127.0.0.1"))
        webbrowser.open(f"http://{host}:{self.config_data.get('PLAYWRIGHT_PORT', '39005')}/api/health")

    def open_health_log(self):
        subprocess.Popen(["xdg-open", str(ROOT / "logs/health-monitor.log")])

    def open_planner(self):
        host = self._browser_host(self.config_data.get("PLANNER_HOST", "127.0.0.1"))
        webbrowser.open(f"http://{host}:{self.config_data.get('PLANNER_PORT', '39006')}/docs")

    def open_orchestrator(self):
        host = self._browser_host(self.config_data.get("ORCHESTRATOR_HOST", "127.0.0.1"))
        webbrowser.open(f"http://{host}:{self.config_data.get('ORCHESTRATOR_PORT', '39007')}/health")

    def open_genesis(self):
        host = self._browser_host(self.config_data.get("GENESIS_HOST", "0.0.0.0"))
        webbrowser.open(f"http://{host}:{self.config_data.get('GENESIS_PORT', '39008')}")

    def open_openhands(self):
        host = self._browser_host(self.config_data.get("OPENHANDS_HOST", "0.0.0.0"))
        webbrowser.open(f"http://{host}:{self.config_data.get('OPENHANDS_PORT', '39009')}/docs")


if __name__ == "__main__":
    Switcher().mainloop()
