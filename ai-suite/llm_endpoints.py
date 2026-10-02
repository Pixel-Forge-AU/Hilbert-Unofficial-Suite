"""Shared OpenAI-compatible chat-LLM endpoint selection, used by both Studio
(launcher.py, for the Suite Chat tab and LLM-orchestration pack workflows)
and the standalone Ask Echo service (hilbert_chat.py), so both pick the same
way and stay in sync - previously hilbert_chat.py talked to a single
hardcoded host:port (whatever local LLM profile it was started with), which
meant it had no fallback and no awareness of a configured LLM_ENDPOINTS
network box, unlike Studio's own chat.

Priority order: LLM_ENDPOINTS entries (e.g. a dedicated inference box) first,
then the always-on qwen-sidecar, then the main local LLM, then Ollama.
"""

import json
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional


def _connect_host(host: Any) -> str:
    host = str(host or '127.0.0.1')
    return '127.0.0.1' if host in ('0.0.0.0', '::') else host


def _chat_url(base: str) -> str:
    base = base.strip().rstrip('/')
    if base.endswith('/chat/completions'):
        return base
    if base.endswith('/v1'):
        return f'{base}/chat/completions'
    return f'{base}/v1/chat/completions'


def endpoint_models_url(chat_url: str) -> str:
    """Return the companion /models URL for an OpenAI-compatible chat URL."""
    url = chat_url.rstrip('/')
    if url.endswith('/chat/completions'):
        return url[: -len('/chat/completions')] + '/models'
    if url.endswith('/v1'):
        return f'{url}/models'
    return f'{url}/v1/models'


def endpoint_candidates(runtime_config: Dict[str, Any], requested_model: str = '') -> List[Dict[str, str]]:
    """Build ordered OpenAI-compatible LLM endpoint candidates."""
    candidates: List[Dict[str, str]] = []

    for index, entry in enumerate(str(runtime_config.get('LLM_ENDPOINTS') or '').split(','), start=1):
        entry = entry.strip()
        if not entry:
            continue
        if '|' in entry:
            base, model = entry.split('|', 1)
        else:
            base, model = entry, requested_model
        candidates.append({
            'name': f'network-{index}',
            'url': _chat_url(base),
            'model': (model or requested_model or runtime_config.get('LLAMA_ALIAS') or 'local-llama').strip(),
        })

    sidecar_model = requested_model or runtime_config.get('QWEN_SIDECAR_ALIAS') or 'qwen-sidecar'
    candidates.append({
        'name': 'qwen-sidecar',
        'url': _chat_url(f"http://{_connect_host(runtime_config.get('QWEN_SIDECAR_HOST', '127.0.0.1'))}:{runtime_config.get('QWEN_SIDECAR_PORT', '39002')}"),
        'model': str(sidecar_model),
    })
    main_model = requested_model or runtime_config.get('LLAMA_ALIAS') or 'local-llama'
    candidates.append({
        'name': 'llama',
        'url': _chat_url(f"http://{_connect_host(runtime_config.get('LLAMA_HOST', '127.0.0.1'))}:{runtime_config.get('LLAMA_PORT', '39001')}"),
        'model': str(main_model),
    })
    ollama_model = requested_model or runtime_config.get('OLLAMA_MODEL') or ''
    if ollama_model:
        candidates.append({
            'name': 'ollama',
            'url': _chat_url(f"http://{_connect_host(runtime_config.get('OLLAMA_HOST', '127.0.0.1'))}:{runtime_config.get('OLLAMA_PORT', '11434')}"),
            'model': str(ollama_model),
        })
    return candidates


def available_models_for_endpoint(endpoint: Dict[str, str], timeout: float = 3.0) -> List[str]:
    try:
        with urllib.request.urlopen(endpoint_models_url(endpoint['url']), timeout=timeout) as response:
            data = json.loads(response.read())
        if isinstance(data, dict) and isinstance(data.get('data'), list):
            return [str(item.get('id') or item.get('name') or '') for item in data['data'] if isinstance(item, dict)]
        if isinstance(data, list):
            return [str(item.get('id') or item.get('name') or '') for item in data if isinstance(item, dict)]
    except Exception:
        return []
    return []


def select_chat_endpoint(runtime_config: Dict[str, Any], model: Optional[str] = None) -> Optional[Dict[str, str]]:
    requested = str(model or '').strip()
    first_online = None
    for endpoint in endpoint_candidates(runtime_config, requested):
        models = [item for item in available_models_for_endpoint(endpoint) if item]
        if not models:
            continue
        candidate = dict(endpoint)
        if requested and requested in models:
            candidate['model'] = requested
            return candidate
        if first_online is None:
            candidate['model'] = requested or endpoint.get('model') or models[0]
            first_online = candidate
    return first_online


def available_models(runtime_config: Dict[str, Any]) -> List[str]:
    seen = set()
    models = []
    for endpoint in endpoint_candidates(runtime_config):
        for model in available_models_for_endpoint(endpoint):
            if model and model not in seen:
                seen.add(model)
                models.append(model)
    return models


def chat_completion(runtime_config: Dict[str, Any], messages: List[Dict[str, str]], model: Optional[str] = None, timeout: int = 600) -> str:
    endpoint = select_chat_endpoint(runtime_config, model)
    if not endpoint:
        raise RuntimeError('No local chat endpoint is online. Start Coding LLM, Sidecar, or Ollama.')
    body = json.dumps({
        'model': model or endpoint['model'],
        'messages': messages,
        'temperature': 0.6,
        'top_p': 0.9,
        'max_tokens': 2048,
    }).encode('utf-8')
    request = urllib.request.Request(
        endpoint['url'],
        data=body,
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer sk-local'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', 'replace')
        raise RuntimeError(f"{endpoint['name']} returned HTTP {exc.code}: {detail}") from exc
    return payload['choices'][0]['message']['content']
