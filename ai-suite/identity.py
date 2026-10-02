"""Resolves "who is making this Studio request" for per-user data partitioning
(chat history, generated-image library).

Two possible outcomes:
1. A signed X-Hearth-User header from a trusted reverse proxy - verified via HMAC so a client
   hitting Studio directly on the LAN can't just claim to be someone else. This
   is the only source of a real identity: WordPress login is what "automatic"
   identification means here, since browsers stay signed in there across visits.
2. "guest" - anything not proxied through a verified login (direct
   LAN access, the standalone hilbert_chat.py service on port 39004, etc.) is
   always guest. There is deliberately no manual "pick who you are" override:
   that would be a client-asserted, spoofable identity.
"""

import hmac
import hashlib
import re
import time
from typing import Any, Dict

SAFE_NAME = re.compile(r"[^a-zA-Z0-9_.-]+")
GUEST = "guest"
SIGNATURE_WINDOW_SECONDS = 300


def _runtime_config() -> Dict[str, str]:
    try:
        from ai_manager import load_config
        return load_config()
    except Exception:
        return {}


def _auth_secret() -> str:
    import os
    return _runtime_config().get('HEARTH_STUDIO_AUTH_SECRET') or os.environ.get('HEARTH_STUDIO_AUTH_SECRET') or ''


def slug(name: str) -> str:
    """Filesystem/URL-safe identity slug, matching hilbert_chat.py's existing
    SAFE_NAME convention."""
    cleaned = SAFE_NAME.sub("", str(name or "").strip())
    return cleaned or GUEST


def _verify_signature(user_login: str, timestamp: str, signature: str) -> bool:
    secret = _auth_secret()
    if not secret or not user_login or not timestamp or not signature:
        return False
    try:
        ts = int(timestamp)
    except ValueError:
        return False
    if abs(time.time() - ts) > SIGNATURE_WINDOW_SECONDS:
        return False
    expected = hmac.new(
        secret.encode('utf-8'),
        f"{user_login}|{timestamp}".encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def resolve_identity(request) -> Dict[str, Any]:
    """`request` is a Flask request object."""
    wp_user = request.headers.get('X-Hearth-User', '')
    wp_ts = request.headers.get('X-Hearth-Timestamp', '')
    wp_sig = request.headers.get('X-Hearth-Signature', '')
    if _verify_signature(wp_user, wp_ts, wp_sig):
        display_name = request.headers.get('X-Hearth-User-Display', wp_user)
        return {'user': slug(wp_user), 'display_name': display_name, 'source': 'wp'}

    return {'user': GUEST, 'display_name': 'Guest', 'source': 'guest'}
