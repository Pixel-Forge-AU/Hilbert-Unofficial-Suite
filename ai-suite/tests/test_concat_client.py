import json
import socket
import sys
import threading
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from concat_client import ConcatClient, ConcatError, ConcatUnavailable


class FakeServer:
    """A Concat-shaped JSON-RPC line server on a Unix socket. `handler`
    gets (connection file, request) and writes whatever lines it likes."""

    def __init__(self, path, handler, token='secret'):
        self.path = str(path)
        self.handler = handler
        self.token = token
        self.connections = 0
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.bind(self.path)
        self.sock.listen()
        self.live = []
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            self.connections += 1
            self.live.append(conn)
            threading.Thread(target=self._serve, args=(conn,), daemon=True).start()

    def _serve(self, conn):
        f = conn.makefile('rwb')
        auth = json.loads(f.readline())
        if auth.get('params', {}).get('token') != self.token:
            f.write(b'{"jsonrpc":"2.0","id":0,"error":{"code":-32006,"message":"wrong token","data":{"code":"unauthorized"}}}\n')
            f.flush()
            conn.close()
            return
        f.write(b'{"jsonrpc":"2.0","id":0,"result":{}}\n')
        f.flush()
        for line in f:
            self.handler(f, json.loads(line))
            f.flush()

    def drop_all(self):
        for conn in self.live:
            try:
                conn.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
        self.live.clear()

    def close(self):
        self.sock.close()


def reply(f, rid, result):
    f.write((json.dumps({'jsonrpc': '2.0', 'id': rid, 'result': result}) + '\n').encode())


def test_events_between_call_and_response_are_dispatched(tmp_path):
    def handler(f, req):
        # An event for an earlier job lands before this call's response.
        f.write(b'{"jsonrpc":"2.0","method":"export.progress","params":{"job":"j1","frame":3,"total":9}}\n')
        reply(f, req['id'], {'method': req['method']})

    server = FakeServer(tmp_path / 's.sock', handler)
    events = []
    client = ConcatClient(server.path, 'secret', on_event=lambda name, params: events.append((name, params)))
    assert client.call('version') == {'method': 'version'}
    assert client.call('project.list') == {'method': 'project.list'}
    assert events[0] == ('export.progress', {'job': 'j1', 'frame': 3, 'total': 9})
    assert len(events) == 2
    client.close()
    server.close()


def test_concurrent_calls_are_matched_by_id(tmp_path):
    held = []
    lock = threading.Lock()

    def handler(f, req):
        # Answer in reverse order once two calls have arrived.
        with lock:
            held.append(req)
            if len(held) == 2:
                for r in reversed(held):
                    reply(f, r['id'], {'echo': r['params']['n']})

    server = FakeServer(tmp_path / 's.sock', handler)
    client = ConcatClient(server.path, 'secret')
    results = {}

    def go(n):
        results[n] = client.call('x', {'n': n}, timeout=5)

    threads = [threading.Thread(target=go, args=(n,)) for n in (1, 2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results == {1: {'echo': 1}, 2: {'echo': 2}}
    client.close()
    server.close()


def test_error_reply_carries_api_code(tmp_path):
    def handler(f, req):
        f.write((json.dumps({'jsonrpc': '2.0', 'id': req['id'], 'error': {
            'code': -32004, 'message': 'a export is already running', 'data': {'code': 'busy'}}}) + '\n').encode())

    server = FakeServer(tmp_path / 's.sock', handler)
    client = ConcatClient(server.path, 'secret')
    with pytest.raises(ConcatError) as info:
        client.call('export.run')
    assert info.value.code == 'busy'
    assert info.value.number == -32004
    client.close()
    server.close()


def test_wrong_token_is_unavailable(tmp_path):
    server = FakeServer(tmp_path / 's.sock', lambda f, req: None, token='right')
    client = ConcatClient(server.path, 'wrong')
    with pytest.raises(ConcatUnavailable):
        client.call('version')
    server.close()


def test_missing_socket_is_unavailable(tmp_path):
    client = ConcatClient(str(tmp_path / 'absent.sock'), 'secret')
    with pytest.raises(ConcatUnavailable):
        client.call('version')


def test_dropped_connection_fails_pending_call_then_reconnects(tmp_path):
    state = {'drop': True}

    def handler(f, req):
        if state['drop']:
            state['drop'] = False
            server.drop_all()
            return
        reply(f, req['id'], 'ok')

    server = FakeServer(tmp_path / 's.sock', handler)
    client = ConcatClient(server.path, 'secret')
    with pytest.raises(ConcatUnavailable):
        client.call('version', timeout=5)
    assert client.call('version', timeout=5) == 'ok'
    assert server.connections == 2
    client.close()
    server.close()


def test_unanswered_call_times_out(tmp_path):
    server = FakeServer(tmp_path / 's.sock', lambda f, req: None)
    client = ConcatClient(server.path, 'secret')
    with pytest.raises(ConcatUnavailable, match='did not answer'):
        client.call('preview.frame', timeout=0.3)
    client.close()
    server.close()
