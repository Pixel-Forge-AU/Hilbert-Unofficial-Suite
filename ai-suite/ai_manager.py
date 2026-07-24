#!/usr/bin/env python3
import argparse
import os
import signal
import shlex
import shutil
import subprocess
import sys
import time
import urllib.request
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
        "CHAT_HOST": "0.0.0.0",
        "CHAT_PORT": "39004",
        "STUDIO_HOST": "127.0.0.1",
        "STUDIO_PORT": "39000",
        "PLAYWRIGHT_HOST": "127.0.0.1",
        "PLAYWRIGHT_PORT": "39005",
        "PLANNER_DIR": str(ROOT / "planner-pipeline"),
        "PLANNER_HOST": "127.0.0.1",
        "PLANNER_PORT": "39006",
        "ORCHESTRATOR_DIR": str(ROOT / "implementation-orchestrator"),
        "ORCHESTRATOR_HOST": "127.0.0.1",
        "ORCHESTRATOR_PORT": "39007",
        "GENESIS_DIR": str(ROOT / "genesis-runtime"),
        "GENESIS_HOST": "0.0.0.0",
        "GENESIS_PORT": "39008",
        "OPENHANDS_DIR": str(ROOT / "open-hands"),
        "OPENHANDS_HOST": "0.0.0.0",
        "OPENHANDS_PORT": "39009",
        "OPENHANDS_SESSION_API_KEY": "",
        "HSA_OVERRIDE_GFX_VERSION": "",
    }
    if CONFIG.exists():
        for line in CONFIG.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            config[key.strip()] = value.strip()
    return config


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


def llama_server_pids_for_port(port):
    try:
        result = subprocess.run(
            ["ps", "-eo", "pid,args"],
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=8,
        )
    except Exception:
        return []
    pids = []
    needle = f"--port {port}"
    for line in result.stdout.splitlines():
        if "llama-server" not in line or needle not in line:
            continue
        try:
            pids.append(int(line.strip().split(None, 1)[0]))
        except Exception:
            continue
    return pids


def stop_llama(config, quiet=False):
    stop("llama", quiet=True)
    stopped_orphans = False
    for pid in llama_server_pids_for_port(config.get("LLAMA_PORT", "39001")):
        if not is_running(pid):
            continue
        try:
            os.kill(pid, signal.SIGTERM)
            stopped_orphans = True
        except ProcessLookupError:
            continue
        except PermissionError:
            os.kill(pid, signal.SIGTERM)
            stopped_orphans = True
    deadline = time.time() + 15
    while time.time() < deadline:
        live = [pid for pid in llama_server_pids_for_port(config.get("LLAMA_PORT", "39001")) if is_running(pid)]
        if not live:
            break
        time.sleep(0.5)
    for pid in llama_server_pids_for_port(config.get("LLAMA_PORT", "39001")):
        if not is_running(pid):
            continue
        try:
            os.kill(pid, signal.SIGKILL)
            stopped_orphans = True
        except ProcessLookupError:
            continue
    if not quiet:
        print("llama stopped" if stopped_orphans else "llama already stopped")


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


def start_llama(config, profile_name="qwen"):
    stop("comfyui", quiet=True)
    if is_running(read_pid("llama")):
        print("llama already running")
        return

    profile = llama_profile(config, profile_name)
    model = Path(profile["model"])

    llama_cpp = Path(config.get("LLAMA_CPP_DIR", ROOT / "repos/llama.cpp"))
    exe = llama_cpp / "build-vulkan/bin/llama-server"
    cmd = [
        str(exe),
        "--host", config["LLAMA_HOST"],
        "--port", config["LLAMA_PORT"],
        "--ctx-size", profile["ctx"],
        "--n-gpu-layers", profile["gpu_layers"],
        "--alias", profile["alias"],
        "--jinja",
    ]
    if profile.get("extra_args", "").strip():
        cmd.extend(shlex.split(profile["extra_args"]))
    if model.exists():
        cmd.extend(["--model", str(model)])
    elif profile["hf_repo"]:
        cmd.extend(["--hf-repo", profile["hf_repo"]])
    else:
        raise SystemExit(f"Missing model shard: {model}")

    start_process("llama", cmd, llama_cpp, base_env(config))
    url = f"http://{config['LLAMA_HOST']}:{config['LLAMA_PORT']}/health"
    print(f"llama starting ({profile['label']}): {url}")
    if not model.exists() and profile["hf_repo"]:
        print(f"using Hugging Face repo: {profile['hf_repo']}")
    wait_http(url)


def start_qwen_sidecar(config):
    """Start an LLM instance that is not stopped by the ComfyUI switch."""
    service_name = "qwen-sidecar"
    if is_running(read_pid(service_name)):
        print(f"{service_name} already running")
        return

    model = Path(config["QWEN_SIDECAR_MODEL"])
    hf_repo = config.get("QWEN_SIDECAR_HF_REPO", "")
    llama_cpp = Path(config.get("LLAMA_CPP_DIR", ROOT / "repos/llama.cpp"))
    exe = llama_cpp / "build-vulkan/bin/llama-server"
    cmd = [
        str(exe),
        "--host", config.get("QWEN_SIDECAR_HOST", "127.0.0.1"),
        "--port", config.get("QWEN_SIDECAR_PORT", "39002"),
        "--ctx-size", config.get("QWEN_SIDECAR_CTX", "32768"),
        "--n-gpu-layers", config.get("QWEN_SIDECAR_GPU_LAYERS", "0"),
        "--alias", config.get("QWEN_SIDECAR_ALIAS", "qwen-sidecar"),
        "--jinja",
    ]
    if config.get("QWEN_SIDECAR_EXTRA_ARGS", "").strip():
        cmd.extend(shlex.split(config["QWEN_SIDECAR_EXTRA_ARGS"]))
    reasoning = config.get("QWEN_SIDECAR_REASONING", "off").strip().lower()
    if reasoning in ("on", "off", "auto"):
        cmd.extend(["--reasoning", reasoning])
    if model.exists():
        cmd.extend(["--model", str(model)])
    elif hf_repo:
        cmd.extend(["--hf-repo", hf_repo])
    else:
        raise SystemExit(f"Missing sidecar model: {model}")

    start_process(service_name, cmd, llama_cpp, base_env(config))
    url = f"http://{config.get('QWEN_SIDECAR_HOST', '127.0.0.1')}:{config.get('QWEN_SIDECAR_PORT', '39002')}/health"
    print(f"{service_name} starting: {url}")
    if not model.exists() and hf_repo:
        print(f"using Hugging Face repo: {hf_repo}")
    wait_http(url)


def ollama_base_url(config):
    host = config.get("OLLAMA_HOST", "127.0.0.1")
    if host in ("0.0.0.0", "::"):
        host = "127.0.0.1"
    return f"http://{host}:{config.get('OLLAMA_PORT', '11434')}"


def ollama_available(config):
    try:
        with urllib.request.urlopen(f"{ollama_base_url(config)}/api/version", timeout=2) as response:
            return response.status == 200
    except Exception:
        return False


def start_ollama(config):
    if not Path("/usr/local/bin/ollama").exists() and not shutil.which("ollama"):
        raise SystemExit("ollama is not installed")
    if ollama_available(config):
        print(f"ollama already running: {ollama_base_url(config)}")
        return

    code = subprocess.run(["systemctl", "start", "ollama"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=15).returncode
    if code != 0:
        result = subprocess.run(["sudo", "-n", "systemctl", "start", "ollama"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=15)
        if result.returncode != 0:
            print(result.stdout.strip() or "Could not start ollama. Run: sudo systemctl start ollama")
            return

    print(f"ollama starting: {ollama_base_url(config)}")
    wait_http(f"{ollama_base_url(config)}/api/version", timeout=20)


def stop_ollama():
    result = subprocess.run(["systemctl", "stop", "ollama"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=15)
    if result.returncode != 0:
        result = subprocess.run(["sudo", "-n", "systemctl", "stop", "ollama"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=15)
    print(result.stdout.strip() or ("ollama stopped" if result.returncode == 0 else "Could not stop ollama. Run: sudo systemctl stop ollama"))


def start_comfy(config):
    stop_llama(config, quiet=True)
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
        start_ollama(config)
        llama_host = "127.0.0.1"
        llama_port = config.get("OLLAMA_PORT", "11434")
        model_alias = config.get("OLLAMA_MODEL", "qwen3:0.6b")
    elif profile_name == "sidecar" or (
        profile_name == "qwen"
        and is_running(read_pid("qwen-sidecar"))
        and not is_running(read_pid("llama"))
    ):
        llama_host = "127.0.0.1"
        llama_port = config.get("QWEN_SIDECAR_PORT", "39002")
        model_alias = config.get("QWEN_SIDECAR_ALIAS", "qwen-sidecar")
    else:
        profile = llama_profile(config, profile_name)
        llama_host = "127.0.0.1"
        llama_port = config["LLAMA_PORT"]
        model_alias = profile["alias"]

    cmd = [
        "/usr/bin/python3",
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
        "--port", config.get("STUDIO_PORT", "8000"),
    ]
    start_process("studio", cmd, ROOT, base_env(config))
    url = f"http://{config.get('STUDIO_HOST', '127.0.0.1')}:{config.get('STUDIO_PORT', '8000')}/"
    print(f"AI Suite V2 studio starting: {url}")
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


def node_env(config, project_env_file):
    env = base_env(config)
    env.update(read_env_file(project_env_file))
    return env


def docker_compose(cwd, args):
    try:
        result = subprocess.run(
            ["docker", "compose", *args],
            cwd=str(cwd),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=60,
        )
        if result.stdout.strip():
            print(result.stdout.strip())
        return result.returncode == 0
    except Exception as exc:
        print(f"docker compose {' '.join(args)} failed in {cwd}: {exc}")
        return False


PNPM = "pnpm@9.15.9"  # pinned version both planner-pipeline and implementation-orchestrator declare


def pnpm_run(cwd, script, env=None, timeout=600):
    cmd = ["npx", "--yes", PNPM, *script.split()]
    return subprocess.run(cmd, cwd=str(cwd), env=env, timeout=timeout).returncode == 0


def start_planner(config):
    if is_running(read_pid("planner-api")) or is_running(read_pid("planner-worker")):
        print("planner already running")
        return
    planner_dir = Path(config.get("PLANNER_DIR", ROOT / "planner-pipeline"))
    docker_compose(planner_dir, ["up", "-d", "postgres", "redis"])
    env = node_env(config, planner_dir / ".env")
    env["PORT"] = config.get("PLANNER_PORT", "39006")
    # planner-pipeline has no build step (tsconfig noEmit:true) - it's tsx-run by design.
    tsx = str(planner_dir / "node_modules/.bin/tsx")
    start_process("planner-api", [tsx, "src/server.ts"], planner_dir / "apps/api", env)
    start_process("planner-worker", [tsx, "src/worker.ts"], planner_dir / "apps/worker", env)
    url = f"http://{config.get('PLANNER_HOST', '127.0.0.1')}:{config.get('PLANNER_PORT', '39006')}/health"
    print(f"planner starting: {url}")
    wait_http(url)


def stop_planner(config):
    stop("planner-api", quiet=True)
    stop("planner-worker", quiet=True)
    planner_dir = Path(config.get("PLANNER_DIR", ROOT / "planner-pipeline"))
    docker_compose(planner_dir, ["stop", "postgres", "redis"])
    print("planner stopped")


def planner_setup(config):
    planner_dir = Path(config.get("PLANNER_DIR", ROOT / "planner-pipeline"))
    docker_compose(planner_dir, ["up", "-d", "postgres", "redis"])
    print("waiting for postgres to accept connections...")
    time.sleep(5)
    env = node_env(config, planner_dir / ".env")
    for label, script in (("db:generate", "db:generate"), ("db:deploy (apply migrations)", "db:deploy")):
        print(f"planner {label}...")
        if not pnpm_run(planner_dir, script, env=env):
            print(f"planner {label} failed")
            return
    print("planner setup complete - start it with: ai-switch planner")


def start_orchestrator(config):
    if is_running(read_pid("orchestrator-api")) or is_running(read_pid("orchestrator-worker")):
        print("orchestrator already running")
        return
    orch_dir = Path(config.get("ORCHESTRATOR_DIR", ROOT / "implementation-orchestrator"))
    docker_compose(orch_dir, ["up", "-d", "postgres", "redis"])
    env = node_env(config, orch_dir / ".env")
    env["PORT"] = config.get("ORCHESTRATOR_PORT", "39007")
    node = shutil.which("node") or "node"
    start_process("orchestrator-api", [node, "dist/server.js"], orch_dir / "apps/api", env)
    start_process("orchestrator-worker", [node, "dist/worker.js"], orch_dir / "apps/worker", env)
    url = f"http://{config.get('ORCHESTRATOR_HOST', '127.0.0.1')}:{config.get('ORCHESTRATOR_PORT', '39007')}/health"
    print(f"orchestrator starting: {url}")
    wait_http(url)


def stop_orchestrator(config):
    stop("orchestrator-api", quiet=True)
    stop("orchestrator-worker", quiet=True)
    orch_dir = Path(config.get("ORCHESTRATOR_DIR", ROOT / "implementation-orchestrator"))
    docker_compose(orch_dir, ["stop", "postgres", "redis"])
    print("orchestrator stopped")


def orchestrator_setup(config):
    orch_dir = Path(config.get("ORCHESTRATOR_DIR", ROOT / "implementation-orchestrator"))
    docker_compose(orch_dir, ["up", "-d", "postgres", "redis"])
    print("waiting for postgres to accept connections...")
    time.sleep(5)
    env = node_env(config, orch_dir / ".env")
    if not pnpm_run(orch_dir, "build", env=env):
        print("orchestrator build failed")
        return
    for label, script in (("db:generate", "db:generate"), ("db:migrate (apply migrations)", "db:migrate")):
        print(f"orchestrator {label}...")
        if not pnpm_run(orch_dir, script, env=env):
            print(f"orchestrator {label} failed")
            return
    print("orchestrator setup complete - start it with: ai-switch orchestrator")


def start_genesis(config):
    if is_running(read_pid("genesis-runtime")):
        print("genesis already running")
        return
    genesis_dir = Path(config.get("GENESIS_DIR", ROOT / "genesis-runtime"))
    env = base_env(config)
    env["PORT"] = config.get("GENESIS_PORT", "39008")
    node = shutil.which("node") or "node"
    start_process("genesis-runtime", [node, "server.js"], genesis_dir, env)
    url = f"http://{config.get('GENESIS_HOST', '0.0.0.0')}:{config.get('GENESIS_PORT', '39008')}/api/health"
    print(f"genesis starting: {url}")
    wait_http(url)


def stop_genesis(config):
    stop("genesis-runtime")


def start_openhands(config):
    if is_running(read_pid("openhands")):
        print("openhands already running")
        return
    openhands_dir = Path(config.get("OPENHANDS_DIR", ROOT / "open-hands"))
    agent_server = openhands_dir / ".venv/bin/agent-server"
    if not agent_server.exists():
        print(f"openhands: {agent_server} not found - run `uv sync` in {openhands_dir} first")
        return
    env = base_env(config)
    session_key = config.get("OPENHANDS_SESSION_API_KEY", "")
    if session_key:
        env["SESSION_API_KEY"] = session_key
    cmd = [
        str(agent_server),
        "--host", config.get("OPENHANDS_HOST", "0.0.0.0"),
        "--port", config.get("OPENHANDS_PORT", "39009"),
    ]
    start_process("openhands", cmd, openhands_dir, env)
    url = f"http://{config.get('OPENHANDS_HOST', '0.0.0.0')}:{config.get('OPENHANDS_PORT', '39009')}/health"
    print(f"openhands starting: {url}")
    wait_http(url)


def stop_openhands(config):
    stop("openhands")


def start_health_monitor(config):
    if is_running(read_pid("health-monitor")):
        print("health-monitor already running")
        return
    cmd = ["/usr/bin/python3", str(ROOT / "ai_manager.py"), "monitor-run"]
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
    print(status_text("llama"))
    print(status_text("qwen-sidecar"))
    print(systemd_service_text("ollama"))
    print(status_text("comfyui"))
    print(status_text("hilbert-chat"))
    print(status_text("studio"))
    print(status_text("playwright"))
    print(status_text("health-monitor"))
    print(display_safety_text())
    print()
    print("Endpoints:")
    print(f"  llama:  http://{config['LLAMA_HOST']}:{config['LLAMA_PORT']}")
    print(f"  qwen-sidecar: http://{config.get('QWEN_SIDECAR_HOST', '127.0.0.1')}:{config.get('QWEN_SIDECAR_PORT', '39002')}")
    print(f"  ollama: http://{config.get('OLLAMA_HOST', '127.0.0.1')}:{config.get('OLLAMA_PORT', '11434')} ({config.get('OLLAMA_MODEL', 'qwen3:0.6b')})")
    print(f"  comfy:  http://{config['COMFY_HOST']}:{config['COMFY_PORT']}")
    print(f"  chat:   http://{config['CHAT_HOST']}:{config['CHAT_PORT']}")
    print(f"  studio: http://{config.get('STUDIO_HOST', '127.0.0.1')}:{config.get('STUDIO_PORT', '8000')}")
    print(f"  browser: http://{config.get('PLAYWRIGHT_HOST', '127.0.0.1')}:{config.get('PLAYWRIGHT_PORT', '39005')}")
    print(f"  planner: http://{config.get('PLANNER_HOST', '127.0.0.1')}:{config.get('PLANNER_PORT', '39006')} (docs at /docs)")
    print(f"  orchestrator: http://{config.get('ORCHESTRATOR_HOST', '127.0.0.1')}:{config.get('ORCHESTRATOR_PORT', '39007')}")
    print(f"  genesis: http://{config.get('GENESIS_HOST', '0.0.0.0')}:{config.get('GENESIS_PORT', '39008')}")
    print(f"  openhands: http://{config.get('OPENHANDS_HOST', '0.0.0.0')}:{config.get('OPENHANDS_PORT', '39009')}")
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


def main(argv=None):
    parser = argparse.ArgumentParser(description="Switch between llama.cpp Vulkan, Hilbert Chat, and ComfyUI ROCm.")
    parser.add_argument(
        "command",
        choices=[
            "llama",
            "llama-restart",
            "llama-heretic",
            "llama-heretic-restart",
            "llama-small",
            "qwen-sidecar",
            "qwen-sidecar-stop",
            "ollama",
            "ollama-stop",
            "ollama-restart",
            "chat",
            "chat-sidecar",
            "chat-ollama",
            "studio",
            "playwright",
            "planner",
            "planner-stop",
            "planner-setup",
            "orchestrator",
            "orchestrator-stop",
            "orchestrator-setup",
            "genesis",
            "genesis-stop",
            "openhands",
            "openhands-stop",
            "hilbert",
            "hilbert-heretic",
            "hilbert-small",
            "hilbert-ollama",
            "comfy",
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

    if args.command == "monitor-run":
        monitor_loop()
    elif args.command == "llama":
        start_llama(config)
    elif args.command == "llama-restart":
        stop_llama(config, quiet=True)
        start_llama(config)
    elif args.command == "llama-heretic":
        start_llama(config, "heretic")
    elif args.command == "llama-heretic-restart":
        stop_llama(config, quiet=True)
        start_llama(config, "heretic")
    elif args.command == "llama-small":
        start_llama(config, "qwen-small")
    elif args.command == "qwen-sidecar":
        start_qwen_sidecar(config)
    elif args.command == "qwen-sidecar-stop":
        stop("qwen-sidecar")
    elif args.command == "ollama":
        start_ollama(config)
    elif args.command == "ollama-stop":
        stop_ollama()
    elif args.command == "ollama-restart":
        stop_ollama()
        start_ollama(config)
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
    elif args.command == "planner":
        start_planner(config)
    elif args.command == "planner-stop":
        stop_planner(config)
    elif args.command == "planner-setup":
        planner_setup(config)
    elif args.command == "orchestrator":
        start_orchestrator(config)
    elif args.command == "orchestrator-stop":
        stop_orchestrator(config)
    elif args.command == "orchestrator-setup":
        orchestrator_setup(config)
    elif args.command == "genesis":
        start_genesis(config)
    elif args.command == "genesis-stop":
        stop_genesis(config)
    elif args.command == "openhands":
        start_openhands(config)
    elif args.command == "openhands-stop":
        stop_openhands(config)
    elif args.command == "hilbert":
        start_llama(config)
        start_chat(config)
    elif args.command == "hilbert-heretic":
        start_llama(config, "heretic")
        start_chat(config, "heretic")
    elif args.command == "hilbert-small":
        start_llama(config, "qwen-small")
        start_chat(config, "qwen-small")
    elif args.command == "hilbert-ollama":
        start_ollama(config)
        start_chat(config, "ollama")
    elif args.command == "comfy":
        start_comfy(config)
    elif args.command == "stop":
        stop_llama(config, quiet=True)
        stop("qwen-sidecar", quiet=True)
        stop_ollama()
        stop("comfyui", quiet=True)
        stop("hilbert-chat", quiet=True)
        stop("studio", quiet=True)
        stop("playwright", quiet=True)
        stop_planner(config)
        stop_orchestrator(config)
        stop_genesis(config)
        stop_openhands(config)
        print("all stopped")
    elif args.command == "status":
        print(status_text("llama"))
        print(status_text("qwen-sidecar"))
        print(systemd_service_text("ollama"))
        print(status_text("comfyui"))
        print(status_text("hilbert-chat"))
        print(status_text("studio"))
        print(status_text("playwright"))
        print(status_text("planner-api"))
        print(status_text("planner-worker"))
        print(status_text("orchestrator-api"))
        print(status_text("orchestrator-worker"))
        print(status_text("genesis-runtime"))
        print(status_text("openhands"))
        print(status_text("health-monitor"))
        print(display_safety_text())
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
