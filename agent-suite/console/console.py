#!/usr/bin/env python3
"""Agent Suite console: the Runtime and Performance pages for the machine's LLM
serving (moved out of the creative suite's Studio). Started via
`agent-switch console`; Studio proxies /api/performance/* here so its Chat tab
can still read model/task data and switch task models.
"""
import argparse
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from flask import Flask, jsonify, render_template, request

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import agent_manager  # noqa: E402

app = Flask(__name__, template_folder=str(Path(__file__).resolve().parent))


def _runtime_config() -> Dict[str, str]:
    return agent_manager.load_config()


def _set_config_env_values(updates: Dict[str, str]) -> None:
    _write_config_env(agent_manager.CONFIG, updates)


def _creative_switch() -> Path:
    return Path(_runtime_config()["CREATIVE_SUITE_DIR"]) / "ai-switch"


# Runtime-tab buttons for services the creative suite owns run through its ai-switch,
# the same way agent-switch hands the GPU to/from ComfyUI.
CREATIVE_COMMANDS = {
    'comfy', 'comfy-stop', 'studio', 'chat', 'chat-ollama', 'playwright',
    'display-safe-toggle',
}
AGENT_COMMANDS = {
    'llama', 'llama-restart', 'llama-stop', 'llama-heretic', 'llama-heretic-restart',
    'llama-heretic27', 'llama-heretic27-restart', 'llama-small',
    'qwen-sidecar', 'qwen-sidecar-stop', 'ollama', 'ollama-stop', 'ollama-restart', 'stop',
    'planner', 'planner-stop', 'planner-setup', 'orchestrator', 'orchestrator-stop', 'orchestrator-setup',
    'openhands', 'openhands-stop', 'genesis', 'genesis-stop', 'pipeline-dashboard', 'pipeline-dashboard-stop',
}


def run_service_command(command: str, timeout: int = 120) -> Tuple[int, str]:
    if command in AGENT_COMMANDS:
        switch = ROOT / "agent-switch"
    elif command in CREATIVE_COMMANDS:
        switch = _creative_switch()
    else:
        return 2, f"Unknown service command: {command}"
    try:
        result = subprocess.run(
            [str(switch), command],
            cwd=str(switch.parent),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
        )
        return result.returncode, result.stdout
    except subprocess.TimeoutExpired as exc:
        output = exc.stdout or ""
        return 124, f"{output}\nCommand timed out after {timeout}s".strip()
    except FileNotFoundError:
        return 127, f"Missing switcher script: {switch}"


def _studio_url() -> str:
    creative = agent_manager.read_env_file(_creative_switch().parent / "config.env")
    host = request.host.split(':')[0]
    return f"http://{host}:{creative.get('STUDIO_PORT', '39000')}"


@app.route('/')
def index():
    config = _runtime_config()
    host = request.host.split(':')[0]
    return render_template(
        'index.html',
        studio_url=_studio_url(),
        dashboard_url=f"http://{host}:{config.get('DASHBOARD_PORT', '39016')}/",
        request_host=host,
        planner_port=config.get('PLANNER_PORT', '39006'),
        orchestrator_port=config.get('ORCHESTRATOR_PORT', '39007'),
        openhands_port=config.get('OPENHANDS_PORT', '39009'),
        genesis_port=config.get('GENESIS_PORT', '39008'),
        dashboard_port=config.get('DASHBOARD_PORT', '39016'),
    )


@app.route('/api/health')
def api_health():
    return jsonify({'status': 'ok'})


@app.route('/api/system/stats')
def api_system_stats():
    """Live CPU/RAM/GPU/NPU readout for the Runtime tab."""
    return jsonify(system_resource_stats())


@app.route('/api/services')
def api_services():
    """Status of both suites: this one's services, then the creative suite's."""
    code, output = subprocess_status(ROOT / "agent-switch")
    creative_code, creative_output = subprocess_status(_creative_switch())
    combined = f"{output}\n\n[creative suite]\n{creative_output}".strip()
    ok = code == 0
    return jsonify({'ok': ok, 'command': 'status', 'returncode': code, 'output': combined}), 200 if ok else 500


def subprocess_status(switch: Path) -> Tuple[int, str]:
    if not switch.exists():
        return 127, f"not installed ({switch})"
    try:
        result = subprocess.run([str(switch), 'status'], cwd=str(switch.parent), text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=20)
        return result.returncode, result.stdout.strip()
    except Exception as exc:
        return 1, str(exc)


@app.route('/api/services/<command>', methods=['POST'])
def api_service_command(command: str):
    timeout = int((request.get_json(silent=True) or {}).get('timeout', 120))
    code, output = run_service_command(command, timeout=timeout)
    return jsonify({'ok': code == 0, 'command': command, 'returncode': code, 'output': output}), 200 if code == 0 else 400


def _run_text(command: List[str], timeout: int = 8, env: Optional[Dict[str, str]] = None) -> Tuple[int, str]:
    try:
        result = subprocess.run(
            command,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=timeout,
            env=env,
        )
        return result.returncode, result.stdout.strip()
    except FileNotFoundError:
        return 127, f"{command[0]} not found"
    except subprocess.TimeoutExpired as exc:
        output = (exc.stdout or "")
        return 124, f"Timed out running {' '.join(command)}\n{output}".strip()
    except Exception as exc:
        return 1, str(exc)


def _read_text(path: Path, limit: int = 12000) -> str:
    try:
        return path.read_text(errors='replace')[:limit]
    except Exception:
        return ''


def _write_config_env(CONFIG: Path, updates: Dict[str, str]) -> None:
    lines = CONFIG.read_text().splitlines() if CONFIG.exists() else []
    seen = set()
    output = []
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith('#') or '=' not in line:
            output.append(line)
            continue
        key, _value = line.split('=', 1)
        key = key.strip()
        if key in updates:
            output.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            output.append(line)
    missing = [key for key in updates if key not in seen]
    if missing and output and output[-1].strip():
        output.append("")
    for key in missing:
        output.append(f"{key}={updates[key]}")
    CONFIG.write_text("\n".join(output) + "\n")


def _ok_item(label: str, ok: bool, detail: str, recommendation: str = "") -> Dict[str, Any]:
    return {
        'label': label,
        'ok': bool(ok),
        'status': 'ok' if ok else 'attention',
        'detail': detail,
        'recommendation': recommendation,
    }


def _cpu_times() -> Tuple[float, float]:
    """Return (idle, total) jiffies from the aggregate 'cpu' line of /proc/stat."""
    line = next((row for row in _read_text(Path('/proc/stat'), 4000).splitlines() if row.startswith('cpu ')), '')
    parts = line.split()
    if len(parts) < 5:
        return 0.0, 0.0
    values = [float(value) for value in parts[1:]]
    idle = values[3] + (values[4] if len(values) > 4 else 0.0)  # idle + iowait
    return idle, sum(values)


def _cpu_percent(sample_seconds: float = 0.1) -> Optional[float]:
    idle_start, total_start = _cpu_times()
    if total_start == 0:
        return None
    time.sleep(sample_seconds)
    idle_end, total_end = _cpu_times()
    total_delta = total_end - total_start
    if total_delta <= 0:
        return None
    percent = (1 - (idle_end - idle_start) / total_delta) * 100
    return round(max(0.0, min(100.0, percent)), 1)


def _ram_stats() -> Dict[str, Any]:
    meminfo = _read_text(Path('/proc/meminfo'), 8000)
    kb = {}
    for key in ('MemTotal', 'MemAvailable'):
        match = re.search(rf'^{key}:\s+(\d+)\s+kB', meminfo, re.MULTILINE)
        kb[key] = int(match.group(1)) if match else 0
    total_gb = kb['MemTotal'] / 1024 / 1024
    available_gb = kb['MemAvailable'] / 1024 / 1024
    used_gb = max(0.0, total_gb - available_gb)
    return {
        'used_gb': round(used_gb, 1),
        'total_gb': round(total_gb, 1),
        'percent': round((used_gb / total_gb) * 100, 1) if total_gb else 0.0,
    }


def _amd_gpu_device_dir() -> Optional[Path]:
    """Find the sysfs device dir for the first AMD GPU with usage counters."""
    drm = Path('/sys/class/drm')
    if not drm.exists():
        return None
    for entry in sorted(drm.glob('card[0-9]*')):
        if '-' in entry.name:
            continue
        device = entry / 'device'
        if _read_text(device / 'vendor').strip() == '0x1002' and (device / 'gpu_busy_percent').exists():
            return device
    return None


def _gpu_stats() -> Dict[str, Any]:
    device = _amd_gpu_device_dir()
    if not device:
        return {'available': False}

    def read_int(path: Path) -> Optional[int]:
        text = _read_text(path).strip()
        try:
            return int(text)
        except ValueError:
            return None

    def to_gb(value: Optional[int]) -> Optional[float]:
        return round(value / (1024 ** 3), 2) if value is not None else None

    temp_c = None
    power_w = None
    for hwmon in sorted((device / 'hwmon').glob('hwmon*')) if (device / 'hwmon').exists() else []:
        temp_raw = read_int(hwmon / 'temp1_input')
        power_raw = read_int(hwmon / 'power1_average')
        if temp_raw is not None:
            temp_c = round(temp_raw / 1000, 1)
        if power_raw is not None:
            power_w = round(power_raw / 1_000_000, 1)
        break

    return {
        'available': True,
        'busy_percent': read_int(device / 'gpu_busy_percent'),
        'vram_used_gb': to_gb(read_int(device / 'mem_info_vram_used')),
        'vram_total_gb': to_gb(read_int(device / 'mem_info_vram_total')),
        'gtt_used_gb': to_gb(read_int(device / 'mem_info_gtt_used')),
        'gtt_total_gb': to_gb(read_int(device / 'mem_info_gtt_total')),
        'temp_c': temp_c,
        'power_w': power_w,
    }


def _npu_device_dir() -> Optional[Path]:
    """Find the sysfs device dir for the AMD XDNA NPU (Ryzen AI), if present."""
    accel = Path('/sys/class/accel')
    if not accel.exists():
        return None
    for entry in sorted(accel.glob('accel*')):
        device = entry / 'device'
        driver_link = device / 'driver'
        if driver_link.is_symlink() and driver_link.resolve().name == 'amdxdna':
            return device
    return None


def _npu_stats() -> Dict[str, Any]:
    device = _npu_device_dir()
    if not device:
        return {'available': False}

    power_state = _read_text(device / 'power_state').strip()
    return {
        'available': True,
        'name': _read_text(device / 'vbnv').strip() or 'AMD Ryzen AI NPU',
        'fw_version': _read_text(device / 'fw_version').strip() or None,
        'power_state': power_state or None,
        # The amdxdna driver doesn't expose a busy/utilization counter outside
        # debugfs (root-only), so runtime PM state is the best proxy we have:
        # D0 means the NPU is powered up and actively doing work; D3hot/D3cold
        # means it's idle and suspended.
        'active': power_state.upper() == 'D0',
    }


def system_resource_stats() -> Dict[str, Any]:
    return {
        'cpu': {
            'percent': _cpu_percent(),
            'count': os.cpu_count(),
        },
        'ram': _ram_stats(),
        'gpu': _gpu_stats(),
        'npu': _npu_stats(),
    }


def _launcher_llama_version(runtime: Dict[str, str]) -> str:
    llama_bin = Path(runtime.get('LLAMA_CPP_DIR', 'repos/llama.cpp')) / 'build-vulkan/bin'
    exe = llama_bin / 'llama-server'
    env = os.environ.copy()
    env['LD_LIBRARY_PATH'] = f"{llama_bin}:{env.get('LD_LIBRARY_PATH', '')}"
    code, output = _run_text([str(exe), '--version'], timeout=6, env=env)
    return output if code == 0 else output


def _ollama_runtime_status() -> Dict[str, Any]:
    """Return a lightweight Ollama health summary for the Strix Halo checklist."""
    status: Dict[str, Any] = {
        'active': False,
        'online': False,
        'gpu': False,
        'backend': '',
        'detail': '',
    }

    code, active = _run_text(['systemctl', 'is-active', 'ollama'], timeout=3)
    status['active'] = code == 0 and active.strip() == 'active'

    code, version = _run_text(['curl', '-fsS', '--max-time', '2', 'http://127.0.0.1:11434/api/version'], timeout=4)
    if code == 0:
        status['online'] = True
        status['detail'] = version

    code, ps_output = _run_text(['ollama', 'ps'], timeout=5)
    if code == 0 and re.search(r'\bGPU\b|ROCm|Vulkan', ps_output, re.IGNORECASE):
        status['gpu'] = True
        status['backend'] = 'GPU'
        status['detail'] = ps_output
        return status

    code, log_output = _run_text(['journalctl', '-u', 'ollama', '--no-pager', '-n', '200'], timeout=8)
    if code == 0:
        if 'ROCm0' in log_output or 'library=ROCm' in log_output:
            status['gpu'] = True
            status['backend'] = 'ROCm'
        elif 'Vulkan' in log_output:
            status['gpu'] = True
            status['backend'] = 'Vulkan'
        if log_output and not status['detail']:
            status['detail'] = 'recent Ollama logs checked'

    return status


def _human_size(size: int) -> str:
    value = float(size)
    for unit in ('B', 'KB', 'MB', 'GB', 'TB'):
        if value < 1024 or unit == 'TB':
            return f"{value:.1f} {unit}" if unit != 'B' else f"{int(value)} B"
        value /= 1024
    return f"{size} B"


def _model_alias_from_path(path: Path) -> str:
    name = path.name
    name = re.sub(r'-00001-of-\d+\.gguf$', '', name, flags=re.IGNORECASE)
    name = re.sub(r'\.gguf$', '', name, flags=re.IGNORECASE)
    name = re.sub(r'[^a-zA-Z0-9._-]+', '-', name).strip('-').lower()
    return name[:80] or 'local-model'


def _infer_model_tuning(path: Path, size: int) -> Dict[str, Any]:
    text = str(path).lower()
    size_gb = size / 1024 / 1024 / 1024
    is_mmproj = path.name.lower().startswith('mmproj')
    is_split = bool(re.search(r'-00001-of-\d+\.gguf$', path.name, re.IGNORECASE))
    family = 'general'
    if 'coder' in text:
        family = 'coding'
    elif 'heretic' in text or 'uncensored' in text:
        family = 'uncensored'
    elif 'thinkingcap' in text or 'thinking' in text:
        family = 'reasoning'
    elif 'mythos' in text or 'qwythos' in text:
        family = 'sidecar'
    if is_mmproj:
        family = 'multimodal-projector'

    quant = 'unknown'
    quant_match = re.search(r'(UD-)?(IQ\d_[A-Z0-9_]+|Q\d_[A-Z0-9_]+|MXFP\d+|NVFP\d+|F16|FP16)', path.name, re.IGNORECASE)
    if quant_match:
        quant = quant_match.group(0).upper()

    if is_mmproj:
        use = 'Vision projector'
        slot = 'projector'
        ctx = '0'
        extra = ''
        notes = 'Use alongside a matching multimodal model, not as a standalone LLM.'
    elif size_gb <= 8:
        use = 'Sidecar / lightweight helper'
        slot = 'sidecar'
        ctx = '32768'
        extra = '--threads 12 --threads-batch 24'
        notes = 'Good for always-available helper work while ComfyUI owns the GPU.'
    elif size_gb <= 24:
        use = 'Interactive main model'
        slot = 'main'
        ctx = '65536'
        extra = '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1'
        notes = 'Best fit for fast local chat and coding on the current visible-memory state.'
    else:
        use = 'Large capability model'
        slot = 'main'
        ctx = '131072'
        extra = '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1'
        notes = 'Needs the BIOS/UMA and GTT/TTM memory tuning before it can shine.'

    if is_mmproj:
        pass
    elif 'qwen3-coder-next' in text:
        use = 'Current coding model'
        slot = 'main'
        ctx = '131072'
        notes = 'Capability-first coding route; heavier than the guide speed profiles.'
    elif 'heretic' in text:
        use = 'Uncensored chat profile'
        slot = 'heretic'
        ctx = '131072'
        notes = 'Keep separate from the coding slot so prompts and tuning can diverge.'
    elif 'thinkingcap' in text:
        use = 'Reasoning/chat model'
        slot = 'main'
        ctx = '65536'
        notes = 'Likely a better fit than the 80B model while RAM is currently limited.'

    return {
        'alias': _model_alias_from_path(path),
        'family': family,
        'quant': quant,
        'use': use,
        'recommended_slot': slot,
        'recommended_ctx': ctx,
        'recommended_gpu_layers': '0' if slot == 'sidecar' else '999',
        'recommended_extra_args': extra,
        'notes': notes,
        'is_split_primary': is_split,
    }


def _local_llm_models(runtime: Dict[str, str]) -> List[Dict[str, Any]]:
    models_dir = Path(runtime.get('MODELS_DIR') or 'models')
    if not models_dir.exists():
        return []
    models = []
    split_seen = set()
    for path in sorted(models_dir.rglob('*.gguf')):
        split_match = re.search(r'(.+)-000(\d+)-of-(\d+)\.gguf$', path.name, re.IGNORECASE)
        if split_match and split_match.group(2) != '01':
            continue
        split_key = None
        split_parts = 1
        total_size = path.stat().st_size
        if split_match:
            split_key = str(path.parent / split_match.group(1))
            if split_key in split_seen:
                continue
            split_seen.add(split_key)
            split_parts = int(split_match.group(3))
            prefix = split_match.group(1)
            total_size = sum(item.stat().st_size for item in path.parent.glob(f'{prefix}-*.gguf'))
        tuning = _infer_model_tuning(path, total_size)
        model = {
            'path': str(path.resolve()),
            'name': path.name,
            'directory': str(path.parent.resolve()),
            'size_bytes': total_size,
            'size': _human_size(total_size),
            'split_parts': split_parts,
            **tuning,
        }
        model['task_ids'] = _model_task_ids(model)
        model['task_labels'] = [
            profile['name']
            for profile in MODEL_TASK_PROFILES
            if profile['id'] in model['task_ids']
        ]
        models.append(model)
    return models


def _find_local_model_by_path(models: List[Dict[str, Any]], model_path: str) -> Optional[Dict[str, Any]]:
    if not model_path:
        return None
    try:
        resolved = str(Path(model_path).expanduser().resolve())
    except Exception:
        resolved = model_path
    for model in models:
        if model.get('path') == resolved:
            return model
    return None


MODEL_TASK_PROFILES = [
    {
        'id': 'coding',
        'name': 'Coding / Agent Work',
        'summary': 'Best for Codex-style editing, repo reasoning, tool calls, and long code context.',
        'slot': 'main',
        'prompt': 'Use this before code changes, reviews, debugging, and multi-file planning.',
        'keywords': ['coder', 'coding', 'qwen3-coder', 'agentworld'],
    },
    {
        'id': 'fast-chat',
        'name': 'Fast General Chat',
        'summary': 'A responsive everyday assistant for questions, drafts, and quick iteration.',
        'slot': 'main',
        'prompt': 'Use this when latency matters more than maximum model capacity.',
        'keywords': ['general', 'instruct', 'chat', 'qwen3.6', 'lfm'],
    },
    {
        'id': 'deep-reasoning',
        'name': 'Deep Reasoning',
        'summary': 'Stronger deliberate reasoning for hard prompts, analysis, and longer answers.',
        'slot': 'main',
        'prompt': 'Use this when the answer quality matters more than speed.',
        'keywords': ['thinking', 'reasoning', 'cascade', 'nemotron'],
    },
    {
        'id': 'image-prompting',
        'name': 'Image Prompting',
        'summary': 'Good at turning ideas into precise prompts, critique, and generation plans.',
        'slot': 'main',
        'prompt': 'Use this for Studio prompt engineering and image critique workflows.',
        'keywords': ['prompt', 'creative', 'vision', 'omni', 'gemma'],
    },
    {
        'id': 'workflow-routing',
        'name': 'Workflow Routing',
        'summary': 'Quick intent classification and lightweight orchestration inside Studio.',
        'slot': 'sidecar',
        'prompt': 'Use this for routers, small helper prompts, and background decisions.',
        'keywords': ['sidecar', 'small', 'lfm', 'mythos', 'qwythos'],
    },
    {
        'id': 'web-research',
        'name': 'Web Research',
        'summary': 'Balanced model for current-context answers with citations and synthesis.',
        'slot': 'main',
        'prompt': 'Use this for Chat requests that trigger search or summarize found sources.',
        'keywords': ['general', 'reasoning', 'instruct', 'qwen3.6', 'thinking'],
    },
    {
        'id': 'uncensored',
        'name': 'Uncensored / Alternate Voice',
        'summary': 'Separate profile for the Heretic route without disturbing the main model.',
        'slot': 'heretic',
        'prompt': 'Use this when you deliberately want the alternate Heretic profile.',
        'keywords': ['heretic', 'uncensored'],
    },
]


def _model_task_ids(model: Dict[str, Any]) -> List[str]:
    text = ' '.join(str(model.get(key, '')) for key in ('path', 'alias', 'family', 'use')).lower()
    tasks = []
    if 'projector' in text:
        return ['vision-projector']
    if any(token in text for token in ('coder', 'coding', 'agentworld')):
        tasks.append('coding')
    if any(token in text for token in ('thinking', 'reasoning', 'cascade', 'nemotron')):
        tasks.append('deep-reasoning')
    if any(token in text for token in ('prompt', 'vision', 'omni', 'gemma')):
        tasks.append('image-prompting')
    if any(token in text for token in ('sidecar', 'mythos', 'qwythos', 'lfm')) or model.get('recommended_slot') == 'sidecar':
        tasks.append('workflow-routing')
    if any(token in text for token in ('general', 'instruct', 'chat', 'qwen3.6', 'qwen3-30b')):
        tasks.append('fast-chat')
        tasks.append('web-research')
    if any(token in text for token in ('heretic', 'uncensored')):
        tasks.append('uncensored')
    if 'coding' in tasks and 'web-research' not in tasks:
        tasks.append('web-research')
    if 'deep-reasoning' in tasks and 'web-research' not in tasks:
        tasks.append('web-research')
    if 'deep-reasoning' in tasks and 'image-prompting' not in tasks:
        tasks.append('image-prompting')
    if not tasks and model.get('recommended_slot') != 'projector':
        tasks.extend(['fast-chat', 'web-research'])
    return list(dict.fromkeys(tasks))


def _task_score(model: Dict[str, Any], task_id: str) -> int:
    if task_id not in model.get('task_ids', []):
        return 0
    score = 20
    size_gb = float(model.get('size_bytes') or 0) / 1024 / 1024 / 1024
    family = str(model.get('family') or '').lower()
    alias = str(model.get('alias') or '').lower()
    if task_id == 'coding':
        score += 35 if 'coder' in alias or family == 'coding' else 0
        score += 10 if size_gb >= 20 else 0
    elif task_id == 'fast-chat':
        score += 25 if 6 <= size_gb <= 24 else 0
        score += 10 if model.get('recommended_ctx') in ('32768', '65536') else 0
    elif task_id == 'deep-reasoning':
        score += 30 if family == 'reasoning' or 'thinking' in alias else 0
        score += 10 if size_gb >= 14 else 0
    elif task_id == 'image-prompting':
        score += 25 if any(token in alias for token in ('thinking', 'gemma', 'omni')) else 0
        score += 10 if family == 'reasoning' else 0
    elif task_id == 'workflow-routing':
        score += 35 if model.get('recommended_slot') == 'sidecar' else 0
        score += 10 if size_gb <= 10 else 0
    elif task_id == 'web-research':
        score += 30 if family == 'reasoning' else 0
        score += 20 if family == 'general' else 0
        score += 10 if family == 'coding' else 0
    elif task_id == 'uncensored':
        score += 40 if family == 'uncensored' else 0
    if model.get('recommended_slot') == 'projector':
        score = 0
    return score


def _task_profiles_for_models(models: List[Dict[str, Any]], runtime: Dict[str, str]) -> List[Dict[str, Any]]:
    profiles = []
    active_paths = {
        'main': runtime.get('LLAMA_MODEL', ''),
        'heretic': runtime.get('LLAMA_HERETIC_MODEL', ''),
        'sidecar': runtime.get('QWEN_SIDECAR_MODEL', ''),
    }
    for profile in MODEL_TASK_PROFILES:
        candidates = sorted(
            [
                {**model, 'score': _task_score(model, profile['id'])}
                for model in models
                if _task_score(model, profile['id']) > 0
            ],
            key=lambda item: (item['score'], item.get('size_bytes') or 0),
            reverse=True,
        )
        active_slot = profile['slot']
        active_model = _find_local_model_by_path(models, active_paths.get(active_slot, ''))
        profiles.append({
            **profile,
            'active_slot': active_slot,
            'active_model': active_model,
            'best_model': candidates[0] if candidates else None,
            'candidates': candidates[:4],
        })
    return profiles


KNOWN_TUNED_MODELS = [
    {
        'id': 'qwen3-coder-30b-q4ks',
        'name': 'Qwen3-Coder 30B-A3B Q4_K_S',
        'repo': 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF',
        'quant': 'Q4_K_S',
        'runtime': 'llama.cpp Vulkan/RADV',
        'lane': 'fast coding',
        'size': '17.5 GiB',
        'result': '100.99 tg128 r50 on official b9851',
        'status': 'measured-local',
        'slot': 'main',
        'ctx': '65536',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
        'notes': 'Speed-first coding quant; not the balanced quality default.',
    },
    {
        'id': 'qwen3-coder-30b-ud-q4kxL',
        'name': 'Qwen3-Coder 30B-A3B UD-Q4_K_XL',
        'repo': 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF',
        'quant': 'UD-Q4_K_XL',
        'runtime': 'llama.cpp Vulkan/RADV',
        'lane': 'balanced coding',
        'size': '17.7 GiB',
        'result': '96.76 tg128 r20',
        'status': 'measured-local',
        'slot': 'main',
        'ctx': '65536',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
        'notes': 'Balanced coding route when quality matters more than the last few tokens/sec.',
    },
    {
        'id': 'qwen3-30b-a3b-2507-iq4xs',
        'name': 'Qwen3-30B-A3B-Instruct-2507 IQ4_XS',
        'repo': 'unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF',
        'quant': 'IQ4_XS',
        'runtime': 'llama.cpp Vulkan/RADV',
        'lane': 'fast general instruct',
        'size': '13.9 GiB',
        'result': '100.04 tg128; b9544 control 103.18 tg128',
        'status': 'measured-local',
        'slot': 'main',
        'ctx': '65536',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
        'notes': 'Separate general-instruct Qwen route; not a Qwen3-Coder replacement.',
    },
    {
        'id': 'lfm25-8b-a1b-q4km',
        'name': 'LFM2.5 8B-A1B Q4_K_M',
        'repo': 'LiquidAI/LFM2.5-8B-A1B-GGUF',
        'quant': 'Q4_K_M',
        'runtime': 'llama.cpp Vulkan/RADV',
        'lane': 'small MoE speed',
        'size': '5.1 GiB',
        'result': '170.02 generation-only; b9544 control 176.48 tg128',
        'status': 'measured-local',
        'slot': 'sidecar',
        'ctx': '32768',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
        'notes': 'Very fast small active-parameter route; not a 30B capability replacement.',
    },
    {
        'id': 'qwen36-35b-ollama',
        'name': 'Qwen3.6 35B-A3B Q4_K_M',
        'repo': 'ollama:qwen3.6:35b-a3b',
        'quant': 'Q4_K_M',
        'runtime': 'Ollama Vulkan/RADV',
        'lane': 'easy private chat',
        'size': '~23 GiB',
        'result': '60.57 t/s installed service; controlled binaries 72.55-73.20 t/s',
        'status': 'measured-local',
        'slot': 'ollama',
        'ctx': '8192',
        'gpu_layers': '',
        'extra_args': 'OLLAMA_VULKAN=1 OLLAMA_IGPU_ENABLE=1',
        'notes': 'Best beginner chat/Open WebUI path; requires Ollama iGPU/Vulkan environment.',
    },
    {
        'id': 'gemma4-26b-qat-mtp',
        'name': 'Gemma 4 26B-A4B IT QAT + matched MTP head',
        'repo': 'google/gemma-4-26b-it-qat-GGUF',
        'quant': 'UD-Q4_K_XL + Q4_0 MTP',
        'runtime': 'llama-server Vulkan/RADV MTP',
        'lane': 'current Google MTP',
        'size': '14.2 GiB target + draft head',
        'result': '102.69 cold / 107.42 T3-only / 110.00 best repeat t/s',
        'status': 'experimental-local',
        'slot': 'main',
        'ctx': '65536',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1 --spec-type draft-mtp',
        'notes': 'Server/speculative route. Needs matching MTP head and real-prompt acceptance checks.',
    },
    {
        'id': 'qwen3-coder-next-80b',
        'name': 'Qwen3-Coder-Next 80B-A3B',
        'repo': 'unsloth/Qwen3-Coder-Next-80B-A3B-Instruct-GGUF',
        'match': ['qwen3-coder-next'],
        'quant': 'IQ4_XS / UD-Q4_K_XL / Q5_K_M',
        'runtime': 'llama.cpp Vulkan/RADV',
        'lane': 'current coding capability',
        'size': 'varies; local Q5 split is 52.8 GiB',
        'result': 'Guide IQ4_XS row: 61.91 t/s direct; local Q5 is capability-first',
        'status': 'measured-local',
        'slot': 'main',
        'ctx': '131072',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
        'notes': 'Modern coding route; not the fastest 30B speed profile.',
    },
    {
        'id': 'qwen36-35b-direct',
        'name': 'Qwen3.6 35B-A3B direct GGUF',
        'repo': 'unsloth/Qwen3.6-35B-A3B-GGUF',
        'match': ['qwen3.6-35b-a3b-gguf'],
        'quant': 'UD-Q4_K_M / Q4_0',
        'runtime': 'llama.cpp Vulkan/RADV',
        'lane': 'direct Qwen3.6 chat',
        'size': '~21 GiB',
        'result': 'UD-Q4_K_M 62.56 tg128; Q4_0 81.30 tg128 speed-first',
        'status': 'measured-local',
        'slot': 'main',
        'ctx': '65536',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
        'notes': 'Direct control path when you want speed/control over Ollama convenience.',
    },
    {
        'id': 'gemma4-12b-qat',
        'name': 'Gemma 4 12B IT QAT',
        'repo': 'google/gemma-4-12b-it-qat-GGUF',
        'quant': 'UD-Q4_K_XL / Q4_0 MTP variants',
        'runtime': 'llama.cpp Vulkan/RADV',
        'lane': 'small current Google route',
        'size': '6.7 GiB',
        'result': '29.34 tg128 direct; MTP smoke reached 73.33 t/s',
        'status': 'measured-local',
        'slot': 'sidecar',
        'ctx': '32768',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
        'notes': 'Useful current-model route; strongest value is matched QAT MTP, not plain direct speed.',
    },
    {
        'id': 'gemma4-31b-qat-dflash',
        'name': 'Gemma 4 31B QAT + matched DFlash sidecar',
        'repo': 'google/gemma-4-31b-it-qat-GGUF',
        'quant': 'QAT Q4_0 + DFlash',
        'runtime': 'llama.cpp b10066 DFlash',
        'lane': 'current watchlist',
        'size': '~20 GiB',
        'result': 'Text/vision/tool calls passed; DFlash slower on measured synthetic prompts',
        'status': 'measured-watch',
        'slot': 'main',
        'ctx': '65536',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
        'notes': 'Useful current-model route, but not currently a speed upgrade over no-spec in the guide.',
    },
    {
        'id': 'nemotron-3-nano-omni-nvfp4',
        'name': 'Nemotron 3 Nano Omni 30B-A3B NVFP4 + F16 projector',
        'repo': 'unsloth/NVIDIA-Nemotron-3-Nano-Omni-30B-A3B-Reasoning-GGUF',
        'match': ['nvidia-nemotron-3-nano-omni-30b-a3b-reasoning'],
        'quant': 'NVFP4 + F16 mmproj',
        'runtime': 'llama-mtmd-cli / llama.cpp Vulkan',
        'lane': '30B image understanding',
        'size': '~22 GiB + projector',
        'result': '53.21 tg128; STRIX 395 OCR smoke passed',
        'status': 'measured-local',
        'slot': 'main',
        'ctx': '32768',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
        'notes': 'Small image smoke only; not broad vision/audio/video validation.',
    },
    {
        'id': 'nemotron-cascade-2-30b',
        'name': 'Nemotron Cascade 2 30B-A3B',
        'repo': 'unsloth/NVIDIA-Nemotron-Cascade-2-30B-A3B-GGUF',
        'match': ['nemotron-cascade-2-30b'],
        'quant': 'IQ4_XS',
        'runtime': 'llama.cpp Vulkan/RADV',
        'lane': 'current 30B reasoning',
        'size': '~18 GiB',
        'result': '78.95 tg128; small correctness checks passed',
        'status': 'measured-local',
        'slot': 'main',
        'ctx': '65536',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
        'notes': 'Useful current-model support row; no reliable no-think claim.',
    },
    {
        'id': 'qwen-agentworld-35b',
        'name': 'Qwen AgentWorld 35B-A3B',
        'repo': 'unsloth/Qwen-AgentWorld-35B-A3B-GGUF',
        'match': ['qwen-agentworld-35b'],
        'quant': 'UD-IQ4_XS',
        'runtime': 'llama.cpp Vulkan/RADV',
        'lane': 'agent/environment route',
        'size': '~20 GiB',
        'result': '65.65 tg128; 128K Q8 KV allocation smoke passed',
        'status': 'measured-local',
        'slot': 'main',
        'ctx': '131072',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
        'notes': 'Agent route, not ordinary chat recommendation or filled-128K quality proof.',
    },
    {
        'id': 'nemotron-audex-30b',
        'name': 'Nemotron Labs Audex 30B-A3B',
        'repo': 'unsloth/Nemotron-Labs-Audex-30B-A3B-GGUF',
        'match': ['nemotron-labs-audex'],
        'quant': 'MXFP4_MOE',
        'runtime': 'llama.cpp Vulkan/RADV',
        'lane': 'text route for audio-adjacent model',
        'size': '~22 GiB',
        'result': '60.73 tg128 text-only; correctness smoke passed',
        'status': 'measured-local',
        'slot': 'main',
        'ctx': '32768',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
        'notes': 'Full audio pipeline not tested; check license before commercial use.',
    },
    {
        'id': 'nemotron-3-super-120b',
        'name': 'Nemotron 3 Super 120B-A12B UD-IQ4_XS',
        'repo': 'unsloth/NVIDIA-Nemotron-3-Super-120B-A12B-GGUF',
        'quant': 'UD-IQ4_XS',
        'runtime': 'llama.cpp Vulkan/RADV',
        'lane': '120B capacity',
        'size': '64.5 GiB',
        'result': '18.43 tg128; b9544 control 18.93 tg128',
        'status': 'measured-local',
        'slot': 'main',
        'ctx': '32768',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
        'notes': 'Capacity/current-model proof, not a speed route.',
    },
    {
        'id': 'deepseek-v4-flash-284b',
        'name': 'DeepSeek V4 Flash 284B UD-IQ2_XXS',
        'repo': 'unsloth/DeepSeek-V4-Flash-GGUF',
        'match': ['deepseek-v4-flash'],
        'quant': 'UD-IQ2_XXS',
        'runtime': 'llama.cpp Vulkan/RADV',
        'lane': 'maximum direct GGUF capacity',
        'size': '90.86 GiB',
        'result': '155.64 pp512 / 13.27 tg128; deterministic answer passed',
        'status': 'measured-local',
        'slot': 'main',
        'ctx': '32768',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1 --no-mmap',
        'notes': 'Low-bit capacity scout. Needs full 128GB-class visible memory before trying.',
    },
    {
        'id': 'minimax-m27',
        'name': 'MiniMax M2.7 230B-class MoE',
        'repo': 'unsloth/MiniMax-M2.7-GGUF',
        'match': ['minimax-m2.7'],
        'quant': 'UD-IQ4_XS',
        'runtime': 'llama.cpp Vulkan/RADV',
        'lane': 'large MoE feasibility',
        'size': '108.4 GiB',
        'result': '28.27 tg128; one-box load/generation scout',
        'status': 'measured-local',
        'slot': 'main',
        'ctx': '32768',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1 --no-mmap',
        'notes': 'Needs 128GB-class visible memory and likely external storage headroom.',
    },
    {
        'id': 'chadrock-ace-saber-35b',
        'name': 'CHADROCK ACE/SABER 35B ROCmFP4 MTP',
        'repo': 'jcbtc/chadrock-35b-ace-saber-rocmfp4-mtp',
        'url': 'https://huggingface.co/jcbtc/chadrock-35b-ace-saber-rocmfp4-mtp',
        'match': ['chadrock-35b-ace-saber'],
        'quant': 'ROCmFP4 STRIX_LEAN + MTP',
        'runtime': 'ROCmFPX / rocmfp4-llama',
        'lane': 'high-acceptance speculative serving',
        'size': '17.7 GiB',
        'result': '141.37 t/s mean on exact 3946-token reference profile',
        'status': 'experimental-local',
        'slot': 'main',
        'ctx': '65536',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 8192 --ubatch-size 2048 --parallel 1',
        'notes': 'Advanced prompt-shape-sensitive route; use pinned ROCmFPX runner, not stock llama.cpp.',
    },
    {
        'id': 'qwopus36-27b-chadrock',
        'name': 'Qwopus3.6 27B Chadrock ROCmFP4 MTP',
        'repo': 'jcbtc/qwopus3.6-27b-v2-chadrock-rocmfp4-mtp',
        'url': 'https://huggingface.co/jcbtc/qwopus3.6-27b-v2-chadrock-rocmfp4-mtp',
        'match': ['qwopus3.6-27b'],
        'quant': 'ROCmFP4 + MTP',
        'runtime': 'ROCmFPX / rocmfp4-llama',
        'lane': 'tuned 27B quality/speed',
        'size': '13.8 GiB',
        'result': 'Community quality-plus-speed evidence; HumanEval+ 0.9451',
        'status': 'community-reported',
        'slot': 'main',
        'ctx': '65536',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 8192 --ubatch-size 2048 --parallel 1',
        'notes': 'Good clean-smoke candidate once ROCmFPX runner is available.',
    },
    {
        'id': 'chadrock-pi-agent-27b',
        'name': 'Chadrock3.6 27B Pi Agent ROCmFP4 MTP',
        'repo': 'jcbtc/chadrock3.6-27b-pi-agent-rocmfp4-mtp',
        'url': 'https://huggingface.co/jcbtc/chadrock3.6-27b-pi-agent-rocmfp4-mtp',
        'match': ['chadrock3.6-27b-pi-agent'],
        'quant': 'ROCmFP4 + MTP',
        'runtime': 'ROCmFPX / rocmfp4-llama',
        'lane': 'agent-profile testing',
        'size': '13.8 GiB',
        'result': 'Public artifact to watch; clean local smoke wanted',
        'status': 'candidate',
        'slot': 'main',
        'ctx': '65536',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 8192 --ubatch-size 2048 --parallel 1',
        'notes': 'Candidate from CHADROCK artifact watchlist.',
    },
    {
        'id': 'crown-halo-35b-dynamic',
        'name': 'Qwen3.6 35B Crown Halo Dynamic MTP',
        'repo': 'jcbtc/qwen3.6-35b-a3b-crown-halo-mtp-dynamic',
        'url': 'https://huggingface.co/jcbtc/qwen3.6-35b-a3b-crown-halo-mtp-dynamic',
        'match': ['crown-halo-mtp-dynamic'],
        'quant': 'dynamic ROCmFP4/MTP',
        'runtime': 'ROCmFPX / rocmfp4-llama',
        'lane': 'tool/function + long context',
        'size': '21.0 GiB',
        'result': 'Load/API/MTP smoke passed; high-speed behavior still needs reproduction',
        'status': 'experimental-local',
        'slot': 'heretic',
        'ctx': '65536',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 8192 --ubatch-size 2048 --parallel 1',
        'notes': 'Useful for tool/function calling and long-context behavior tests.',
    },
    {
        'id': 'chadrock35-uncensored-strix-lean',
        'name': 'CHADROCK3.6 35B Uncensored MTP STRIX_LEAN',
        'repo': 'jcbtc/CHADROCK3.6-35B-UNCENSORED-MTP-STRIX-LEAN',
        'url': 'https://huggingface.co/jcbtc/CHADROCK3.6-35B-UNCENSORED-MTP-STRIX-LEAN',
        'match': ['chadrock3.6-35b-uncensored'],
        'quant': 'ROCmFP4 STRIX_LEAN + MTP',
        'runtime': 'ROCmFPX / rocmfp4-llama',
        'lane': 'uncensored tuned route',
        'size': '17.7 GiB',
        'result': 'Earlier 35B STRIX_LEAN candidate',
        'status': 'candidate',
        'slot': 'heretic',
        'ctx': '65536',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 8192 --ubatch-size 2048 --parallel 1',
        'notes': 'Useful for format/runtime checks; advanced lane.',
    },
    {
        'id': 'step37-rocmfpx-q3',
        'name': 'Step 3.7 Flash ROCmFPX Q3 QualityPlus + Q8 MTP draft',
        'repo': 'jcbtc/Step-3.7-Flash-ROCmFPX-Q3-QualityPlus',
        'url': 'https://huggingface.co/jcbtc/Step-3.7-Flash-ROCmFPX-Q3-QualityPlus',
        'match': ['step-3.7-flash-rocmfpx-q3-qualityplus'],
        'quant': 'ROCmFPX Q3 QualityPlus + Q8 draft',
        'runtime': 'ROCmFPX pinned llama-server',
        'lane': '198B sparse local agent',
        'size': '81.77 GiB target; 85.22 GiB with draft/templates',
        'result': '34.50 t/s at 4K; 33.83 t/s at 16K; native tool call passed',
        'status': 'experimental-local',
        'slot': 'main',
        'ctx': '262144',
        'gpu_layers': '999',
        'extra_args': '--flash-attn on --device Vulkan0 --batch-size 8192 --ubatch-size 2048 --parallel 1',
        'notes': 'Requires 128GB-class visible memory and pinned ROCmFPX runtime; not stock llama.cpp.',
    },
]


def _known_model_download_command(model: Dict[str, Any]) -> str:
    repo = model.get('repo', '')
    if repo.startswith('ollama:'):
        return f"ollama pull {repo.split(':', 1)[1]}"
    if '/' in repo:
        target = re.sub(r'[^a-zA-Z0-9._-]+', '-', repo.split('/')[-1]).strip('-')
        return f"huggingface-cli download {repo} --local-dir models/{target}"
    return ''


def _known_model_install_match(model: Dict[str, Any], local_models: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    repo = str(model.get('repo', ''))
    if repo.startswith('ollama:'):
        target = repo.split(':', 1)[1].strip().lower()
        code, output = _run_text(['ollama', 'list'], timeout=5)
        if code == 0:
            for line in output.splitlines()[1:]:
                name = line.split()[0].strip().lower() if line.split() else ''
                if name == target:
                    return {
                        'path': f'ollama:{name}',
                        'name': name,
                        'alias': name,
                        'directory': 'ollama',
                        'family': 'ollama',
                        'quant': model.get('quant', ''),
                        'use': 'Ollama local service',
                        'recommended_slot': 'ollama',
                        'size': 'managed by Ollama',
                        'split_parts': 1,
                    }
        return None

    known_text = f"{model.get('name', '')} {model.get('repo', '')} {model.get('quant', '')}".lower()
    required_sizes = set(re.findall(r'\b\d+b\b', known_text))
    quant_matches = [
        match.lower().replace('-', '')
        for match in re.findall(r'(?:ud-)?(?:iq\d_[a-z0-9_]+|q\d_[a-z0-9_]+|mxfp\d+|nvfp\d+)', known_text, re.IGNORECASE)
    ]
    haystack_terms = [
        model.get('name', ''),
        model.get('repo', '').split('/')[-1],
        model.get('quant', ''),
    ]
    tokens = {
        token.lower()
        for term in haystack_terms
        for token in re.split(r'[^a-zA-Z0-9]+', term)
        if len(token) >= 4
    }
    explicit_match = [str(term).lower() for term in (model.get('match') or [])]
    for local in local_models:
        local_text = f"{local.get('path', '')} {local.get('alias', '')} {local.get('quant', '')}".lower().replace('-', '')
        raw_local_text = f"{local.get('path', '')} {local.get('alias', '')}".lower()
        if explicit_match:
            if all(term in raw_local_text for term in explicit_match):
                return local
            continue
        if required_sizes and not any(size in local_text for size in required_sizes):
            continue
        if quant_matches and not any(quant in local_text for quant in quant_matches):
            continue
        if tokens and sum(1 for token in tokens if token in local_text) >= min(3, len(tokens)):
            return local
    return None


def known_tuned_model_catalog(local_models: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    catalog = []
    for model in KNOWN_TUNED_MODELS:
        item = dict(model)
        pseudo = {
            'path': ' '.join(str(item.get(key, '')) for key in ('name', 'repo', 'lane', 'notes')),
            'alias': item.get('name', ''),
            'family': item.get('lane', ''),
            'use': item.get('lane', ''),
            'notes': item.get('notes', ''),
            'recommended_slot': item.get('slot', ''),
        }
        item['task_ids'] = _model_task_ids(pseudo)
        item['task_labels'] = [
            profile['name']
            for profile in MODEL_TASK_PROFILES
            if profile['id'] in item['task_ids']
        ]
        item['url'] = item.get('url') or (f"https://huggingface.co/{item['repo']}" if '/' in item.get('repo', '') else '')
        item['download_command'] = _known_model_download_command(item)
        match = _known_model_install_match(item, local_models)
        item['installed'] = bool(match)
        item['local_model'] = match
        catalog.append(item)
    return catalog


def model_tuning_status() -> Dict[str, Any]:
    runtime = _runtime_config()
    models = _local_llm_models(runtime)
    slots = {
        'main': {
            'label': 'Coding / Main LLM',
            'model_key': 'LLAMA_MODEL',
            'alias_key': 'LLAMA_ALIAS',
            'ctx_key': 'LLAMA_CTX',
            'gpu_layers_key': 'LLAMA_GPU_LAYERS',
            'extra_args_key': 'LLAMA_EXTRA_ARGS',
        },
        'heretic': {
            'label': 'Heretic LLM',
            'model_key': 'LLAMA_HERETIC_MODEL',
            'alias_key': 'LLAMA_HERETIC_ALIAS',
            'ctx_key': 'LLAMA_HERETIC_CTX',
            'gpu_layers_key': 'LLAMA_HERETIC_GPU_LAYERS',
            'extra_args_key': 'LLAMA_HERETIC_EXTRA_ARGS',
        },
        'heretic27': {
            'label': 'Heretic LLM (27B)',
            'model_key': 'LLAMA_HERETIC27_MODEL',
            'alias_key': 'LLAMA_HERETIC27_ALIAS',
            'ctx_key': 'LLAMA_HERETIC27_CTX',
            'gpu_layers_key': 'LLAMA_HERETIC27_GPU_LAYERS',
            'extra_args_key': 'LLAMA_HERETIC27_EXTRA_ARGS',
        },
        'sidecar': {
            'label': 'Sidecar LLM',
            'model_key': 'QWEN_SIDECAR_MODEL',
            'alias_key': 'QWEN_SIDECAR_ALIAS',
            'ctx_key': 'QWEN_SIDECAR_CTX',
            'gpu_layers_key': 'QWEN_SIDECAR_GPU_LAYERS',
            'extra_args_key': 'QWEN_SIDECAR_EXTRA_ARGS',
            'reasoning_key': 'QWEN_SIDECAR_REASONING',
        },
    }
    slot_data = {}
    for slot, spec in slots.items():
        slot_data[slot] = {
            'label': spec['label'],
            'model': runtime.get(spec['model_key'], ''),
            'alias': runtime.get(spec['alias_key'], ''),
            'ctx': runtime.get(spec['ctx_key'], ''),
            'gpu_layers': runtime.get(spec['gpu_layers_key'], ''),
            'extra_args': runtime.get(spec['extra_args_key'], ''),
            'reasoning': runtime.get(spec.get('reasoning_key', ''), ''),
        }
    return {
        'models': models,
        'known_tuned_models': known_tuned_model_catalog(models),
        'task_profiles': _task_profiles_for_models(models, runtime),
        'slots': slot_data,
        'slot_order': ['main', 'heretic', 'heretic27', 'sidecar'],
        'presets': [
            {
                'id': 'speed',
                'name': 'Speed',
                'ctx': '32768',
                'gpu_layers': '999',
                'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1 --cache-type-k q4_0 --cache-type-v q4_0',
            },
            {
                'id': 'balanced',
                'name': 'Balanced',
                'ctx': '65536',
                'gpu_layers': '999',
                'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
            },
            {
                'id': 'long-context',
                'name': 'Long Context',
                'ctx': '131072',
                'gpu_layers': '999',
                'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
            },
            {
                'id': 'multi-tool',
                'name': 'Multi Tool',
                'ctx': '65536',
                'gpu_layers': '999',
                'extra_args': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 4 --cont-batching',
            },
            {
                'id': 'cpu-sidecar',
                'name': 'CPU Sidecar',
                'ctx': '32768',
                'gpu_layers': '0',
                'extra_args': '--threads 12 --threads-batch 24',
            },
        ],
    }


MODEL_SLOT_SPECS = {
    'main': {
        'model_key': 'LLAMA_MODEL',
        'alias_key': 'LLAMA_ALIAS',
        'ctx_key': 'LLAMA_CTX',
        'gpu_layers_key': 'LLAMA_GPU_LAYERS',
        'extra_args_key': 'LLAMA_EXTRA_ARGS',
        'restart_command': 'llama-restart',
    },
    'heretic': {
        'model_key': 'LLAMA_HERETIC_MODEL',
        'alias_key': 'LLAMA_HERETIC_ALIAS',
        'ctx_key': 'LLAMA_HERETIC_CTX',
        'gpu_layers_key': 'LLAMA_HERETIC_GPU_LAYERS',
        'extra_args_key': 'LLAMA_HERETIC_EXTRA_ARGS',
        'restart_command': 'llama-heretic-restart',
    },
    'heretic27': {
        'model_key': 'LLAMA_HERETIC27_MODEL',
        'alias_key': 'LLAMA_HERETIC27_ALIAS',
        'ctx_key': 'LLAMA_HERETIC27_CTX',
        'gpu_layers_key': 'LLAMA_HERETIC27_GPU_LAYERS',
        'extra_args_key': 'LLAMA_HERETIC27_EXTRA_ARGS',
        'restart_command': 'llama-heretic27-restart',
    },
    'sidecar': {
        'model_key': 'QWEN_SIDECAR_MODEL',
        'alias_key': 'QWEN_SIDECAR_ALIAS',
        'ctx_key': 'QWEN_SIDECAR_CTX',
        'gpu_layers_key': 'QWEN_SIDECAR_GPU_LAYERS',
        'extra_args_key': 'QWEN_SIDECAR_EXTRA_ARGS',
        'reasoning_key': 'QWEN_SIDECAR_REASONING',
        'restart_command': 'qwen-sidecar',
    },
}


def _save_model_slot(slot: str, payload: Dict[str, Any]) -> Tuple[bool, str, Dict[str, str], int]:
    if slot not in MODEL_SLOT_SPECS:
        return False, f'Unknown model slot: {slot}', {}, 404

    model_path = str(payload.get('model') or '').strip()
    alias = str(payload.get('alias') or '').strip()
    ctx = str(payload.get('ctx') or '').strip()
    gpu_layers = str(payload.get('gpu_layers') or '').strip()
    extra_args = str(payload.get('extra_args') or '').strip()
    reasoning = str(payload.get('reasoning') or '').strip().lower()

    if not model_path:
        return False, 'Model path is required', {}, 400
    model = Path(model_path).expanduser()
    if not model.exists():
        return False, f'Model does not exist: {model}', {}, 400
    if model.suffix.lower() != '.gguf':
        return False, 'Only GGUF LLM models can be assigned to these runtime slots', {}, 400

    try:
        if extra_args:
            shlex.split(extra_args)
    except ValueError as exc:
        return False, f'Extra args are not valid shell-style arguments: {exc}', {}, 400

    if ctx and not ctx.isdigit():
        return False, 'Context must be a positive integer', {}, 400
    if gpu_layers and not re.match(r'^-?\d+$', gpu_layers):
        return False, 'GPU layers must be an integer', {}, 400

    spec = MODEL_SLOT_SPECS[slot]
    updates = {
        spec['model_key']: str(model.resolve()),
        spec['alias_key']: alias or _model_alias_from_path(model),
    }
    if ctx:
        updates[spec['ctx_key']] = ctx
    if gpu_layers:
        updates[spec['gpu_layers_key']] = gpu_layers
    updates[spec['extra_args_key']] = extra_args
    if slot == 'sidecar' and reasoning in ('on', 'off', 'auto'):
        updates[spec['reasoning_key']] = reasoning

    _set_config_env_values(updates)
    return True, 'saved', updates, 200


def strix_halo_performance_status() -> Dict[str, Any]:
    runtime = _runtime_config()
    cmdline = _read_text(Path('/proc/cmdline'), 2000).strip()
    cpuinfo = _read_text(Path('/proc/cpuinfo'), 20000)
    meminfo = _read_text(Path('/proc/meminfo'), 8000)
    total_kb = 0
    match = re.search(r'^MemTotal:\s+(\d+)\s+kB', meminfo, re.MULTILINE)
    if match:
        total_kb = int(match.group(1))
    total_gb = round(total_kb / 1024 / 1024, 1) if total_kb else None

    code, tuned_output = _run_text(['tuned-adm', 'active'], timeout=5)
    tuned_ok = code == 0 and 'accelerator-performance' in tuned_output

    code, vulkan_output = _run_text(['vulkaninfo', '--summary'], timeout=10)
    radv_ok = code == 0 and 'DRIVER_ID_MESA_RADV' in vulkan_output and 'GFX1151' in vulkan_output
    mesa_match = re.search(r'driverInfo\s+=\s+(Mesa[^\n]+)', vulkan_output)
    mesa_text = mesa_match.group(1).strip() if mesa_match else 'unknown'
    amdvlk_files = sorted(Path('/usr/share/vulkan/icd.d').glob('*amd*')) if Path('/usr/share/vulkan/icd.d').exists() else []
    radeon_icd = Path('/usr/share/vulkan/icd.d/radeon_icd.json').exists()

    groups = set(os.getgroups())
    group_names = set()
    try:
        import grp
        group_names = {grp.getgrgid(group_id).gr_name for group_id in groups}
    except Exception:
        group_names = set()
    group_ok = {'render', 'video'}.issubset(group_names)

    modprobe_text = _read_text(Path('/etc/modprobe.d/amdgpu_llm_optimized.conf'), 4000)
    boot_params = {
        'amdgpu.gttsize=131072': 'amdgpu.gttsize=131072' in cmdline,
        'ttm.pages_limit=31457280': 'ttm.pages_limit=31457280' in cmdline,
        'amdgpu.cwsr_enable=0': 'amdgpu.cwsr_enable=0' in cmdline,
    }
    modprobe_ok = 'gttsize=122800' in modprobe_text and 'pages_limit=31457280' in modprobe_text

    ollama_override = _read_text(Path('/etc/systemd/system/ollama.service.d/override.conf'), 4000)
    ollama_vulkan_override_ok = all(token in ollama_override for token in [
        'OLLAMA_VULKAN=1',
        'OLLAMA_IGPU_ENABLE=1',
        'AMD_VULKAN_ICD=RADV',
    ])
    ollama_status = _ollama_runtime_status()
    ollama_ok = bool(ollama_status['online'] and (ollama_status['gpu'] or ollama_vulkan_override_ok))
    ollama_detail = (
        f"Ollama online; GPU backend detected via {ollama_status['backend']}"
        if ollama_status['online'] and ollama_status['gpu']
        else 'Vulkan override present'
        if ollama_vulkan_override_ok
        else 'Ollama online but no GPU backend evidence found'
        if ollama_status['online']
        else 'Ollama is not reachable on 127.0.0.1:11434'
    )

    llama_extra = runtime.get('LLAMA_EXTRA_ARGS', '')
    llama_args = shlex.split(llama_extra) if llama_extra else []
    llama_arg_text = ' '.join(llama_args)
    llama_runtime_ok = (
        runtime.get('LLAMA_GPU_LAYERS') == '999'
        and int(runtime.get('LLAMA_CTX') or 0) >= 65536
        and '--flash-attn' in llama_args
        and '--device' in llama_args
    )

    current_cmd = ''
    pid_path = agent_manager.pid_file('llama')
    try:
        pid = int(pid_path.read_text().strip())
        current_cmd = _read_text(Path(f'/proc/{pid}/cmdline'), 16000).replace('\x00', ' ').strip()
    except Exception:
        current_cmd = ''

    items = [
        _ok_item(
            'Strix Halo hardware',
            'RYZEN AI MAX+ 395' in cpuinfo.upper() and (total_gb or 0) >= 90,
            f"{'Ryzen AI MAX+ 395 detected' if 'RYZEN AI MAX+ 395' in cpuinfo.upper() else 'CPU not confirmed'}; RAM visible: {total_gb or 'unknown'} GB",
            'Set BIOS UMA Frame Buffer to 512MB where available, or 2GB if that is your vendor minimum.',
        ),
        _ok_item(
            'Boot memory aperture',
            all(boot_params.values()),
            ', '.join(f"{key}: {'yes' if value else 'no'}" for key, value in boot_params.items()),
            'Add amdgpu.gttsize=131072 ttm.pages_limit=31457280 amdgpu.cwsr_enable=0 to the kernel command line, then reboot.',
        ),
        _ok_item(
            'AMDGPU module limits',
            modprobe_ok,
            'Configured' if modprobe_ok else 'Missing /etc/modprobe.d/amdgpu_llm_optimized.conf values',
            'Create amdgpu/ttm modprobe settings and rebuild initramfs.',
        ),
        _ok_item(
            'GPU access groups',
            group_ok,
            f"groups: {', '.join(sorted(group_names)) or 'unknown'}",
            'Add your user to render and video, then log out and back in.',
        ),
        _ok_item(
            'Performance governor',
            tuned_ok,
            tuned_output or 'tuned profile not active',
            'Use tuned accelerator-performance for long inference runs.',
        ),
        _ok_item(
            'Vulkan RADV path',
            radv_ok and radeon_icd,
            f"{mesa_text}; RADV ICD: {'present' if radeon_icd else 'missing'}; AMD ICD files: {', '.join(path.name for path in amdvlk_files) or 'none'}",
            'Prefer Mesa RADV for the guide baseline; avoid AMDVLK taking priority.',
        ),
        _ok_item(
            'Ollama GPU backend',
            ollama_ok,
            ollama_detail,
            'ROCm is preferred when Ollama detects ROCm0. Use the Vulkan/iGPU override only if Ollama falls back to CPU or ROCm breaks.',
        ),
        _ok_item(
            'llama-server profile',
            llama_runtime_ok,
            f"ctx={runtime.get('LLAMA_CTX')}; ngl={runtime.get('LLAMA_GPU_LAYERS')}; extra={llama_extra or '(none)'}",
            'Use full GPU offload, flash attention, explicit Vulkan0 device, and tuned batch/ubatch values.',
        ),
    ]

    commands = [
        {
            'title': 'Pop!_OS/systemd-boot kernel parameters',
            'command': 'sudo kernelstub -a "amdgpu.gttsize=131072 ttm.pages_limit=31457280 amdgpu.cwsr_enable=0"',
            'note': 'Use this when kernelstub is installed. Reboot after applying.',
        },
        {
            'title': 'GRUB kernel parameters',
            'command': 'sudo sed -i \'s|^GRUB_CMDLINE_LINUX_DEFAULT="\\(.*\\)"|GRUB_CMDLINE_LINUX_DEFAULT="\\1 amdgpu.gttsize=131072 ttm.pages_limit=31457280 amdgpu.cwsr_enable=0"|\' /etc/default/grub && sudo update-grub',
            'note': 'Use this only on GRUB systems after checking for duplicate parameters.',
        },
        {
            'title': 'AMDGPU module limits',
            'command': 'printf "%s\\n" "options amdgpu gttsize=122800" "options ttm pages_limit=31457280" "options ttm page_pool_size=31457280" | sudo tee /etc/modprobe.d/amdgpu_llm_optimized.conf && sudo update-initramfs -u -k all',
            'note': 'Reboot after applying.',
        },
        {
            'title': 'GPU permissions',
            'command': 'sudo usermod -aG render,video "$USER"',
            'note': 'Log out and back in after applying.',
        },
        {
            'title': 'Install tuned',
            'command': 'sudo apt install -y tuned && sudo systemctl enable --now tuned && sudo tuned-adm profile accelerator-performance',
            'note': 'Needed before the Performance tab can activate the accelerator-performance profile.',
        },
    ]

    return {
        'source': 'hogeheer499-commits/strix-halo-guide',
        'source_url': 'https://github.com/hogeheer499-commits/strix-halo-guide',
        'reviewed_at': datetime.now().isoformat(),
        'summary': {
            'ok': sum(1 for item in items if item['ok']),
            'total': len(items),
            'needs_reboot': not all(boot_params.values()) or not modprobe_ok,
        },
        'items': items,
        'runtime': {
            'config': {
                'LLAMA_CTX': runtime.get('LLAMA_CTX', ''),
                'LLAMA_GPU_LAYERS': runtime.get('LLAMA_GPU_LAYERS', ''),
                'LLAMA_EXTRA_ARGS': runtime.get('LLAMA_EXTRA_ARGS', ''),
                'LLAMA_MODEL': runtime.get('LLAMA_MODEL', ''),
                'LLAMA_HERETIC_MODEL': runtime.get('LLAMA_HERETIC_MODEL', ''),
            },
            'llama_version': _launcher_llama_version(runtime),
            'running_command': current_cmd,
        },
        'profiles': [
            {
                'id': 'single-user-vulkan',
                'name': 'Single User Vulkan Max',
                'description': 'Best default for one interactive chat, coding agent, or Studio LLM worker.',
                'settings': {
                    'LLAMA_CTX': '131072',
                    'LLAMA_GPU_LAYERS': '999',
                    'LLAMA_EXTRA_ARGS': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
                },
            },
            {
                'id': 'multi-user-vulkan',
                'name': 'Multi User Vulkan',
                'description': 'Keeps RADV but opens four slots for several local tools at lower per-slot context.',
                'settings': {
                    'LLAMA_CTX': '65536',
                    'LLAMA_GPU_LAYERS': '999',
                    'LLAMA_EXTRA_ARGS': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 4 --cont-batching',
                },
            },
        ],
        'commands': commands,
    }


@app.route('/api/performance/strix-halo')
def api_strix_halo_performance() -> jsonify:
    """Return Strix Halo performance tuning status and local recommendations."""
    return jsonify(strix_halo_performance_status())


@app.route('/api/performance/strix-halo/actions/<action>', methods=['POST'])
def api_strix_halo_performance_action(action: str) -> jsonify:
    """Apply safe performance actions that fit this local launcher."""
    if action == 'profile-single-user-vulkan':
        updates = {
            'LLAMA_CTX': '131072',
            'LLAMA_GPU_LAYERS': '999',
            'LLAMA_EXTRA_ARGS': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1',
        }
        _set_config_env_values(updates)
        return jsonify({'ok': True, 'message': 'Single-user Vulkan profile saved to config.env. Restart the LLM service to use it.', 'updates': updates})

    if action == 'profile-multi-user-vulkan':
        updates = {
            'LLAMA_CTX': '65536',
            'LLAMA_GPU_LAYERS': '999',
            'LLAMA_EXTRA_ARGS': '--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 4 --cont-batching',
        }
        _set_config_env_values(updates)
        return jsonify({'ok': True, 'message': 'Multi-user Vulkan profile saved to config.env. Restart the LLM service to use it.', 'updates': updates})

    if action == 'tuned-accelerator':
        if not shutil.which('tuned-adm'):
            return jsonify({
                'ok': False,
                'message': 'tuned-adm is not installed. Use the Install tuned command shown in the Performance tab, then refresh.',
                'returncode': 127,
                'output': 'tuned-adm not found',
            }), 400
        code, output = _run_text(['sudo', '-n', 'tuned-adm', 'profile', 'accelerator-performance'], timeout=20)
        ok = code == 0
        message = output or ('tuned accelerator-performance activated' if ok else 'Could not activate tuned without sudo credentials')
        return jsonify({'ok': ok, 'message': message, 'returncode': code, 'output': output}), 200 if ok else 400

    if action == 'ollama-vulkan':
        script = (
            'set -e; '
            'sudo -n mkdir -p /etc/systemd/system/ollama.service.d; '
            'printf "%s\\n" "[Service]" '
            '"Environment=\\"OLLAMA_VULKAN=1\\"" '
            '"Environment=\\"OLLAMA_IGPU_ENABLE=1\\"" '
            '"Environment=\\"HIP_VISIBLE_DEVICES=-1\\"" '
            '"Environment=\\"OLLAMA_FLASH_ATTENTION=1\\"" '
            '"Environment=\\"OLLAMA_CONTEXT_LENGTH=8192\\"" '
            '"Environment=\\"AMD_VULKAN_ICD=RADV\\"" '
            '"Environment=\\"VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/radeon_icd.json\\"" '
            '"Environment=\\"OLLAMA_NUM_BATCH=512\\"" '
            '"Environment=\\"OLLAMA_NUM_PARALLEL=1\\"" '
            '| sudo -n tee /etc/systemd/system/ollama.service.d/override.conf >/dev/null; '
            'sudo -n systemctl daemon-reload; '
            'sudo -n systemctl restart ollama'
        )
        code, output = _run_text(['bash', '-lc', script], timeout=30)
        ok = code == 0
        message = output or ('Ollama Vulkan override applied' if ok else 'Could not configure Ollama without sudo credentials')
        return jsonify({'ok': ok, 'message': message, 'returncode': code, 'output': output}), 200 if ok else 400

    return jsonify({'ok': False, 'message': f'Unknown performance action: {action}'}), 404


@app.route('/api/performance/models')
def api_performance_models() -> jsonify:
    """Return local LLM model inventory and active per-slot tuning."""
    return jsonify(model_tuning_status())


@app.route('/api/performance/models/slots/<slot>', methods=['POST'])
def api_performance_model_slot(slot: str) -> jsonify:
    """Save the selected model and tuning for a runtime slot."""
    status = model_tuning_status()
    if slot not in status['slots']:
        return jsonify({'ok': False, 'message': f'Unknown model slot: {slot}'}), 404

    payload = request.get_json(silent=True) or {}
    ok, message, updates, code = _save_model_slot(slot, payload)
    if not ok:
        return jsonify({'ok': False, 'message': message}), code
    return jsonify({
        'ok': True,
        'message': f'{status["slots"][slot]["label"]} saved. Restart that service to load the new model/tuning.',
        'updates': updates,
    })


@app.route('/api/performance/models/optimize-active', methods=['POST'])
def api_performance_models_optimize_active() -> jsonify:
    """Apply inferred Strix Halo serving args to the currently configured model slots."""
    runtime = _runtime_config()
    models = _local_llm_models(runtime)
    changed: Dict[str, Dict[str, str]] = {}
    skipped: Dict[str, str] = {}

    active_paths = {
        'main': runtime.get('LLAMA_MODEL', ''),
        'heretic': runtime.get('LLAMA_HERETIC_MODEL', ''),
        'heretic27': runtime.get('LLAMA_HERETIC27_MODEL', ''),
        'sidecar': runtime.get('QWEN_SIDECAR_MODEL', ''),
    }
    for slot, model_path in active_paths.items():
        local = _find_local_model_by_path(models, model_path)
        if not local:
            skipped[slot] = 'No matching installed GGUF found for the configured path.'
            continue
        if local.get('recommended_slot') == 'projector':
            skipped[slot] = 'Projector files are not standalone LLMs.'
            continue

        payload = {
            'model': local['path'],
            'alias': local['alias'],
            'ctx': local.get('recommended_ctx', ''),
            'gpu_layers': local.get('recommended_gpu_layers', ''),
            'extra_args': local.get('recommended_extra_args', ''),
            'reasoning': runtime.get('QWEN_SIDECAR_REASONING', 'off'),
        }
        ok, message, updates, _code = _save_model_slot(slot, payload)
        if ok:
            changed[slot] = updates
        else:
            skipped[slot] = message

    return jsonify({
        'ok': bool(changed),
        'message': 'Applied recommended serving tuning to active installed models.' if changed else 'No active installed model slots were optimized.',
        'changed': changed,
        'skipped': skipped,
        'restart_required': bool(changed),
    }), 200 if changed else 400


@app.route('/api/performance/tasks/<task_id>/switch', methods=['POST'])
def api_performance_task_switch(task_id: str) -> jsonify:
    """Switch the recommended runtime slot to the best installed model for a task."""
    status = model_tuning_status()
    profile = next((item for item in status.get('task_profiles', []) if item.get('id') == task_id), None)
    if not profile:
        return jsonify({'ok': False, 'message': f'Unknown task profile: {task_id}'}), 404

    body = request.get_json(silent=True) or {}
    slot = str(body.get('slot') or profile.get('slot') or 'main')
    candidates = profile.get('candidates') or []
    model_path = str(body.get('model') or (candidates[0].get('path') if candidates else '')).strip()
    model = _find_local_model_by_path(status.get('models', []), model_path)
    if not model:
        return jsonify({'ok': False, 'message': f'No installed model is available for {profile.get("name", task_id)}.'}), 400
    if slot not in MODEL_SLOT_SPECS:
        return jsonify({'ok': False, 'message': f'Unknown model slot: {slot}'}), 404

    payload = {
        'model': model['path'],
        'alias': model.get('alias', ''),
        'ctx': model.get('recommended_ctx', ''),
        'gpu_layers': model.get('recommended_gpu_layers', ''),
        'extra_args': model.get('recommended_extra_args', ''),
        'reasoning': _runtime_config().get('QWEN_SIDECAR_REASONING', 'off'),
    }
    ok, message, updates, code = _save_model_slot(slot, payload)
    if not ok:
        return jsonify({'ok': False, 'message': message}), code

    restart_command = MODEL_SLOT_SPECS[slot]['restart_command']
    if slot == 'sidecar':
        stop_code, stop_output = run_service_command('qwen-sidecar-stop', timeout=60)
        start_code, start_output = run_service_command('qwen-sidecar', timeout=180)
        command_output = f"{stop_output}\n{start_output}".strip()
        returncode = start_code if start_code != 0 else stop_code
    else:
        returncode, command_output = run_service_command(restart_command, timeout=240)

    ok = returncode == 0
    return jsonify({
        'ok': ok,
        'message': f"{'Switched' if ok else 'Saved but restart failed'} {slot} to {model.get('alias')} for {profile.get('name')}.",
        'task': profile,
        'model': model,
        'slot': slot,
        'updates': updates,
        'command': restart_command,
        'returncode': returncode,
        'output': command_output,
    }), 200 if ok else 400


@app.route('/api/performance/models/switch/<slot>', methods=['POST'])
def api_performance_model_switch(slot: str) -> jsonify:
    """Save model/tuning for a slot and restart the matching runtime."""
    payload = request.get_json(silent=True) or {}
    ok, message, updates, code = _save_model_slot(slot, payload)
    if not ok:
        return jsonify({'ok': False, 'message': message}), code

    restart_command = MODEL_SLOT_SPECS[slot]['restart_command']
    if slot == 'sidecar':
        stop_code, stop_output = run_service_command('qwen-sidecar-stop', timeout=60)
        start_code, start_output = run_service_command('qwen-sidecar', timeout=180)
        command_output = f"{stop_output}\n{start_output}".strip()
        returncode = start_code if start_code != 0 else stop_code
    else:
        returncode, command_output = run_service_command(restart_command, timeout=240)

    ok = returncode == 0
    return jsonify({
        'ok': ok,
        'message': f"{'Switched' if ok else 'Saved but restart failed'} {slot} model/tuning.",
        'updates': updates,
        'command': restart_command,
        'returncode': returncode,
        'output': command_output,
    }), 200 if ok else 400


def main() -> None:
    parser = argparse.ArgumentParser(description="Agent Suite console (Runtime + Performance).")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=39019)
    args = parser.parse_args()
    app.run(host=args.host, port=args.port, threaded=True)


if __name__ == '__main__':
    main()
