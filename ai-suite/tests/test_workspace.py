"""Workspace blueprint: identity isolation, path checks and scrubbing,
against an in-memory stand-in for the Concat engine."""

import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import launcher
import workspace
from workspace import WorkspaceError


class FakeEngine:
    """Just enough of Concat's project model to exercise the routes."""

    def __init__(self, staging=None):
        self.open = {}
        self.calls = []
        self.staging = staging

    def __call__(self, method, params=None, *, user='', project=None, timeout=30.0):
        params = params or {}
        self.calls.append((method, params))
        path = params.get('path')
        if method == 'project.create':
            folder = Path(params['location']) / params['name']
            folder.mkdir(parents=True)
            doc = {'name': params['name'], 'media': [], 'timelines': [
                {'id': 'TL1', 'tracks': [{'id': 'T1'}, {'id': 'T2'}], 'clips': []}],
                'activeTimelineId': 'TL1'}
            (folder / 'concat.json').write_text(json.dumps(doc))
            self.open[str(folder)] = doc
            return self._view(str(folder))
        if method in ('project.open', 'project.get'):
            if path not in self.open:
                self.open[path] = json.loads((Path(path) / 'concat.json').read_text())
            return self._view(path)
        if method == 'project.save':
            if params.get('name'):
                self.open[path]['name'] = params['name']
            (Path(path) / 'concat.json').write_text(json.dumps(self.open[path]))
            return {}
        if method == 'project.document':
            return self.open[path]
        if method == 'project.close':
            self.open.pop(path, None)
            return {}
        if method == 'media.import':
            doc = self.open[path]
            doc['media'].append({'id': f"m{len(doc['media']) + 1}", 'kind': 'video',
                                 'name': Path(params['file']).name, 'path': params['file']})
            return self._view(path)
        if method == 'edit.undo':
            return self._view(path)
        if method == 'preview.frame':
            return {'png': '', 'width': 16, 'height': 16}
        if method == 'template.save':
            bundle = Path(self.staging) / params['name']
            bundle.mkdir(parents=True)
            (bundle / 'template.json').write_text(json.dumps(self.open[path]))
            slots = [{'mediaId': m['id'], 'name': m['name'], 'kind': 'video', 'seconds': 1.0}
                     for m in self.open[path]['media'] if m.get('placeholder')]
            return {'path': str(bundle), 'width': 1920, 'height': 1080, 'rateNum': 30, 'rateDen': 1, 'slots': slots}
        if method == 'template.instantiate':
            folder = Path(params['location']) / params['name']
            folder.mkdir(parents=True)
            doc = json.loads((Path(params['template']) / 'template.json').read_text())
            for fill in params['fills']:
                for item in doc['media']:
                    if item['id'] == fill['mediaId']:
                        item.update(path=fill['file'], placeholder=False)
            (folder / 'concat.json').write_text(json.dumps(doc))
            self.open[str(folder)] = doc
            return self._view(str(folder))
        if method == 'catalogue.list':
            return {
                'transition': [{'id': 'concat.dissolve', 'params': []}],
                'effect': [{'id': 'concat.vignette', 'params': [{'key': 'amount'}]}],
                'filter': [{'id': 'concat.mono', 'params': []}],
                'audio': [{'id': 'concat.echo', 'params': [{'key': 'delay'}]}],
            }[params['kind']]
        if method == 'edit.apply':
            command = params['command']
            if command['op'] == 'batch':
                for inner in command['commands']:
                    if inner['op'] == 'setMediaPlaceholder':
                        for item in self.open[path]['media']:
                            if item['id'] == inner['mediaId']:
                                item['placeholder'] = inner['placeholder']
                return self._view(path)
            if command['op'] == 'updateMediaPath':
                for item in self.open[path]['media']:
                    if item['id'] == command['mediaId']:
                        item['path'] = command['newPath']
                return self._view(path)
            if command['op'] == 'updateClip':
                for clip in self.open[path]['timelines'][0]['clips']:
                    if clip['id'] == command['clipId']:
                        clip.update(command['patch'])
                return self._view(path)
            if command['op'] == 'addClip':
                doc = self.open[path]
                doc['timelines'][0]['clips'].append({'id': 'c1', 'mediaId': command['mediaId'],
                                                     'trackId': command['trackId'], 'start': command['start']})
            return {**self._view(path), 'createdId': 'c1'}
        raise AssertionError(f'unexpected engine call {method}')

    def _view(self, path):
        doc = json.loads(json.dumps(self.open[path]))
        return {'project': doc, 'canUndo': False, 'canRedo': False,
                'settings': {'name': doc['name'], 'width': 1920, 'height': 1080}}


@pytest.fixture
def env(tmp_path, monkeypatch):
    comfy = tmp_path / 'ComfyUI'
    (comfy / 'output' / 'studio' / 'alice' / 'video').mkdir(parents=True)
    (comfy / 'output' / 'studio' / 'bob' / 'video').mkdir(parents=True)
    (comfy / 'input').mkdir(parents=True)
    (comfy / 'output' / 'studio' / 'alice' / 'video' / 'a.mp4').write_bytes(b'alice-video')
    (comfy / 'output' / 'studio' / 'bob' / 'video' / 'b.mp4').write_bytes(b'bob-video')
    (comfy / 'output' / 'shared.mp4').write_bytes(b'shared')
    (tmp_path / 'secret.mp4').write_bytes(b'outside')
    os.symlink(tmp_path / 'secret.mp4', comfy / 'output' / 'link.mp4')
    monkeypatch.setenv('COMFYUI_DIR', str(comfy))
    monkeypatch.setenv('WORKSPACE_DATA_DIR', str(tmp_path / 'ws'))
    monkeypatch.setattr(workspace, '_config', lambda: {})
    monkeypatch.setattr(workspace, 'resolve_identity',
                        lambda req: {'user': req.headers.get('X-Test-User', 'guest')})
    engine = FakeEngine(staging=tmp_path / 'concat-config' / 'templates')
    monkeypatch.setattr(workspace, '_call', engine)
    client = launcher.app.test_client()
    return client, engine, tmp_path


def as_user(user):
    return {'X-Test-User': user}


def create(client, user, name='Cut'):
    response = client.post('/api/workspace/projects', json={'name': name}, headers=as_user(user))
    assert response.status_code == 201, response.get_json()
    return response.get_json()['id']


def test_project_is_created_in_the_callers_folder_and_listed_only_for_them(env):
    client, engine, tmp = env
    pid = create(client, 'alice', 'Holiday cut')
    assert (tmp / 'ws' / 'projects' / 'alice' / pid / 'concat.json').is_file()
    mine = client.get('/api/workspace/projects', headers=as_user('alice')).get_json()['projects']
    assert [(p['id'], p['name']) for p in mine] == [(pid, 'Holiday cut')]
    assert client.get('/api/workspace/projects', headers=as_user('bob')).get_json()['projects'] == []


def test_other_identity_cannot_open_import_edit_frame_or_delete(env):
    client, _, _ = env
    pid = create(client, 'alice')
    bob = as_user('bob')
    assert client.get(f'/api/workspace/projects/{pid}', headers=bob).status_code == 404
    assert client.post(f'/api/workspace/projects/{pid}/import', json={'path': 'shared.mp4'},
                       headers=bob).status_code == 404
    assert client.post(f'/api/workspace/projects/{pid}/edit', json={'command': {'op': 'addTrack'}},
                       headers=bob).status_code == 404
    assert client.get(f'/api/workspace/projects/{pid}/frame', headers=bob).status_code == 404
    assert client.post(f'/api/workspace/projects/{pid}/export', json={}, headers=bob).status_code == 404
    assert client.delete(f'/api/workspace/projects/{pid}', headers=bob).status_code == 404


@pytest.mark.parametrize('project_id', ['../alice', 'p-zzzzzzzzzzzz', '..', 'p-0123456789ab/..'])
def test_malformed_project_ids_are_not_found(env, project_id):
    client, _, _ = env
    response = client.get(f'/api/workspace/projects/{project_id}', headers=as_user('alice'))
    assert response.status_code == 404


def test_import_own_and_shared_output_but_not_another_users(env):
    client, engine, _ = env
    pid = create(client, 'alice')
    alice = as_user('alice')
    ok = client.post(f'/api/workspace/projects/{pid}/import',
                     json={'source': 'output', 'path': 'studio/alice/video/a.mp4'}, headers=alice)
    assert ok.status_code == 200
    assert client.post(f'/api/workspace/projects/{pid}/import',
                       json={'path': 'shared.mp4'}, headers=alice).status_code == 200
    denied = client.post(f'/api/workspace/projects/{pid}/import',
                         json={'path': 'studio/bob/video/b.mp4'}, headers=alice)
    assert denied.status_code == 404
    imported = [p['file'] for m, p in engine.calls if m == 'media.import']
    assert all('bob' not in f for f in imported)


@pytest.mark.parametrize('body', [
    {'path': '../secret.mp4'},
    {'path': '/etc/passwd'},
    {'path': 'link.mp4'},                      # symlink out of the Library
    {'source': 'anywhere', 'path': 'shared.mp4'},
    {'path': ''},
])
def test_import_rejects_traversal_symlinks_and_raw_paths(env, body):
    client, engine, _ = env
    pid = create(client, 'alice')
    response = client.post(f'/api/workspace/projects/{pid}/import', json=body, headers=as_user('alice'))
    assert response.status_code in (400, 404)
    assert not [c for c in engine.calls if c[0] == 'media.import']


def test_views_contain_no_absolute_paths(env):
    client, _, tmp = env
    pid = create(client, 'alice')
    response = client.post(f'/api/workspace/projects/{pid}/import',
                           json={'path': 'studio/alice/video/a.mp4'}, headers=as_user('alice'))
    body = response.get_data(as_text=True)
    assert str(tmp) not in body
    media = response.get_json()['project']['media'][0]
    assert media['source'] == {'kind': 'output', 'path': 'studio/alice/video/a.mp4'}
    assert 'path' not in media
    assert media['url'] == f'/api/workspace/projects/{pid}/media/m1'


def test_edit_allowlist_blocks_path_carrying_commands(env):
    client, engine, _ = env
    pid = create(client, 'alice')
    for op in ('addMedia', 'updateMediaPath', 'replaceClipMedia', 'addFont', None):
        response = client.post(f'/api/workspace/projects/{pid}/edit',
                               json={'command': {'op': op, 'path': '/etc/passwd'}}, headers=as_user('alice'))
        assert response.status_code == 400
    assert not [c for c in engine.calls if c[0] == 'edit.apply']


def test_edit_reports_whether_anything_changed(env):
    client, _, _ = env
    pid = create(client, 'alice')
    alice = as_user('alice')
    client.post(f'/api/workspace/projects/{pid}/import', json={'path': 'shared.mp4'}, headers=alice)
    added = client.post(f'/api/workspace/projects/{pid}/edit', json={'command': {
        'op': 'addClip', 'mediaId': 'm1', 'trackId': 'T1', 'start': 0}}, headers=alice).get_json()
    assert added['changed'] is True and added['dirty'] is True
    noop = client.post(f'/api/workspace/projects/{pid}/edit', json={'command': {
        'op': 'moveClips', 'moves': []}}, headers=alice).get_json()
    assert noop['changed'] is False


def test_upload_lands_in_the_project_and_rejects_non_media(env):
    client, _, tmp = env
    import io
    pid = create(client, 'alice')
    alice = as_user('alice')
    ok = client.post(f'/api/workspace/projects/{pid}/upload', headers=alice,
                     data={'file': (io.BytesIO(b'vid'), '../../evil name.mp4')},
                     content_type='multipart/form-data')
    assert ok.status_code == 200
    assert (tmp / 'ws' / 'projects' / 'alice' / pid / 'media' / 'evil_name.mp4').is_file()
    assert ok.get_json()['project']['media'][0]['source'] == {'kind': 'upload', 'name': 'evil_name.mp4'}
    bad = client.post(f'/api/workspace/projects/{pid}/upload', headers=alice,
                      data={'file': (io.BytesIO(b'<html>'), 'page.html')},
                      content_type='multipart/form-data')
    assert bad.status_code == 400


def test_jobs_are_private(env, monkeypatch):
    client, _, _ = env
    workspace._jobs['j-alice'] = {'id': 'j-alice', 'user': 'alice', 'status': 'done', 'created_at': 1}
    monkeypatch.setattr(workspace, '_jobs_loaded', True)
    try:
        assert client.get('/api/workspace/jobs/j-alice', headers=as_user('bob')).status_code == 404
        assert client.get('/api/workspace/jobs', headers=as_user('bob')).get_json()['jobs'] == []
        mine = client.get('/api/workspace/jobs', headers=as_user('alice')).get_json()['jobs']
        assert [j['id'] for j in mine] == ['j-alice'] and 'user' not in mine[0]
    finally:
        workspace._jobs.pop('j-alice', None)


def test_engine_messages_are_scrubbed_of_paths(env):
    _, _, tmp = env
    text = workspace._scrub(f'could not read {tmp}/ws/projects/alice/p-0123456789ab/x.mp4 or /etc/shadow', 'alice')
    assert str(tmp) not in text and '/etc/shadow' not in text


def test_unsafe_identity_is_refused(env):
    client, _, _ = env
    assert client.get('/api/workspace/projects', headers=as_user('..')).status_code == 403


def test_health_without_engine_is_a_service_error_not_a_crash(env, monkeypatch):
    client, _, _ = env
    monkeypatch.setattr(workspace, 'engine_token', lambda: '')
    body = client.get('/api/workspace/health').get_json()
    assert body['available'] is False and body['code'] == 'unavailable'


def test_symlinked_output_dir_is_still_recognised_as_library(tmp_path, monkeypatch):
    # On the target machine ComfyUI/output is a symlink onto another drive.
    real = tmp_path / 'drive' / 'outputs'
    (real / 'studio' / 'alice').mkdir(parents=True)
    (real / 'studio' / 'alice' / 'a.mp4').write_bytes(b'v')
    comfy = tmp_path / 'ComfyUI'
    (comfy / 'input').mkdir(parents=True)
    os.symlink(real, comfy / 'output')
    monkeypatch.setenv('COMFYUI_DIR', str(comfy))
    monkeypatch.setenv('WORKSPACE_DATA_DIR', str(tmp_path / 'ws'))
    monkeypatch.setattr(workspace, '_config', lambda: {})
    monkeypatch.setattr(workspace, 'resolve_identity', lambda req: {'user': 'alice'})
    monkeypatch.setattr(workspace, '_call', FakeEngine())
    client = launcher.app.test_client()
    pid = create(client, 'alice')
    response = client.post(f'/api/workspace/projects/{pid}/import', json={'path': 'studio/alice/a.mp4'})
    assert response.status_code == 200
    assert response.get_json()['project']['media'][0]['source'] == {'kind': 'output', 'path': 'studio/alice/a.mp4'}
    assert str(real) not in response.get_data(as_text=True)


@pytest.fixture
def fresh_catalogue(monkeypatch):
    monkeypatch.setattr(workspace, '_catalogue_cache', None)


@pytest.mark.parametrize('patch', [
    {'cutout': None},                                                  # not exposed
    {'videoEffects': [{'id': 'concat.unknown'}]},                      # not in catalogue
    {'videoEffects': [{'id': 'concat.echo'}]},                         # audio effect on picture
    {'videoEffects': [{'id': 'concat.vignette', 'params': {'amount': '/etc/passwd'}}]},
    {'videoEffects': [{'id': 'concat.vignette', 'params': {'other': 1}}]},
    {'videoEffects': [{'id': 'concat.vignette', 'keys': {'bogus': []}}]},  # keys on an unknown param
    {'videoEffects': [{'id': 'concat.vignette', 'keys': {'amount': [{'at': 2, 'value': 1}]}}]},
    {'filters': [{'id': 'concat.mono'}]},                              # look on the audio chain
    {'transitionIn': {'id': 'concat.cube', 'duration': 1}},
    {'transitionIn': {'id': 'concat.dissolve', 'duration': 99}},
    {'text': {'content': 'x', 'fontFile': '/etc/passwd'}},
    {'text': {'content': ['x']}},
    {'crop': {'left': 0.1}},                                           # all four edges
    {'crop': {'left': 1.5, 'top': 0, 'right': 0, 'bottom': 0}},
    {'blend': 'overlay'},
    {'flipH': 'yes'},
])
def test_update_clip_rejects_unsupported_or_unknown_settings(env, fresh_catalogue, patch):
    client, engine, _ = env
    pid = create(client, 'alice')
    response = client.post(f'/api/workspace/projects/{pid}/edit', json={'command': {
        'op': 'updateClip', 'clipId': 'c1', 'patch': patch}}, headers=as_user('alice'))
    assert response.status_code == 400, patch
    assert not [c for c in engine.calls if c[0] == 'edit.apply']


@pytest.mark.parametrize('command', [
    {'op': 'updateClip', 'clipId': 'c1', 'patch': {
        'videoEffects': [{'id': 'concat.mono'}, {'id': 'concat.vignette', 'params': {'amount': 40}, 'enabled': False}]}},
    {'op': 'updateClip', 'clipId': 'c1', 'patch': {'filters': [{'id': 'concat.echo', 'params': {'delay': 0.3}}]}},
    {'op': 'updateClip', 'clipId': 'c1', 'patch': {'transitionIn': {'id': 'concat.dissolve', 'duration': 1}}},
    {'op': 'updateClip', 'clipId': 'c1', 'patch': {'transitionIn': None}},
    {'op': 'updateClip', 'clipId': 'c1', 'patch': {'text': {'content': 'Hi', 'fontSize': 0.1, 'shadow': True}}},
    {'op': 'addTextClip', 'start': 1, 'above': True, 'style': {'content': 'Title', 'color': '#ffffff'}},
    {'op': 'setClipTransform', 'clipId': 'c1', 'scale': 0.5, 'offsetX': 0.2},
    {'op': 'updateClip', 'clipId': 'c1', 'patch': {'crop': {'left': 0.1, 'top': 0, 'right': 0.2, 'bottom': 0}}},
    {'op': 'updateClip', 'clipId': 'c1', 'patch': {'crop': None, 'blend': 'screen', 'flipH': True}},
    {'op': 'setClipKey', 'clipId': 'c1', 'property': 'scale', 'at': 0.5, 'value': 1.4, 'ease': 'inOut'},
    {'op': 'setClipKey', 'clipId': 'c1', 'property': 'opacity', 'at': 0, 'value': 0, 'ease': [0.42, 0, 0.58, 1]},
    {'op': 'clearClipKey', 'clipId': 'c1', 'property': 'scale', 'at': 0.5},
    {'op': 'clearClipKeys', 'clipId': 'c1', 'property': 'volume'},
])
def test_supported_effects_titles_and_transforms_reach_the_engine(env, fresh_catalogue, command):
    client, engine, _ = env
    pid = create(client, 'alice')
    response = client.post(f'/api/workspace/projects/{pid}/edit', json={'command': command}, headers=as_user('alice'))
    assert response.status_code == 200
    assert [p['command'] for m, p in engine.calls if m == 'edit.apply'] == [command]


def test_catalogue_route_groups_packages_by_kind(env, fresh_catalogue):
    client, _, _ = env
    body = client.get('/api/workspace/catalogue', headers=as_user('alice')).get_json()
    assert set(body) == {'transition', 'effect', 'filter', 'audio'}
    assert body['effect'][0]['id'] == 'concat.vignette'


@pytest.mark.parametrize('command', [
    {'op': 'setClipKey', 'clipId': 'c1', 'property': 'speed', 'at': 0.5, 'value': 2},
    {'op': 'setClipKey', 'clipId': 'c1', 'property': 'scale', 'at': 1.5, 'value': 2},
    {'op': 'setClipKey', 'clipId': 'c1', 'property': 'scale', 'at': 0.5, 'value': 'big'},
    {'op': 'setClipKey', 'clipId': 'c1', 'property': 'scale', 'at': 0.5, 'value': 1, 'ease': 'bounce'},
    {'op': 'clearClipKey', 'clipId': 'c1', 'property': 'scale'},
    {'op': 'setEffectKey', 'clipId': 'c1', 'entry': 0, 'key': 'amount', 'at': 0, 'value': 1},  # no such clip
])
def test_unsupported_keyframes_are_rejected(env, command):
    client, engine, _ = env
    pid = create(client, 'alice')
    response = client.post(f'/api/workspace/projects/{pid}/edit', json={'command': command}, headers=as_user('alice'))
    assert response.status_code == 400
    assert not [c for c in engine.calls if c[0] == 'edit.apply']


def test_duplicate_copies_uploads_and_repoints_them(env):
    import io
    client, engine, tmp = env
    alice = as_user('alice')
    pid = create(client, 'alice', 'Original')
    client.post(f'/api/workspace/projects/{pid}/upload', headers=alice,
                data={'file': (io.BytesIO(b'vid'), 'clip.mp4')}, content_type='multipart/form-data')
    client.post(f'/api/workspace/projects/{pid}/save', headers=alice)
    response = client.post(f'/api/workspace/projects/{pid}/duplicate', json={}, headers=alice)
    assert response.status_code == 201
    copy = response.get_json()
    assert copy['id'] != pid and copy['settings']['name'] == 'Original copy'
    copy_dir = tmp / 'ws' / 'projects' / 'alice' / copy['id']
    saved = json.loads((copy_dir / 'concat.json').read_text())
    assert saved['media'][0]['path'] == str(copy_dir / 'media' / 'clip.mp4')
    client.delete(f'/api/workspace/projects/{pid}', headers=alice)
    assert (copy_dir / 'media' / 'clip.mp4').read_bytes() == b'vid'
    assert client.post(f"/api/workspace/projects/{copy['id']}/duplicate", headers=as_user('bob')).status_code == 404


def _clip_with_vignette(client, alice):
    pid = create(client, 'alice')
    client.post(f'/api/workspace/projects/{pid}/import', json={'path': 'shared.mp4'}, headers=alice)
    client.post(f'/api/workspace/projects/{pid}/edit', json={'command': {
        'op': 'addClip', 'mediaId': 'm1', 'trackId': 'T1', 'start': 0}}, headers=alice)
    client.post(f'/api/workspace/projects/{pid}/edit', json={'command': {
        'op': 'updateClip', 'clipId': 'c1', 'patch': {'videoEffects': [{'id': 'concat.vignette', 'params': {}}]}}}, headers=alice)
    return pid


@pytest.mark.parametrize('command, status', [
    ({'op': 'setEffectKey', 'clipId': 'c1', 'entry': 0, 'key': 'amount', 'at': 0.5, 'value': 80, 'ease': 'out'}, 200),
    ({'op': 'clearEffectKey', 'clipId': 'c1', 'entry': 0, 'key': 'amount', 'at': 0.5}, 200),
    ({'op': 'clearEffectKeys', 'clipId': 'c1', 'entry': 0, 'key': 'amount'}, 200),
    ({'op': 'setEffectKey', 'clipId': 'c1', 'entry': 1, 'key': 'amount', 'at': 0.5, 'value': 80}, 400),   # no 2nd link
    ({'op': 'setEffectKey', 'clipId': 'c1', 'entry': 0, 'key': 'delay', 'at': 0.5, 'value': 80}, 400),    # not its param
    ({'op': 'setEffectKey', 'clipId': 'c1', 'entry': 0, 'key': 'amount', 'at': -1, 'value': 80}, 400),
    ({'op': 'setEffectKey', 'clipId': 'c1', 'entry': True, 'key': 'amount', 'at': 0, 'value': 80}, 400),
])
def test_effect_keyframes_are_checked_against_the_clips_chain(env, fresh_catalogue, command, status):
    client, engine, _ = env
    alice = as_user('alice')
    pid = _clip_with_vignette(client, alice)
    response = client.post(f'/api/workspace/projects/{pid}/edit', json={'command': command}, headers=alice)
    assert response.status_code == status


def test_resending_a_chain_keeps_its_keyframes(env, fresh_catalogue):
    client, engine, _ = env
    alice = as_user('alice')
    pid = _clip_with_vignette(client, alice)
    chain = [{'id': 'concat.vignette', 'params': {'amount': 30}, 'enabled': True,
              'keys': {'amount': [{'at': 0, 'value': 10, 'ease': [0, 0, 1, 1]}, {'at': 1, 'value': 90}]}}]
    response = client.post(f'/api/workspace/projects/{pid}/edit', json={'command': {
        'op': 'updateClip', 'clipId': 'c1', 'patch': {'videoEffects': chain}}}, headers=alice)
    assert response.status_code == 200


def _template(client, alice, slots=('m1',)):
    pid = create(client, 'alice', 'Promo')
    client.post(f'/api/workspace/projects/{pid}/import', json={'path': 'studio/alice/video/a.mp4'}, headers=alice)
    response = client.post(f'/api/workspace/projects/{pid}/template', json={'name': 'Promo look', 'slots': list(slots)}, headers=alice)
    return pid, response


def test_template_is_stored_per_identity_and_staging_is_emptied(env):
    client, engine, tmp = env
    alice = as_user('alice')
    _, response = _template(client, alice)
    assert response.status_code == 201
    template = response.get_json()
    assert template['name'] == 'Promo look' and [s['mediaId'] for s in template['slots']] == ['m1']
    assert (tmp / 'ws' / 'templates' / 'alice' / template['id'] / 'template.json').is_file()
    assert not any((tmp / 'concat-config' / 'templates').iterdir())
    assert [t['id'] for t in client.get('/api/workspace/templates', headers=alice).get_json()['templates']] == [template['id']]
    assert client.get('/api/workspace/templates', headers=as_user('bob')).get_json()['templates'] == []
    for method, url in (('post', f"/api/workspace/templates/{template['id']}/instantiate"),
                        ('delete', f"/api/workspace/templates/{template['id']}"),
                        ('get', f"/api/workspace/templates/{template['id']}/poster")):
        assert getattr(client, method)(url, json={}, headers=as_user('bob')).status_code == 404


def test_template_slots_must_be_project_media(env):
    client, _, _ = env
    _, response = _template(client, as_user('alice'), slots=('m9',))
    assert response.status_code == 400


@pytest.mark.parametrize('fills, status', [
    ([{'mediaId': 'm1', 'source': 'output', 'path': 'shared.mp4'}], 201),
    ([], 400),                                                                       # slot left empty
    ([{'mediaId': 'm1', 'source': 'output', 'path': 'studio/bob/video/b.mp4'}], 404),  # someone else's
    ([{'mediaId': 'm1', 'source': 'output', 'path': '../secret.mp4'}], 400),
    ([{'mediaId': 'm1', 'source': 'output', 'path': 'shared.mp4'},
      {'mediaId': 'm2', 'source': 'output', 'path': 'shared.mp4'}], 400),           # not a slot
])
def test_instantiate_fills_every_slot_from_the_callers_library(env, fills, status):
    client, engine, tmp = env
    alice = as_user('alice')
    _, response = _template(client, alice)
    template = response.get_json()
    result = client.post(f"/api/workspace/templates/{template['id']}/instantiate", json={'name': 'Promo 2', 'fills': fills}, headers=alice)
    assert result.status_code == status
    if status == 201:
        body = result.get_json()
        assert body['settings']['name'] == 'Promo 2'
        assert body['project']['media'][0]['source'] == {'kind': 'output', 'path': 'shared.mp4'}
    else:
        assert not [c for c in engine.calls if c[0] == 'template.instantiate']


@pytest.mark.parametrize('template_id', ['../alice', 't-zzzzzzzzzzzz', 'p-0123456789ab'])
def test_malformed_template_ids_are_not_found(env, template_id):
    client, _, _ = env
    assert client.delete(f'/api/workspace/templates/{template_id}', headers=as_user('alice')).status_code == 404


def test_caption_words_break_at_sentences_pauses_and_length():
    words = [("We're", 0.0, 0.4), ('here,', 0.4, 0.8), ('friends.', 0.8, 1.2),
             ('After', 1.3, 1.5), ('a', 1.5, 1.6), ('long', 1.6, 1.9), ('pause', 1.9, 2.2),
             ('we', 3.5, 3.6)] + [(f'word{i}', 4 + i * 0.3, 4.2 + i * 0.3) for i in range(12)]
    lines = workspace.group_caption_words(words)
    texts = [t for t, _, _ in lines]
    assert texts[0] == "We're here, friends."            # sentence end
    assert texts[1] == 'After a long pause'              # 1.3 s gap before "we"
    assert all(len(t) <= workspace.CAPTION_CHARS for t in texts)
    starts = [s for _, s, _ in lines]
    ends = [e for _, _, e in lines]
    assert all(e > s for _, s, e in lines)
    assert all(ends[i] <= starts[i + 1] for i in range(len(lines) - 1))   # no overlaps


def test_captions_need_an_installed_model_and_a_sounding_clip(env, monkeypatch):
    client, engine, _ = env
    alice = as_user('alice')
    pid = create(client, 'alice')
    monkeypatch.setattr(workspace, 'caption_models', lambda: [])
    response = client.post(f'/api/workspace/projects/{pid}/captions', json={'clipId': 'c1'}, headers=alice)
    assert response.status_code == 503
    monkeypatch.setattr(workspace, 'caption_models', lambda: ['base'])
    for body in ({'clipId': 'nope'}, {'clipId': 'c1', 'model': 'huge'}, {'clipId': 'c1', 'language': '../x'},
                 {'clipId': 'c1', 'placement': 'side'}):
        assert client.post(f'/api/workspace/projects/{pid}/captions', json=body, headers=alice).status_code == 400
    assert client.post(f'/api/workspace/projects/{pid}/captions', json={'clipId': 'c1'}, headers=as_user('bob')).status_code == 404


def test_unpunctuated_lyrics_break_before_a_capital():
    words = [(w, i * 0.3, i * 0.3 + 0.25) for i, w in enumerate(
        'on a cave wall Naming every mystery I know as if'.split())]
    texts = [t for t, _, _ in workspace.group_caption_words(words)]
    assert texts == ['on a cave wall', 'Naming every mystery I know as if']
