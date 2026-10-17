#!/usr/bin/env python3
import argparse
import os
import signal
import shutil
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / "config.env"
LOGS = ROOT / "logs"
PIDS = ROOT / ".pids"
COSMIC_IDLE_CONFIG = Path.home() / ".config/cosmic/com.system76.CosmicIdle/v1"
DISPLAY_SAFETY_KEYS = (
    "screen_off_time",
    "suspend_on_ac_time",
    "suspend_on_battery_time",
)


def load_config():
    default_repos = ROOT / "repos"
    default_models = ROOT / "models"

    config = {
        "ROOT_DIR": str(ROOT),
        "AGENT_SUITE_DIR": str(ROOT.parent / "agent-suite"),
        "REPOS_DIR": str(default_repos),
        "MODELS_DIR": str(default_models),
        "COMFYUI_DIR": str(default_repos / "ComfyUI"),
        "LLAMA_CPP_DIR": str(default_repos / "llama.cpp"),
        "CHAT_DATA_DIR": str(ROOT / "chat-data"),
        "PLAYWRIGHT_ARTIFACT_DIR": str(ROOT / "playwright-artifacts"),
        "LLAMA_HOST": "127.0.0.1",
        "LLAMA_PORT": "39001",
        "LLAMA_CTX": "65536",
        "LLAMA_GPU_LAYERS": "999",
        "LLAMA_EXTRA_ARGS": "",
        "LLAMA_MODEL": str(default_models / "qwen3-coder-next/Qwen3-Coder-Next-Q5_K_M/Qwen3-Coder-Next-Q5_K_M-00001-of-00004.gguf"),
        "LLAMA_ALIAS": "qwen3-coder-next",
        "LLAMA_HERETIC_MODEL": str(default_models / "qwen3.6-35b-a3b-heretic/Qwen3.6-35B-A3B-uncensored-heretic-Q4_K_M.gguf"),
        "LLAMA_HERETIC_HF_REPO": "llmfan46/Qwen3.6-35B-A3B-uncensored-heretic-GGUF:Q4_K_M",
        "LLAMA_HERETIC_ALIAS": "qwen3.6-35b-a3b-heretic",
        "LLAMA_HERETIC_CTX": "65536",
        "LLAMA_HERETIC_GPU_LAYERS": "999",
        "LLAMA_HERETIC_EXTRA_ARGS": "",
        "LLAMA_HERETIC27_MODEL": str(default_models / "qwen3.5-27b-heretic/Qwen3.5-27B-heretic.Q4_K_M.gguf"),
        "LLAMA_HERETIC27_HF_REPO": "mradermacher/Qwen3.5-27B-heretic-GGUF:Q4_K_M",
        "LLAMA_HERETIC27_ALIAS": "qwen3.5-27b-heretic",
        "LLAMA_HERETIC27_CTX": "65536",
        "LLAMA_HERETIC27_GPU_LAYERS": "999",
        "LLAMA_HERETIC27_EXTRA_ARGS": "",
        "LLAMA_HERETIC27_MMPROJ_MODEL": str(default_models / "qwen3.5-27b-heretic/Qwen3.5-27B-heretic.mmproj-f16.gguf"),
        "LLAMA_HERETIC27_MMPROJ_URL": "https://huggingface.co/mradermacher/Qwen3.5-27B-heretic-GGUF/resolve/main/Qwen3.5-27B-heretic.mmproj-f16.gguf",
        "OLLAMA_HOST": "127.0.0.1",
        "OLLAMA_PORT": "11434",
        "OLLAMA_MODEL": "qwen3:0.6b",
        "QWEN_SIDECAR_HOST": "127.0.0.1",
        "QWEN_SIDECAR_PORT": "39002",
        "QWEN_SIDECAR_CTX": "32768",
        "QWEN_SIDECAR_GPU_LAYERS": "0",
        "QWEN_SIDECAR_EXTRA_ARGS": "",
        "QWEN_SIDECAR_REASONING": "off",
        "QWEN_SIDECAR_MODEL": str(default_models / "qwythos-9b/Qwythos-9B-Claude-Mythos-5-1M-Q4_K_M.gguf"),
        "QWEN_SIDECAR_HF_REPO": "",
        "QWEN_SIDECAR_ALIAS": "qwen-sidecar",
        "COMFY_HOST": "127.0.0.1",
        "COMFY_PORT": "39003",
        "COMFY_MODE": "gpu",
        "COMFY_PREFLIGHT": "1",
        # Hard ceiling on ComfyUI's own memory cgroup (see start_comfy). A
        # 2026-07-27 incident: a long overnight render left ComfyUI wedged
        # for 11+ hours, thrashing 6.8GB into swap with no ceiling to stop
        # it, pegging a CPU core and making the whole machine laggy. These
        # give it as much of the box's 124G as is safe to hand over, while
        # MemorySwapMax=0 means hitting the ceiling gets it OOM-killed
        # instantly instead of swap-thrashing for hours again. Set
        # COMFY_MEMORY_MAX="" to disable the cgroup wrap entirely.
        "COMFY_MEMORY_MAX": "100G",
        "COMFY_MEMORY_HIGH": "90G",
        "COMFY_MEMORY_SWAP_MAX": "0",
        "CHAT_HOST": "0.0.0.0",
        "CHAT_PORT": "39004",
        "STUDIO_HOST": "127.0.0.1",
        "STUDIO_PORT": "39000",
        "PLAYWRIGHT_HOST": "127.0.0.1",
        "PLAYWRIGHT_PORT": "39005",
        "GPU_WORKER_DIR": str(ROOT / "gpu-worker"),
        "GPU_WORKER_HOST": "0.0.0.0",
        "GPU_WORKER_PORT": "39018",
        "GPU_WORKER_CONFIG": str(ROOT / "gpu-worker/config.yaml"),
        "REMOTE_GPU_WORKER_ENABLED": "0",
        "REMOTE_GPU_WORKER_URL": "",
        "REMOTE_GPU_MAX_VRAM_GB": "16",
        "REMOTE_GPU_FALLBACK_LOCAL": "1",
        "REMOTE_GPU_INPUT_DIR": "",
        "REMOTE_GPU_OUTPUT_DIR": "",
        "HSA_OVERRIDE_GFX_VERSION": "",
        # Workspace video editor engine (Concat, AGPL, built outside this
        # tree; see docs/WORKSPACE_VIDEO_EDITOR_PLAN.md). It listens on a Unix
        # socket inside WORKSPACE_DATA_DIR, which also holds its token and
        # the per-identity project folders.
        "CONCAT_CLI": str(Path.home() / ".local/opt/concat/bin/concat-cli"),
        "CONCAT_LIB_DIR": str(Path.home() / ".local/opt/concat/ffmpeg-8.1/lib"),
        "WORKSPACE_DATA_DIR": str(ROOT / "state/workspace"),
        # Automatic captions: whisper.cpp (MIT), built outside this tree.
        "WHISPER_CLI": str(Path.home() / ".local/opt/whisper.cpp/src/build/bin/whisper-cli"),
        "WHISPER_MODELS_DIR": str(Path.home() / ".local/opt/whisper.cpp/models"),
    }
    config.update(read_env_file(CONFIG))
    # LLM serving is owned by the agent suite (agent-switch); its config.env is the source
    # of truth for the LLM settings Studio and chat read. The defaults above are only a
    # fallback for when the agent suite isn't installed alongside.
    agent_dir = Path(config["AGENT_SUITE_DIR"])
    agent_dir = agent_dir if agent_dir.is_absolute() else (ROOT / agent_dir).resolve()
    config["AGENT_SUITE_DIR"] = str(agent_dir)
    for key, value in read_env_file(agent_dir / "config.env").items():
        if key.startswith(AGENT_CONFIG_PREFIXES):
            if key.endswith("_DIR") and value and not Path(value).is_absolute():
                value = str((agent_dir / value).resolve())
            config[key] = value
    return config


# config.env keys that live in ../agent-suite/config.env rather than this suite's own.
AGENT_CONFIG_PREFIXES = ("LLAMA_", "QWEN_SIDECAR_", "OLLAMA_", "MODELS_DIR", "CONSOLE_")


def read_env_file(path):
    values = {}
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def llama_profile(config, name):
    profiles = {
        "qwen": {
            "name": "qwen",
            "label": "Qwen3 Coder Next",
            "model": config["LLAMA_MODEL"],
            "hf_repo": "",
            "alias": config.get("LLAMA_ALIAS", "qwen3-coder-next"),
            "ctx": config["LLAMA_CTX"],
            "gpu_layers": config["LLAMA_GPU_LAYERS"],
            "extra_args": config.get("LLAMA_EXTRA_ARGS", ""),
        },
        "heretic": {
            "name": "heretic",
            "label": "Qwen3.6 35B A3B Heretic",
            "model": config["LLAMA_HERETIC_MODEL"],
            "hf_repo": config["LLAMA_HERETIC_HF_REPO"],
            "alias": config.get("LLAMA_HERETIC_ALIAS", "qwen3.6-35b-a3b-heretic"),
            "ctx": config.get("LLAMA_HERETIC_CTX", config["LLAMA_CTX"]),
            "gpu_layers": config.get("LLAMA_HERETIC_GPU_LAYERS", config["LLAMA_GPU_LAYERS"]),
            "extra_args": config.get("LLAMA_HERETIC_EXTRA_ARGS", config.get("LLAMA_EXTRA_ARGS", "")),
        },
        "heretic27": {
            "name": "heretic27",
            "label": "Qwen3.5 27B Heretic",
            "model": config["LLAMA_HERETIC27_MODEL"],
            "hf_repo": config["LLAMA_HERETIC27_HF_REPO"],
            "alias": config.get("LLAMA_HERETIC27_ALIAS", "qwen3.5-27b-heretic"),
            "ctx": config.get("LLAMA_HERETIC27_CTX", config["LLAMA_CTX"]),
            "gpu_layers": config.get("LLAMA_HERETIC27_GPU_LAYERS", config["LLAMA_GPU_LAYERS"]),
            "extra_args": config.get("LLAMA_HERETIC27_EXTRA_ARGS", config.get("LLAMA_EXTRA_ARGS", "")),
            "mmproj_model": config.get("LLAMA_HERETIC27_MMPROJ_MODEL", ""),
            "mmproj_url": config.get("LLAMA_HERETIC27_MMPROJ_URL", ""),
        },
        "qwen-small": {
            "name": "qwen-small",
            "label": "Qwen3 Coder Next (Small)",
            "model": config["LLAMA_MODEL"],
            "hf_repo": "",
            "alias": config.get("LLAMA_ALIAS", "qwen3-coder-next"),
            "ctx": "32768",  # Smaller context window for smaller model
            "gpu_layers": config["LLAMA_GPU_LAYERS"],
            "extra_args": config.get("LLAMA_EXTRA_ARGS", ""),
        },
    }
    return profiles[name]


def pid_file(name):
    return PIDS / f"{name}.pid"


def read_pid(name):
    try:
        return int(pid_file(name).read_text().strip())
    except (FileNotFoundError, ValueError):
        return None


def is_running(pid):
    if not pid:
        return False
    stat_path = Path(f"/proc/{pid}/stat")
    if stat_path.exists():
        try:
            parts = stat_path.read_text().split()
            if len(parts) > 2 and parts[2] == "Z":
                return False
        except Exception:
            pass
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def status_text(name):
    pid = read_pid(name)
    return f"{name}: running pid={pid}" if is_running(pid) else f"{name}: stopped"


def systemd_service_text(name):
    active = run_text(["systemctl", "is-active", name], timeout=3)
    enabled = run_text(["systemctl", "is-enabled", name], timeout=3)
    state = active.splitlines()[-1] if active else "unknown"
    boot = enabled.splitlines()[-1] if enabled else "unknown"
    return f"{name}: {state} ({boot})"


def run_text(command, timeout=8, env=None):
    try:
        result = subprocess.run(
            command,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            env=env,
        )
        return result.stdout.strip()
    except FileNotFoundError:
        return f"{command[0]}: not installed"
    except subprocess.TimeoutExpired:
        return f"{command[0]}: timed out"
    except Exception as exc:
        return f"{command[0]}: {exc}"


def display_safety_state():
    values = {}
    for key in DISPLAY_SAFETY_KEYS:
        path = COSMIC_IDLE_CONFIG / key
        if not path.exists():
            values[key] = None
            continue
        values[key] = path.read_text().strip()

    if all(value == "None" for value in values.values()):
        return "on", values
    if all(value is None for value in values.values()):
        return "off", values
    return "partial", values


def restart_cosmic_idle():
    result = subprocess.run(
        ["pgrep", "-x", "cosmic-idle"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    restarted = False
    for line in result.stdout.splitlines():
        try:
            os.kill(int(line), signal.SIGTERM)
            restarted = True
        except (ValueError, ProcessLookupError):
            continue

    if restarted:
        time.sleep(1)
    return restarted


def set_display_safety(enabled):
    COSMIC_IDLE_CONFIG.mkdir(parents=True, exist_ok=True)
    if enabled:
        for key in DISPLAY_SAFETY_KEYS:
            (COSMIC_IDLE_CONFIG / key).write_text("None\n")
        action = "enabled"
    else:
        for key in DISPLAY_SAFETY_KEYS:
            (COSMIC_IDLE_CONFIG / key).unlink(missing_ok=True)
        action = "disabled"

    restarted = restart_cosmic_idle()
    print(f"display safety {action}")
    print("cosmic-idle restarted" if restarted else "cosmic-idle was not running")
    print(display_safety_text())


def toggle_display_safety():
    state, _values = display_safety_state()
    set_display_safety(state != "on")


def display_safety_text():
    state, values = display_safety_state()
    if state == "on":
        return "display-safety: on (screen off: never, suspend: never)"
    if state == "off":
        return "display-safety: off (COSMIC defaults)"
    details = ", ".join(f"{key}={value if value is not None else 'default'}" for key, value in values.items())
    return f"display-safety: partial ({details})"


def wait_http(url, timeout=45):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return True
        except Exception:
            time.sleep(1)
    return False


def stop(name, quiet=False):
    pid = read_pid(name)
    if not is_running(pid):
        pid_file(name).unlink(missing_ok=True)
        if not quiet:
            print(f"{name} already stopped")
        return
    try:
        os.killpg(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    except PermissionError:
        os.kill(pid, signal.SIGTERM)
    for _ in range(30):
        if not is_running(pid):
            break
        time.sleep(0.5)
    if is_running(pid):
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError:
            os.kill(pid, signal.SIGKILL)
    pid_file(name).unlink(missing_ok=True)
    if not quiet:
        print(f"{name} stopped")


def base_env(config):
    env = os.environ.copy()
    rocm_home = Path(config.get("ROCM_HOME", "/opt/rocm-7.2.1"))
    if rocm_home.exists():
        env["ROCM_HOME"] = str(rocm_home)
        env["PATH"] = f"{rocm_home / 'bin'}:{env.get('PATH', '')}"
        env["LD_LIBRARY_PATH"] = f"{rocm_home / 'lib'}:{env.get('LD_LIBRARY_PATH', '')}"
    llama_bin = Path(config.get("LLAMA_CPP_DIR", ROOT / "repos/llama.cpp")) / "build-vulkan/bin"
    if llama_bin.exists():
        env["LD_LIBRARY_PATH"] = f"{llama_bin}:{env.get('LD_LIBRARY_PATH', '')}"
    override = config.get("HSA_OVERRIDE_GFX_VERSION", "")
    if override:
        env["HSA_OVERRIDE_GFX_VERSION"] = override
    env["COMFYUI_DIR"] = config.get("COMFYUI_DIR", str(ROOT / "repos/ComfyUI"))
    espeak_library = Path("/usr/lib/x86_64-linux-gnu/libespeak-ng.so.1")
    if espeak_library.exists():
        env.setdefault("PHONEMIZER_ESPEAK_LIBRARY", str(espeak_library))
    return env


def agent_switch(config, *args, quiet=False):
    """Run `agent-switch <args>` in the agent suite, which owns LLM serving
    (llama.cpp, qwen-sidecar, Ollama). Returns True on success."""
    switch = Path(config["AGENT_SUITE_DIR"]) / "agent-switch"
    if not switch.exists():
        if not quiet:
            print(f"agent suite not found at {switch.parent} - set AGENT_SUITE_DIR in config.env")
        return False
    output = None if not quiet else subprocess.DEVNULL
    return subprocess.run([str(switch), *args], stdout=output, stderr=output).returncode == 0


def llm_up(host, port):
    host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    try:
        with urllib.request.urlopen(f"http://{host}:{port}/health", timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def memory_cgroup_prefix(config, unit_name):
    """Build a `systemd-run --user --scope` prefix that puts the process in
    its own memory cgroup, so it can't repeat the 2026-07-27 incident where
    ComfyUI ran uncapped, filled RAM, and thrashed 6.8GB into swap for 11+
    hours straight (pegging a CPU core, no OOM-kill, nothing to recover
    from). MemorySwapMax=0 is the actual fix: hitting the ceiling now means
    an instant OOM-kill of this cgroup instead of swap-thrashing - the
    launcher's ComfyHealthMonitor picks up the resulting connection-refused
    within about a minute and marks any in-flight job "stalled" for retry.

    Returns [] (uncapped) if COMFY_MEMORY_MAX is unset/blank or systemd-run
    isn't available, so this degrades gracefully on machines without a
    delegated user cgroup (e.g. no systemd, or MemoryMax="" to opt out).
    """
    memory_max = (config.get("COMFY_MEMORY_MAX") or "").strip()
    if not memory_max or not shutil.which("systemd-run"):
        return []
    args = [
        "systemd-run", "--user", "--scope", "--quiet",
        f"--unit={unit_name}-{uuid.uuid4().hex[:8]}",
        "-p", f"MemoryMax={memory_max}",
    ]
    memory_high = (config.get("COMFY_MEMORY_HIGH") or "").strip()
    if memory_high:
        args += ["-p", f"MemoryHigh={memory_high}"]
    memory_swap_max = (config.get("COMFY_MEMORY_SWAP_MAX") or "").strip()
    if memory_swap_max:
        args += ["-p", f"MemorySwapMax={memory_swap_max}"]
    args.append("--")
    return args


def start_comfy(config):
    # The main LLM and ComfyUI can't share the GPU (the qwen-sidecar runs on CPU and stays up).
    agent_switch(config, "llama-stop", quiet=True)
    if is_running(read_pid("comfyui")):
        print("comfyui already running")
        return

    comfyui = Path(config.get("COMFYUI_DIR", ROOT / "repos/ComfyUI"))
    python = comfyui / ".venv/bin/python"
    env = base_env(config)
    comfy_mode = config.get("COMFY_MODE", "gpu").strip().lower()
    if comfy_mode not in ("gpu", "cpu"):
        raise SystemExit("COMFY_MODE must be gpu or cpu")
    if comfy_mode == "gpu" and config.get("COMFY_PREFLIGHT", "1").strip() != "0":
        ok, output = comfy_gpu_preflight(python, comfyui, env)
        if not ok:
            print("ComfyUI GPU preflight failed; not starting ComfyUI because this ROCm/PyTorch stack crashes during workflows.")
            print()
            print(output.strip() or "(no preflight output)")
            print()
            print("This machine reports AMD Radeon 8060S/gfx1151. AMD's current Radeon/Ryzen docs list Ryzen AI Max APUs under ROCm 7.2.1 PyTorch support,")
            print("but this OS currently has ROCm/HSA 5.7 packages and the ComfyUI venv is on PyTorch ROCm 6.3.")
            print("Install the ROCm 7.2.x Radeon/Ryzen runtime system-wide, then install AMD's ROCm 7.2.1 PyTorch wheels in the ComfyUI venv.")
            print("Temporary fallback: set COMFY_MODE=cpu in config.env and start ComfyUI again. It will be slow, but it should avoid the GPU segfault.")
            return

    cmd = [
        str(python),
        "main.py",
        "--listen", config["COMFY_HOST"],
        "--port", config["COMFY_PORT"],
    ]
    if comfy_mode == "cpu":
        cmd.append("--cpu")
    cmd = memory_cgroup_prefix(config, "comfyui") + cmd
    start_process("comfyui", cmd, comfyui, env)
    url = f"http://{config['COMFY_HOST']}:{config['COMFY_PORT']}/"
    print(f"comfyui starting: {url}")
    wait_http(url)


def comfy_gpu_preflight(python, cwd, env):
    script = """
import torch
print(f"torch={torch.__version__} hip={getattr(torch.version, 'hip', None)} cuda={torch.cuda.is_available()}")
if not torch.cuda.is_available():
    raise SystemExit("torch cannot see a ROCm/CUDA device")
print(f"device={torch.cuda.get_device_name(0)}")
x = torch.ones((16, 16), device="cuda", dtype=torch.float32)
y = x @ x
torch.cuda.synchronize()
print(f"kernel_ok={float(y[0, 0])}")
"""
    result = subprocess.run(
        [str(python), "-c", script],
        cwd=str(cwd),
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        timeout=30,
    )
    return result.returncode == 0, result.stdout


def start_chat(config, profile_name="qwen"):
    if is_running(read_pid("hilbert-chat")):
        print("hilbert-chat already running")
        return
    if profile_name == "ollama":
        agent_switch(config, "ollama")
        llama_host = "127.0.0.1"
        llama_port = config.get("OLLAMA_PORT", "11434")
        model_alias = config.get("OLLAMA_MODEL", "qwen3:0.6b")
    elif profile_name == "sidecar" or (
        profile_name == "qwen"
        and llm_up(config.get("QWEN_SIDECAR_HOST", "127.0.0.1"), config.get("QWEN_SIDECAR_PORT", "39002"))
        and not llm_up(config.get("LLAMA_HOST", "127.0.0.1"), config.get("LLAMA_PORT", "39001"))
    ):
        llama_host = "127.0.0.1"
        llama_port = config.get("QWEN_SIDECAR_PORT", "39002")
        model_alias = config.get("QWEN_SIDECAR_ALIAS", "qwen-sidecar")
    else:
        profile = llama_profile(config, profile_name)
        llama_host = "127.0.0.1"
        llama_port = config["LLAMA_PORT"]
        model_alias = profile["alias"]

    python = ROOT / ".venv/bin/python"
    if not python.exists():
        python = Path(sys.executable)
    cmd = [
        str(python),
        str(ROOT / "hilbert_chat.py"),
        "--host", config["CHAT_HOST"],
        "--port", config["CHAT_PORT"],
        "--llama-host", llama_host,
        "--llama-port", llama_port,
        "--model", model_alias,
        "--data-dir", config.get("CHAT_DATA_DIR", str(ROOT / "chat-data")),
    ]
    start_process("hilbert-chat", cmd, ROOT, base_env(config))
    url = f"http://{config['CHAT_HOST']}:{config['CHAT_PORT']}/"
    print(f"hilbert-chat starting: {url}")
    wait_http(url)


def start_studio(config):
    if is_running(read_pid("studio")):
        print("studio already running")
        return

    python = ROOT / ".venv/bin/python"
    if not python.exists():
        python = Path(sys.executable)
    cmd = [
        str(python),
        str(ROOT / "launcher.py"),
        "--host", config.get("STUDIO_HOST", "127.0.0.1"),
        "--port", config.get("STUDIO_PORT", "39000"),
    ]
    start_process("studio", cmd, ROOT, base_env(config))
    url = f"http://{config.get('STUDIO_HOST', '127.0.0.1')}:{config.get('STUDIO_PORT', '39000')}/"
    print(f"AI Suite studio starting: {url}")
    wait_http(url)


def start_playwright(config):
    if is_running(read_pid("playwright")):
        print("playwright already running")
        return

    python = ROOT / ".venv-playwright/bin/python"
    if not python.exists():
        python = Path(sys.executable)
    cmd = [
        str(python),
        str(ROOT / "playwright_server.py"),
        "--host", config.get("PLAYWRIGHT_HOST", "127.0.0.1"),
        "--port", config.get("PLAYWRIGHT_PORT", "39005"),
    ]
    start_process("playwright", cmd, ROOT, base_env(config))
    url = f"http://{config.get('PLAYWRIGHT_HOST', '127.0.0.1')}:{config.get('PLAYWRIGHT_PORT', '39005')}/api/health"
    print(f"playwright starting: {url}")
    wait_http(url)


def concat_token(data_dir):
    """The Workspace engine's API token: minted once, kept 0600 beside the
    socket, read by Studio, never sent to a browser or written to a log."""
    path = data_dir / "api.token"
    if not path.exists():
        import secrets
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as handle:
            handle.write(secrets.token_hex(32))
    os.chmod(path, 0o600)
    return path.read_text().strip()


def start_concat(config):
    if is_running(read_pid("concat")):
        print("concat already running")
        return
    cli = Path(config.get("CONCAT_CLI", ""))
    if not cli.is_file():
        print(f"concat-cli not found at {cli}; see docs/WORKSPACE_VIDEO_EDITOR_PLAN.md (Phase 0) to build it")
        sys.exit(1)
    data_dir = Path(config.get("WORKSPACE_DATA_DIR", ROOT / "state/workspace"))
    projects = data_dir / "projects"
    projects.mkdir(parents=True, exist_ok=True)
    os.chmod(data_dir, 0o700)
    socket_path = data_dir / "concat.sock"
    socket_path.unlink(missing_ok=True)
    env = os.environ.copy()
    env["CONCAT_API_TOKEN"] = concat_token(data_dir)
    lib_dir = config.get("CONCAT_LIB_DIR", "")
    if lib_dir:
        env["LD_LIBRARY_PATH"] = f"{lib_dir}:{env.get('LD_LIBRARY_PATH', '')}"
    # concat-cli prints its token on startup; redact that line before it
    # reaches logs/concat.log.
    cmd = [
        "/bin/sh", "-c",
        'exec "$0" serve --socket "$1" --root "$2" 2>&1 | sed -u "s/token .*/token <redacted>/"',
        str(cli), str(socket_path), str(projects),
    ]
    start_process("concat", cmd, ROOT, env)
    for _ in range(40):
        if socket_path.exists():
            print(f"concat listening on {socket_path}")
            return
        time.sleep(0.25)
    print("concat did not open its socket; see logs/concat.log")


def start_gpu_worker(config):
    if is_running(read_pid("gpu-worker")):
        print("gpu-worker already running")
        return
    worker_dir = Path(config.get("GPU_WORKER_DIR", ROOT / "gpu-worker"))
    python = worker_dir / ".venv/bin/python"
    if not python.exists():
        python = ROOT / ".venv/bin/python"
    if not python.exists():
        python = Path(sys.executable)
    env = base_env(config)
    worker_config = Path(config.get("GPU_WORKER_CONFIG", str(worker_dir / "config.yaml")))
    if not worker_config.is_absolute():
        worker_config = ROOT / worker_config
    env["GPU_WORKER_CONFIG"] = str(worker_config)
    cmd = [
        str(python),
        str(worker_dir / "worker_api.py"),
        "--host", config.get("GPU_WORKER_HOST", "0.0.0.0"),
        "--port", config.get("GPU_WORKER_PORT", "39018"),
    ]
    start_process("gpu-worker", cmd, worker_dir, env)
    url = f"http://{config.get('GPU_WORKER_HOST', '0.0.0.0')}:{config.get('GPU_WORKER_PORT', '39018')}/health"
    print(f"gpu-worker starting: {url}")
    wait_http(url)


def stop_gpu_worker(config):
    stop("gpu-worker")


def start_health_monitor(config):
    if is_running(read_pid("health-monitor")):
        print("health-monitor already running")
        return
    python = ROOT / ".venv/bin/python"
    if not python.exists():
        python = Path(sys.executable)
    cmd = [str(python), str(ROOT / "ai_manager.py"), "monitor-run"]
    start_process("health-monitor", cmd, ROOT, base_env(config))


def health_snapshot():
    sections = [
        ("uptime", ["uptime"]),
        ("memory", ["free", "-h"]),
        ("swap", ["swapon", "--show"]),
        ("disk", ["df", "-h", "/", "/boot/efi"]),
        ("top cpu", ["bash", "-lc", "ps -eo pid,ppid,stat,comm,%cpu,%mem,rss --sort=-%cpu | head -n 20"]),
        ("recent warnings", ["bash", "-lc", "journalctl -b -p warning..alert --since '10 minutes ago' --no-pager | tail -n 80"]),
    ]
    if subprocess.run(["bash", "-lc", "command -v sensors >/dev/null"], stdout=subprocess.DEVNULL).returncode == 0:
        sections.insert(4, ("sensors", ["sensors"]))

    print(f"Health snapshot: {time.strftime('%Y-%m-%d %H:%M:%S %Z')}")
    print(status_text("health-monitor"))
    print()
    for title, command in sections:
        print(f"[{title}]")
        print(run_text(command) or "(no output)")
        print()


def monitor_loop():
    patterns = (
        "oom|out of memory|killed process|amdgpu|gpu reset|ring .* timeout|drm|"
        "thermal|overheat|nvme|I/O error|watchdog|lockup|panic|segfault|"
        "core-dump|cosmic-comp|cosmic-panel"
    )
    journal = subprocess.Popen(
        ["journalctl", "-f", "-o", "short-iso", "--no-pager", "-g", patterns],
        stdout=sys.stdout,
        stderr=subprocess.STDOUT,
        text=True,
    )

    def shutdown(_signum=None, _frame=None):
        if journal.poll() is None:
            journal.terminate()
            try:
                journal.wait(timeout=3)
            except subprocess.TimeoutExpired:
                journal.kill()
        print(f"===== health monitor stopped {time.strftime('%Y-%m-%dT%H:%M:%S%z')} =====", flush=True)
        raise SystemExit(0)

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    print(f"===== health monitor started {time.strftime('%Y-%m-%dT%H:%M:%S%z')} =====", flush=True)
    while True:
        print(f"\n----- snapshot {time.strftime('%Y-%m-%dT%H:%M:%S%z')} -----", flush=True)
        for command in [
            ["uptime"],
            ["free", "-h"],
            ["swapon", "--show"],
            ["df", "-h", "/", "/boot/efi"],
            ["bash", "-lc", "command -v sensors >/dev/null && sensors || true"],
            ["bash", "-lc", "ps -eo pid,ppid,stat,comm,%cpu,%mem,rss --sort=-%cpu | head -n 20"],
        ]:
            print(run_text(command), flush=True)
        time.sleep(30)


def start_process(name, cmd, cwd, env):
    LOGS.mkdir(exist_ok=True)
    PIDS.mkdir(exist_ok=True)
    log_path = LOGS / f"{name}.log"
    log = log_path.open("ab", buffering=0)
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
        start_new_session=True,
    )
    pid_file(name).write_text(str(proc.pid))
    print(f"{name} pid={proc.pid}, log={log_path}")


def diagnostics(config):
    env = base_env(config)
    print_status(config)
    print()
    print("Endpoints:")
    print(f"  llama:  http://{config['LLAMA_HOST']}:{config['LLAMA_PORT']} (agent suite)")
    print(f"  qwen-sidecar: http://{config.get('QWEN_SIDECAR_HOST', '127.0.0.1')}:{config.get('QWEN_SIDECAR_PORT', '39002')} (agent suite)")
    print(f"  ollama: http://{config.get('OLLAMA_HOST', '127.0.0.1')}:{config.get('OLLAMA_PORT', '11434')} ({config.get('OLLAMA_MODEL', 'qwen3:0.6b')}, agent suite)")
    print(f"  comfy:  http://{config['COMFY_HOST']}:{config['COMFY_PORT']}")
    print(f"  chat:   http://{config['CHAT_HOST']}:{config['CHAT_PORT']}")
    print(f"  studio: http://{config.get('STUDIO_HOST', '127.0.0.1')}:{config.get('STUDIO_PORT', '39000')}")
    print(f"  browser: http://{config.get('PLAYWRIGHT_HOST', '127.0.0.1')}:{config.get('PLAYWRIGHT_PORT', '39005')}")
    print(f"  gpu-worker: http://{config.get('GPU_WORKER_HOST', '0.0.0.0')}:{config.get('GPU_WORKER_PORT', '39018')}")
    print()
    for label, command in [
        ("torch", [str(Path(config.get("COMFYUI_DIR", ROOT / "repos/ComfyUI")) / ".venv/bin/python"), "-c", "import torch; print(torch.__version__); print('HIP', torch.version.hip); print('GPU', torch.cuda.is_available())"]),
        ("rocminfo", ["rocminfo"]),
        ("vulkan", ["vulkaninfo", "--summary"]),
    ]:
        print(f"[{label}]")
        try:
            result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=12, env=env)
            print(result.stdout.strip() or "(no output)")
        except Exception as exc:
            print(exc)
        print()


# Commands forwarded verbatim to the agent suite's `agent-switch`, which owns LLM serving.
# Kept here so Studio, chat and the switcher can still drive the LLM the way they always have.
AGENT_COMMANDS = (
    "llama",
    "llama-restart",
    "llama-stop",
    "llama-heretic",
    "llama-heretic-restart",
    "llama-heretic27",
    "llama-heretic27-restart",
    "llama-small",
    "qwen-sidecar",
    "qwen-sidecar-stop",
    "ollama",
    "ollama-stop",
    "ollama-restart",
)

HILBERT_PROFILES = {
    "hilbert": ("llama", "qwen"),
    "hilbert-heretic": ("llama-heretic", "heretic"),
    "hilbert-heretic27": ("llama-heretic27", "heretic27"),
    "hilbert-small": ("llama-small", "qwen-small"),
    "hilbert-ollama": ("ollama", "ollama"),
}

CREATIVE_SERVICES = ("comfyui", "hilbert-chat", "studio", "playwright", "gpu-worker", "concat")


def print_status(config):
    for name in CREATIVE_SERVICES:
        print(status_text(name))
    print(status_text("health-monitor"))
    print(display_safety_text())
    llama = "up" if llm_up(config.get("LLAMA_HOST", "127.0.0.1"), config.get("LLAMA_PORT", "39001")) else "down"
    sidecar = "up" if llm_up(config.get("QWEN_SIDECAR_HOST", "127.0.0.1"), config.get("QWEN_SIDECAR_PORT", "39002")) else "down"
    print(f"llm (agent suite): llama {llama}, qwen-sidecar {sidecar} - see `agent-switch status`")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Creative suite: ComfyUI, Studio, Hilbert Chat. LLM commands are forwarded to agent-switch.")
    parser.add_argument(
        "command",
        choices=[
            *AGENT_COMMANDS,
            "chat",
            "chat-sidecar",
            "chat-ollama",
            "studio",
            "playwright",
            "gpu-worker",
            "gpu-worker-stop",
            "concat",
            "concat-stop",
            *HILBERT_PROFILES,
            "comfy",
            "comfy-stop",
            "stop",
            "status",
            "diag",
            "health",
            "monitor-start",
            "monitor-stop",
            "monitor-run",
            "display-safe-on",
            "display-safe-off",
            "display-safe-toggle",
            "display-safe-status",
        ],
    )
    args = parser.parse_args(argv)
    config = load_config()

    if args.command in AGENT_COMMANDS:
        raise SystemExit(0 if agent_switch(config, args.command) else 1)
    elif args.command in HILBERT_PROFILES:
        agent_command, chat_profile = HILBERT_PROFILES[args.command]
        agent_switch(config, agent_command)
        start_chat(config, chat_profile)
    elif args.command == "monitor-run":
        monitor_loop()
    elif args.command == "chat":
        start_chat(config)
    elif args.command == "chat-sidecar":
        start_chat(config, "sidecar")
    elif args.command == "chat-ollama":
        start_chat(config, "ollama")
    elif args.command == "studio":
        start_studio(config)
    elif args.command == "playwright":
        start_playwright(config)
    elif args.command == "gpu-worker":
        start_gpu_worker(config)
    elif args.command == "gpu-worker-stop":
        stop_gpu_worker(config)
    elif args.command == "concat":
        start_concat(config)
    elif args.command == "concat-stop":
        stop("concat")
    elif args.command == "comfy":
        start_comfy(config)
    elif args.command == "comfy-stop":
        stop("comfyui")
    elif args.command == "stop":
        for name in CREATIVE_SERVICES:
            stop(name, quiet=True)
        print("creative suite stopped (LLMs are left running - use `agent-switch stop` for those)")
    elif args.command == "status":
        print_status(config)
    elif args.command == "diag":
        diagnostics(config)
    elif args.command == "health":
        health_snapshot()
    elif args.command == "monitor-start":
        start_health_monitor(config)
    elif args.command == "monitor-stop":
        stop("health-monitor")
    elif args.command == "display-safe-on":
        set_display_safety(True)
    elif args.command == "display-safe-off":
        set_display_safety(False)
    elif args.command == "display-safe-toggle":
        toggle_display_safety()
    elif args.command == "display-safe-status":
        print(display_safety_text())


if __name__ == "__main__":
    main()
