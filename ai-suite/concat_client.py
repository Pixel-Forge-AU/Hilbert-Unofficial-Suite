"""Client for the Concat video engine's JSON-RPC API (`concat-cli serve`).

Concat is a separate AGPL-licensed program; this module only speaks its
documented socket API (https://concatenate.pages.dev/docs/transports/json-rpc/)
and shares no code with it.

One `ConcatClient` owns one connection: a reader thread matches responses to
calls by `id` and hands id-less lines (events such as `export.progress`) to an
event callback, since events can arrive between a call and its response. A
dropped connection fails every pending call with `ConcatUnavailable`; the next
call reconnects. Every call has a timeout, so a wedged engine cannot hold a
Flask request thread forever.
"""

import itertools
import json
import os
import socket
import threading
from typing import Any, Callable, Dict, Optional

DEFAULT_TIMEOUT = 30.0
CONNECT_TIMEOUT = 5.0


class ConcatError(Exception):
    """An error reply from Concat. `code` is the API's name for it
    (`notOpen`, `refused`, `busy`, `notFound`, `cancelled`, `failed`, ...)."""

    def __init__(self, code: str, message: str, number: Optional[int] = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.number = number


class ConcatUnavailable(ConcatError):
    """The engine could not be reached, or the connection dropped mid-call."""

    def __init__(self, message: str):
        super().__init__('unavailable', message)


class _Pending:
    __slots__ = ('event', 'result', 'error')

    def __init__(self):
        self.event = threading.Event()
        self.result: Any = None
        self.error: Optional[ConcatError] = None


class ConcatClient:
    """Thread-safe JSON-RPC client over a Unix socket or TCP address."""

    def __init__(self, address: str, token: str,
                 on_event: Optional[Callable[[str, Dict[str, Any]], None]] = None):
        # A path is a Unix socket; "host:port" is TCP.
        self.address = address
        self.token = token
        self.on_event = on_event
        self._lock = threading.Lock()          # guards connection state and writes
        self._sock: Optional[socket.socket] = None
        self._pending: Dict[int, _Pending] = {}
        self._ids = itertools.count(1)
        self._generation = 0

    # -- connection -----------------------------------------------------

    def _open_socket(self) -> socket.socket:
        if os.sep in self.address or self.address.endswith('.sock'):
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            target: Any = self.address
        else:
            host, _, port = self.address.rpartition(':')
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            target = (host or '127.0.0.1', int(port))
        sock.settimeout(CONNECT_TIMEOUT)
        try:
            sock.connect(target)
        except OSError:
            sock.close()
            raise
        return sock

    def _connect_locked(self) -> None:
        try:
            sock = self._open_socket()
        except OSError as exc:
            raise ConcatUnavailable(f'Concat engine is not reachable ({exc.strerror or exc})') from None
        try:
            # The first line must be the transport's auth call.
            sock.sendall((json.dumps({'jsonrpc': '2.0', 'id': 0, 'method': 'auth',
                                      'params': {'token': self.token}}) + '\n').encode())
            reader = sock.makefile('rb')
            line = reader.readline()
            reply = json.loads(line) if line else None
        except (OSError, ValueError) as exc:
            sock.close()
            raise ConcatUnavailable(f'Concat engine handshake failed ({exc})') from None
        if not reply or 'error' in reply:
            sock.close()
            raise ConcatUnavailable('Concat engine rejected the API token')
        sock.settimeout(None)
        self._sock = sock
        self._generation += 1
        threading.Thread(target=self._read_loop, args=(sock, reader, self._generation),
                         name='concat-reader', daemon=True).start()

    def _read_loop(self, sock: socket.socket, reader, generation: int) -> None:
        try:
            for line in reader:
                if not line.strip():
                    continue
                try:
                    message = json.loads(line)
                except ValueError:
                    continue
                if 'id' not in message:
                    self._dispatch_event(message)
                    continue
                with self._lock:
                    pending = self._pending.pop(message.get('id'), None)
                if pending is None:
                    continue
                if 'error' in message:
                    error = message['error'] or {}
                    data = error.get('data') or {}
                    pending.error = ConcatError(str(data.get('code') or 'failed'),
                                                str(error.get('message') or 'Concat error'),
                                                error.get('code'))
                else:
                    pending.result = message.get('result')
                pending.event.set()
        except (OSError, ValueError):
            pass
        finally:
            self._drop(sock, generation, 'Concat engine connection closed')

    def _dispatch_event(self, message: Dict[str, Any]) -> None:
        if not self.on_event:
            return
        try:
            self.on_event(str(message.get('method') or ''), message.get('params') or {})
        except Exception:
            # An event handler bug must not kill the reader thread.
            pass

    def _drop(self, sock: socket.socket, generation: int, reason: str) -> None:
        with self._lock:
            if generation != self._generation or self._sock is not sock:
                return
            self._sock = None
            pending, self._pending = self._pending, {}
        try:
            sock.close()
        except OSError:
            pass
        for item in pending.values():
            item.error = ConcatUnavailable(reason)
            item.event.set()

    def close(self) -> None:
        with self._lock:
            sock, generation = self._sock, self._generation
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self._drop(sock, generation, 'Concat client closed')

    @property
    def connected(self) -> bool:
        return self._sock is not None

    # -- calls ----------------------------------------------------------

    def call(self, method: str, params: Optional[Dict[str, Any]] = None,
             timeout: float = DEFAULT_TIMEOUT) -> Any:
        pending = _Pending()
        with self._lock:
            if self._sock is None:
                self._connect_locked()
            rid = next(self._ids)
            self._pending[rid] = pending
            message = {'jsonrpc': '2.0', 'id': rid, 'method': method}
            if params:
                message['params'] = params
            sock, generation = self._sock, self._generation
            try:
                sock.sendall((json.dumps(message) + '\n').encode())
            except OSError as exc:
                self._pending.pop(rid, None)
                failed = exc
            else:
                failed = None
        if failed is not None:
            self._drop(sock, generation, f'Concat engine connection failed ({failed})')
            raise ConcatUnavailable(f'Concat engine connection failed ({failed})')
        if not pending.event.wait(timeout):
            with self._lock:
                self._pending.pop(rid, None)
            raise ConcatUnavailable(f'Concat engine did not answer {method} within {timeout:g}s')
        if pending.error is not None:
            raise pending.error
        return pending.result
