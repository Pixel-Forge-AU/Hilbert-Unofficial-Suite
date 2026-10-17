#!/usr/bin/env python3
"""Agent Suite service manager (`agent-switch`).

Owns the runtime & automation side of the Hilbert suite: local LLM serving
(llama.cpp, the qwen sidecar, Ollama), Genesis Runtime, the planner ->
implementation-orchestrator -> OpenHands build pipeline, and its dashboard.

The creative suite (../ai-suite, `ai-switch`) consumes the LLMs started here
over HTTP. The only thing the two suites coordinate on directly is the GPU:
the main llama server and ComfyUI can't share it, so starting one stops the
other through the peer suite's CLI (`ai-switch comfy-stop` /
`agent-switch llama-stop`).
"""
import argparse
import os
import shlex
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / "config.env"
LOGS = ROOT / "logs"
PIDS = ROOT / ".pids"


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


def load_config():
    overrides = read_env_file(CONFIG)
    # Relative *_DIR values (e.g. ../ai-suite/models) are relative to this suite, not the cwd.
    for key, value in overrides.items():
        if key.endswith("_DIR") and value and not Path(value).is_absolute():
            overrides[key] = str((ROOT / value).resolve())
    default_models = Path(overrides.get("MODELS_DIR", ROOT / "models"))
    default_repos = Path(overrides.get("REPOS_DIR", ROOT / "repos"))

    config = {
        "ROOT_DIR": str(ROOT),
        "CREATIVE_SUITE_DIR": str(ROOT.parent / "ai-suite"),
        "REPOS_DIR": str(default_repos),
        "MODELS_DIR": str(default_models),
        "LLAMA_CPP_DIR": str(default_repos / "llama.cpp"),
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
        "OPENHANDS_VSCODE_PORT": "39017",
        "DASHBOARD_HOST": "127.0.0.1",
        "DASHBOARD_PORT": "39016",
        "CONSOLE_HOST": "0.0.0.0",
        "CONSOLE_PORT": "39019",
        "HSA_OVERRIDE_GFX_VERSION": "",
    }
    config.update(overrides)
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


# ---------------------------------------------------------------------------
# Process helpers
# ---------------------------------------------------------------------------

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


def systemd_service_text(name):
    active = run_text(["systemctl", "is-active", name], timeout=3)
    enabled = run_text(["systemctl", "is-enabled", name], timeout=3)
    state = active.splitlines()[-1] if active else "unknown"
    boot = enabled.splitlines()[-1] if enabled else "unknown"
    return f"{name}: {state} ({boot})"


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
    return env


def creative_switch(config, command):
    """Run a command on the creative suite's `ai-switch`, if it's installed
    alongside. Used only for GPU hand-off (stopping ComfyUI before llama)."""
    switch = Path(config.get("CREATIVE_SUITE_DIR", ROOT.parent / "ai-suite")) / "ai-switch"
    if not switch.exists():
        return
    subprocess.run([str(switch), command], stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT, timeout=60)


# ---------------------------------------------------------------------------
# LLM serving
# ---------------------------------------------------------------------------

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


def start_llama(config, profile_name="qwen"):
    creative_switch(config, "comfy-stop")
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

    mmproj_model = profile.get("mmproj_model", "")
    mmproj_url = profile.get("mmproj_url", "")
    if mmproj_model:
        mmproj_path = Path(mmproj_model)
        if mmproj_path.exists():
            cmd.extend(["--mmproj", str(mmproj_path)])
        elif mmproj_url:
            cmd.extend(["--mmproj-url", mmproj_url])

    start_process("llama", cmd, llama_cpp, base_env(config))
    url = f"http://{config['LLAMA_HOST']}:{config['LLAMA_PORT']}/health"
    print(f"llama starting ({profile['label']}): {url}")
    if not model.exists() and profile["hf_repo"]:
        print(f"using Hugging Face repo: {profile['hf_repo']}")
    if mmproj_model and not Path(mmproj_model).exists() and mmproj_url:
        print(f"using mmproj URL: {mmproj_url}")
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
    try:
        result = subprocess.run(["systemctl", "stop", "ollama"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=15)
        if result.returncode != 0:
            result = subprocess.run(["sudo", "-n", "systemctl", "stop", "ollama"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=15)
        print(result.stdout.strip() or ("ollama stopped" if result.returncode == 0 else "Could not stop ollama. Run: sudo systemctl stop ollama"))
    except subprocess.TimeoutExpired:
        print("Could not stop ollama: systemctl timed out")


# ---------------------------------------------------------------------------
# Build pipeline (planner -> orchestrator -> OpenHands) and Genesis Runtime
# ---------------------------------------------------------------------------

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
    print("planner setup complete - start it with: agent-switch planner")


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
    # The database package's build imports the generated Prisma client, so generate first.
    for label, script in (("db:generate", "db:generate"), ("build", "build"), ("db:migrate (apply migrations)", "db:migrate")):
        print(f"orchestrator {label}...")
        if not pnpm_run(orch_dir, script, env=env):
            print(f"orchestrator {label} failed")
            return
    print("orchestrator setup complete - start it with: agent-switch orchestrator")


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


def pipeline_env(config):
    env = base_env(config)
    env["PLANNER_DIR"] = config.get("PLANNER_DIR", str(ROOT / "planner-pipeline"))
    env["ORCHESTRATOR_DIR"] = config.get("ORCHESTRATOR_DIR", str(ROOT / "implementation-orchestrator"))
    env["PLANNER_URL"] = f"http://{config.get('PLANNER_HOST', '127.0.0.1')}:{config.get('PLANNER_PORT', '39006')}"
    env["ORCHESTRATOR_URL"] = f"http://{config.get('ORCHESTRATOR_HOST', '127.0.0.1')}:{config.get('ORCHESTRATOR_PORT', '39007')}"
    openhands_host = config.get("OPENHANDS_HOST", "0.0.0.0")
    env["OPENHANDS_URL"] = f"http://{'127.0.0.1' if openhands_host == '0.0.0.0' else openhands_host}:{config.get('OPENHANDS_PORT', '39009')}"
    env["OPENHANDS_PORT"] = config.get("OPENHANDS_PORT", "39009")
    env["OPENHANDS_VSCODE_PORT"] = config.get("OPENHANDS_VSCODE_PORT", "39017")
    return env


def start_dashboard(config):
    if is_running(read_pid("pipeline-dashboard")):
        print("pipeline-dashboard already running")
        return
    env = pipeline_env(config)
    env["DASHBOARD_PORT"] = config.get("DASHBOARD_PORT", "39016")
    node = shutil.which("node") or "node"
    start_process("pipeline-dashboard", [node, "pipeline-dashboard-server.mjs"], ROOT, env)
    url = f"http://{config.get('DASHBOARD_HOST', '127.0.0.1')}:{config.get('DASHBOARD_PORT', '39016')}/"
    print(f"pipeline dashboard starting: {url}")
    wait_http(url)


def stop_dashboard(config):
    stop("pipeline-dashboard")


def start_console(config):
    """Runtime + Performance web console (console/console.py), moved out of Studio."""
    if is_running(read_pid("console")):
        print("console already running")
        return
    python = ROOT / ".venv/bin/python"
    if not python.exists():
        python = Path(sys.executable)
    cmd = [
        str(python), str(ROOT / "console/console.py"),
        "--host", config.get("CONSOLE_HOST", "0.0.0.0"),
        "--port", config.get("CONSOLE_PORT", "39019"),
    ]
    start_process("console", cmd, ROOT, base_env(config))
    host = config.get("CONSOLE_HOST", "0.0.0.0")
    url = f"http://{'127.0.0.1' if host == '0.0.0.0' else host}:{config.get('CONSOLE_PORT', '39019')}/"
    print(f"console starting: {url}")
    wait_http(url + "api/health")


def pipeline_status(config):
    """Foreground terminal dashboard (pipeline-status.mjs) - runs until Ctrl+C."""
    env = pipeline_env(config)
    node = shutil.which("node") or "node"
    subprocess.run([node, "pipeline-status.mjs"], cwd=str(ROOT), env=env)


# ---------------------------------------------------------------------------
# Status / CLI
# ---------------------------------------------------------------------------

SERVICES = (
    "llama", "qwen-sidecar",
    "planner-api", "planner-worker", "orchestrator-api", "orchestrator-worker",
    "genesis-runtime", "openhands", "pipeline-dashboard", "console",
)


def print_status():
    for name in SERVICES[:2]:
        print(status_text(name))
    print(systemd_service_text("ollama"))
    for name in SERVICES[2:]:
        print(status_text(name))


def diagnostics(config):
    print_status()
    print()
    print("Endpoints:")
    print(f"  llama:  http://{config['LLAMA_HOST']}:{config['LLAMA_PORT']}")
    print(f"  qwen-sidecar: http://{config.get('QWEN_SIDECAR_HOST', '127.0.0.1')}:{config.get('QWEN_SIDECAR_PORT', '39002')}")
    print(f"  ollama: {ollama_base_url(config)} ({config.get('OLLAMA_MODEL', 'qwen3:0.6b')})")
    print(f"  planner: http://{config.get('PLANNER_HOST', '127.0.0.1')}:{config.get('PLANNER_PORT', '39006')} (docs at /docs)")
    print(f"  orchestrator: http://{config.get('ORCHESTRATOR_HOST', '127.0.0.1')}:{config.get('ORCHESTRATOR_PORT', '39007')}")
    print(f"  genesis: http://{config.get('GENESIS_HOST', '0.0.0.0')}:{config.get('GENESIS_PORT', '39008')}")
    print(f"  openhands: http://{config.get('OPENHANDS_HOST', '0.0.0.0')}:{config.get('OPENHANDS_PORT', '39009')}")
    print(f"  pipeline dashboard: http://{config.get('DASHBOARD_HOST', '127.0.0.1')}:{config.get('DASHBOARD_PORT', '39016')}")
    print(f"  console: http://{config.get('CONSOLE_HOST', '0.0.0.0')}:{config.get('CONSOLE_PORT', '39019')} (Runtime + Performance)")
    print()
    print("[vulkan]")
    print(run_text(["vulkaninfo", "--summary"], timeout=12, env=base_env(config)) or "(no output)")


LLAMA_PROFILES = {
    "llama": "qwen",
    "llama-heretic": "heretic",
    "llama-heretic27": "heretic27",
    "llama-small": "qwen-small",
}


def main(argv=None):
    commands = {
        **{name: None for name in LLAMA_PROFILES},
        **{f"{name}-restart": None for name in LLAMA_PROFILES if name != "llama-small"},
        "llama-stop": lambda c: stop_llama(c),
        "qwen-sidecar": start_qwen_sidecar,
        "qwen-sidecar-stop": lambda c: stop("qwen-sidecar"),
        "ollama": start_ollama,
        "ollama-stop": lambda c: stop_ollama(),
        "ollama-restart": lambda c: (stop_ollama(), start_ollama(c)),
        "planner": start_planner,
        "planner-stop": stop_planner,
        "planner-setup": planner_setup,
        "orchestrator": start_orchestrator,
        "orchestrator-stop": stop_orchestrator,
        "orchestrator-setup": orchestrator_setup,
        "genesis": start_genesis,
        "genesis-stop": stop_genesis,
        "openhands": start_openhands,
        "openhands-stop": stop_openhands,
        "pipeline-dashboard": start_dashboard,
        "pipeline-dashboard-stop": stop_dashboard,
        "pipeline-status": pipeline_status,
        "console": start_console,
        "console-stop": lambda c: stop("console"),
        "stop": None,
        "status": lambda c: print_status(),
        "diag": diagnostics,
    }
    parser = argparse.ArgumentParser(description="Agent Suite: LLM serving, Genesis Runtime and the AI build pipeline.")
    parser.add_argument("command", choices=list(commands))
    args = parser.parse_args(argv)
    config = load_config()
    command = args.command

    if command in LLAMA_PROFILES:
        start_llama(config, LLAMA_PROFILES[command])
    elif command.endswith("-restart") and command.removesuffix("-restart") in LLAMA_PROFILES:
        stop_llama(config, quiet=True)
        start_llama(config, LLAMA_PROFILES[command.removesuffix("-restart")])
    elif command == "stop":
        stop_llama(config, quiet=True)
        stop("qwen-sidecar", quiet=True)
        stop_ollama()
        stop_planner(config)
        stop_orchestrator(config)
        stop_genesis(config)
        stop_openhands(config)
        stop_dashboard(config)
        stop("console", quiet=True)
        print("all stopped")
    else:
        commands[command](config)


if __name__ == "__main__":
    main()
