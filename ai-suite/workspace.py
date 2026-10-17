"""Studio Workspace: a multitrack video editor backed by the Concat engine.

Flask blueprint mounted at /api/workspace. Concat (`concat-cli serve`, run by
`ai-switch concat`) owns the edit document, preview and export; this module
is the trust boundary in front of it:

- Projects live in per-identity folders under WORKSPACE_DATA_DIR/projects.
  The browser names a project by an opaque id, never by a path, and every id
  is resolved and checked against the caller's own folder.
- Media enters a project only from the caller's Library (ComfyUI output they
  own, or unowned/shared output), from Studio uploads, or from a file uploaded
  into the project itself. The browser never sends a filesystem path to Concat.
- Responses are scrubbed of absolute paths, and the engine token stays here.
- Exports render into the project's own folder and are moved into
  output/studio/<user>/workspace/ on success, so Library only ever shows
  finished files.

See docs/WORKSPACE_VIDEO_EDITOR_PLAN.md.
"""

import base64
import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
import uuid
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from flask import Blueprint, jsonify, request, send_file
from werkzeug.utils import secure_filename

from concat_client import ConcatClient, ConcatError, ConcatUnavailable
from identity import resolve_identity

bp = Blueprint('workspace', __name__, url_prefix='/api/workspace')

ROOT = Path(__file__).resolve().parent
EXPECTED_API_VERSION = '0.2'
PROJECT_ID = re.compile(r'^p-[0-9a-f]{12}$')
SAFE_USER = re.compile(r'^[A-Za-z0-9_][A-Za-z0-9_.-]*$')
MEDIA_EXTS = {
    '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.mkv': 'video', '.m4v': 'video',
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image',
    '.wav': 'audio', '.mp3': 'audio', '.flac': 'audio', '.ogg': 'audio', '.m4a': 'audio',
    '.aac': 'audio', '.aiff': 'audio', '.aif': 'audio',
}
# The first-release edit vocabulary. Every op here takes ids and numbers
# only - commands that carry a file path (addMedia, replaceClipMedia,
# updateMediaPath, addFont, ...) are deliberately absent.
EDIT_OPS = {
    'addClip', 'addClipAtFirstFree', 'moveClips', 'trimClip', 'splitClips',
    'removeClips', 'updateClip', 'addTrack', 'removeTrack', 'setTrackFlag',
    'removeMedia', 'addTextClip', 'setClipTransform',
    'setClipKey', 'clearClipKey', 'clearClipKeys',
    'setEffectKey', 'clearEffectKey', 'clearEffectKeys',
}
# updateClip fields Workspace exposes. Chains and transitions are checked
# against the catalogue; the rest are plain values.
CLIP_PATCH_FIELDS = {'name', 'volume', 'opacity', 'fadeIn', 'fadeOut', 'muted',
                     'text', 'transitionIn', 'videoEffects', 'filters',
                     'crop', 'blend', 'flipH', 'flipV'}
BLEND_MODES = {'', 'normal', 'multiply', 'screen', 'add', 'lighten', 'darken'}
KEY_PROPERTIES = {'scale', 'offsetX', 'offsetY', 'rotation', 'opacity', 'volume'}
KEY_EASES = {'linear', 'in', 'out', 'inOut'}
# Title style fields (Concat's TextStyle); all plain values, and fonts are
# named by family, so none of them can carry a path.
TEXT_STYLE_FIELDS = {
    'content', 'fontFamily', 'fontSize', 'fontWeight', 'italic', 'color', 'align',
    'opacity', 'strokeWidth', 'strokeColor', 'shadow', 'background', 'backgroundRadius',
    'backgroundPaddingX', 'backgroundPaddingY', 'lineHeight', 'tracking', 'maxWidth', 'maxHeight',
}
MAX_CHAIN = 16
EXPORT_PRESETS = {'ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'}
MAX_DIMENSION = 3840

_state_lock = threading.Lock()
_client: Optional[ConcatClient] = None
_client_key: Optional[Tuple[str, str]] = None
_version: Optional[Dict[str, Any]] = None
_version_generation = -1
_revisions: Dict[str, int] = {}
_catalogue_cache: Optional[Tuple[int, Dict[str, list]]] = None
_frame_cache: 'OrderedDict[tuple, bytes]' = OrderedDict()
FRAME_CACHE_SIZE = 96

_jobs_lock = threading.Lock()
_jobs: Dict[str, Dict[str, Any]] = {}
_jobs_loaded = False
_concat_jobs: Dict[str, str] = {}          # Concat job name -> Studio job id
_orphan_events: Dict[str, list] = {}       # events that beat their job's registration


class WorkspaceError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


# -- configuration and paths -------------------------------------------------

def _config() -> Dict[str, str]:
    try:
        from ai_manager import load_config
        return load_config()
    except Exception:
        return {}


def data_dir() -> Path:
    configured = _config().get('WORKSPACE_DATA_DIR') or os.environ.get('WORKSPACE_DATA_DIR')
    return Path(configured or ROOT / 'state' / 'workspace').resolve()


def projects_root() -> Path:
    return data_dir() / 'projects'


def comfy_dir() -> Path:
    return Path(os.environ.get('COMFYUI_DIR') or _config().get('COMFYUI_DIR')
                or ROOT / 'repos' / 'ComfyUI').resolve()


def library_dir(kind: str) -> Path:
    """ComfyUI's output or input folder, resolved: output is commonly a
    symlink onto another drive, and media paths are stored resolved."""
    return (comfy_dir() / kind).resolve()


def engine_address() -> str:
    return _config().get('CONCAT_ADDRESS') or str(data_dir() / 'concat.sock')


def engine_token() -> str:
    try:
        return (data_dir() / 'api.token').read_text().strip()
    except OSError:
        return ''


def _user() -> str:
    user = resolve_identity(request)['user']
    if not SAFE_USER.match(user) or '..' in user:
        raise WorkspaceError(403, 'forbidden', 'This identity cannot use Workspace')
    return user


def _user_root(user: str) -> Path:
    root = projects_root()
    path = (root / user).resolve()
    if path.parent != root:
        raise WorkspaceError(403, 'forbidden', 'Invalid workspace owner')
    return path


def _project_dir(user: str, project_id: str, must_exist: bool = True) -> Path:
    if not PROJECT_ID.match(project_id or ''):
        raise WorkspaceError(404, 'not_found', 'Project not found')
    user_root = _user_root(user)
    path = (user_root / project_id).resolve()
    if path.parent != user_root:
        raise WorkspaceError(404, 'not_found', 'Project not found')
    if must_exist and not (path / 'concat.json').is_file():
        raise WorkspaceError(404, 'not_found', 'Project not found')
    return path


def _within(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def _output_owner(relative_posix: str) -> Optional[str]:
    parts = relative_posix.split('/')
    if len(parts) >= 2 and parts[0] == 'studio':
        return parts[1]
    return None


def _scrub(text: str, user: str = '') -> str:
    """Remove filesystem paths from an engine message before it reaches a browser."""
    text = str(text or '')
    if user:
        text = text.replace(str(projects_root() / user) + os.sep, '')
    roots = {projects_root(), comfy_dir() / 'output', comfy_dir() / 'input',
             library_dir('output'), library_dir('input'), data_dir()}
    for root in sorted(roots, key=lambda r: len(str(r)), reverse=True):
        text = text.replace(str(root) + os.sep, '').replace(str(root), '')
    return re.sub(r'(?<![\w.])/(?:[^\s/\'"]+/)+[^\s\'"]*', '[path]', text)


# -- the engine ---------------------------------------------------------------

def _engine() -> ConcatClient:
    global _client, _client_key
    token = engine_token()
    if not token:
        raise WorkspaceError(503, 'unavailable',
                             'The Workspace engine is not set up. Start it with "ai-switch concat".')
    key = (engine_address(), token)
    with _state_lock:
        if _client is None or _client_key != key:
            if _client is not None:
                _client.close()
            _client = ConcatClient(key[0], key[1], on_event=_on_event)
            _client_key = key
        return _client


def _check_version(client: ConcatClient) -> Dict[str, Any]:
    global _version, _version_generation
    if _version is not None and _version_generation == client._generation and client.connected:
        return _version
    info = client.call('version', timeout=10)
    _version, _version_generation = info, client._generation
    if str(info.get('apiVersion')) != EXPECTED_API_VERSION:
        raise WorkspaceError(503, 'version_mismatch',
                             f"Workspace needs Concat API {EXPECTED_API_VERSION}; "
                             f"the engine speaks {info.get('apiVersion')} (Concat {info.get('concat')})")
    return info


def _call(method: str, params: Optional[Dict[str, Any]] = None, *, user: str = '',
          project: Optional[Path] = None, timeout: float = 30.0) -> Any:
    """Call the engine, mapping its errors onto Studio-facing ones. A project
    the engine does not have open (it restarted, or never saw it) is opened
    and the call retried once."""
    client = _engine()
    try:
        _check_version(client)
        try:
            return client.call(method, params, timeout=timeout)
        except ConcatError as exc:
            if exc.code != 'notOpen' or project is None or method == 'project.open':
                raise
            client.call('project.open', {'path': str(project)}, timeout=timeout)
            return client.call(method, params, timeout=timeout)
    except ConcatUnavailable as exc:
        raise WorkspaceError(503, 'unavailable', f'Workspace engine unavailable: {_scrub(exc.message, user)}')
    except ConcatError as exc:
        status = {'refused': 409, 'busy': 409, 'notFound': 404, 'invalid': 400,
                  'parse': 400, 'cancelled': 409, 'unauthorized': 503}.get(exc.code, 502)
        code = {'notFound': 'not_found', 'unauthorized': 'unavailable'}.get(exc.code, exc.code)
        message = _scrub(exc.message, user)
        if exc.code == 'refused' and method == 'project.open':
            message = ('This project is open somewhere else (for example in the Concat editor '
                       f'window). Close it there and try again. ({message})')
        raise WorkspaceError(status, code, message)


# -- views --------------------------------------------------------------------

def _media_source(user: str, project: Path, path_text: str) -> Dict[str, Any]:
    """Describe where a media file came from without revealing its path."""
    path = Path(path_text)
    output_dir = library_dir('output')
    input_dir = library_dir('input')
    if _within(path, project):
        return {'kind': 'upload', 'name': path.name}
    if _within(path, output_dir):
        return {'kind': 'output', 'path': path.relative_to(output_dir).as_posix()}
    if _within(path, input_dir):
        return {'kind': 'input', 'path': path.relative_to(input_dir).as_posix()}
    return {'kind': 'external', 'name': path.name}


def _strip_paths(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _strip_paths(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_strip_paths(v) for v in value]
    if isinstance(value, str) and os.path.isabs(value):
        return Path(value).name
    return value


def _view(user: str, project_id: str, project: Path, view: Dict[str, Any]) -> Dict[str, Any]:
    proj = dict(view.get('project') or {})
    media = []
    for item in proj.get('media') or []:
        item = dict(item)
        raw = item.pop('path', '') or ''
        if raw:
            item['source'] = _media_source(user, project, raw)
            item['missing'] = not Path(raw).is_file()
        media.append(item)
    proj['media'] = media
    proj = _strip_paths(proj)
    # Added after scrubbing: these URLs are absolute too, but they are ours.
    for item in proj['media']:
        item['url'] = f"/api/workspace/projects/{project_id}/media/{item.get('id')}"
    return {
        'id': project_id,
        'project': proj,
        'settings': _strip_paths(view.get('settings') or {}),
        'canUndo': bool(view.get('canUndo')),
        'canRedo': bool(view.get('canRedo')),
        'createdId': view.get('createdId'),
        'revision': _revisions.get(str(project), 0),
    }


def _bump(project: Path) -> None:
    key = str(project)
    with _state_lock:
        _revisions[key] = _revisions.get(key, 0) + 1


def _saved_document(project: Path) -> Optional[Dict[str, Any]]:
    try:
        return json.loads((project / 'concat.json').read_text())
    except (OSError, ValueError):
        return None


def _dirty(user: str, project: Path) -> bool:
    document = _call('project.document', {'path': str(project)}, user=user, project=project)
    return document != _saved_document(project)


def _open(user: str, project_id: str) -> Tuple[Path, Dict[str, Any]]:
    project = _project_dir(user, project_id)
    view = _call('project.open', {'path': str(project)}, user=user, project=project)
    return project, view


# -- jobs -----------------------------------------------------------------

def _jobs_file() -> Path:
    return data_dir() / 'jobs.json'


def _load_jobs() -> None:
    """Jobs survive a browser refresh in memory and a Studio restart on disk.
    A job that was running when Studio stopped cannot be confirmed - the
    engine reports progress only to the connection that started it - so it
    is shown as interrupted rather than guessed at."""
    global _jobs_loaded
    if _jobs_loaded:
        return
    _jobs_loaded = True
    try:
        saved = json.loads(_jobs_file().read_text())
    except (OSError, ValueError):
        return
    for job in saved.get('jobs', []):
        if job.get('status') in ('queued', 'running', 'finishing'):
            job['status'] = 'interrupted'
            job['error'] = 'Studio restarted while this export was running; export again.'
            _discard_temp(job)
        _jobs[job['id']] = job


def _save_jobs() -> None:
    jobs = sorted(_jobs.values(), key=lambda j: j.get('created_at', 0))[-200:]
    target = _jobs_file()
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        temp = target.with_suffix('.tmp')
        # Runtime-only handles (a running process, a cancel flag) are not saved.
        temp.write_text(json.dumps({'jobs': [{k: v for k, v in j.items() if k not in ('_proc', '_cancel')}
                                             for j in jobs]}))
        os.replace(temp, target)
    except OSError:
        pass


def _discard_temp(job: Dict[str, Any]) -> None:
    """Remove a job's partial output and any intermediates Concat left
    beside it (it writes e.g. `.<name>.concat-video.mp4` while rendering)."""
    temp = job.pop('_temp', None)
    if not temp:
        return
    temp = Path(temp)
    for leftover in temp.parent.glob(f'*{job["id"]}*'):
        leftover.unlink(missing_ok=True)


def _public_job(job: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in job.items() if not k.startswith('_') and k != 'user'}


def _on_event(name: str, params: Dict[str, Any]) -> None:
    concat_job = str(params.get('job') or '')
    if not name.startswith('export.') or not concat_job:
        return
    with _jobs_lock:
        job_id = _concat_jobs.get(concat_job)
        if job_id is None:
            _orphan_events.setdefault(concat_job, []).append((name, params))
            return
        _apply_event(_jobs[job_id], name, params)


def _apply_event(job: Dict[str, Any], name: str, params: Dict[str, Any]) -> None:
    if name == 'export.progress':
        job['status'] = 'running'
        job['frame'] = params.get('frame', 0)
        job['total'] = params.get('total', 0)
        job['stage'] = params.get('stage', '')
    elif name == 'export.done':
        job['status'] = 'finishing'
        threading.Thread(target=_finish_export, args=(job,), daemon=True).start()
    elif name == 'export.failed':
        error = params.get('error') or {}
        _discard_temp(job)
        if error.get('code') == 'cancelled':
            job['status'] = 'cancelled'
            job['error'] = 'Export cancelled'
        else:
            job['status'] = 'failed'
            job['error'] = _scrub(error.get('message') or 'Export failed', job.get('user', ''))
        job['finished_at'] = time.time()
        _concat_jobs.pop(job.get('_concat_job', ''), None)
        _save_jobs()


def _finish_export(job: Dict[str, Any]) -> None:
    """Move the finished file into the owner's Library."""
    temp = Path(job.get('_temp') or '')
    output_dir = comfy_dir() / 'output'
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S')
    name = secure_filename(job.get('project_name') or 'workspace') or 'workspace'
    target = output_dir / 'studio' / job['user'] / 'workspace' / f'{name}-{stamp}.mp4'
    try:
        if not temp.is_file() or temp.stat().st_size == 0:
            raise OSError('the engine reported success but wrote no file')
        target.parent.mkdir(parents=True, exist_ok=True)
        counter = 1
        while target.exists():
            target = target.with_name(f'{name}-{stamp}-{counter}.mp4')
            counter += 1
        shutil.move(str(temp), str(target))
        relative = target.relative_to(output_dir).as_posix()
        with _jobs_lock:
            job.update(status='done', output=relative, url=f'/api/outputs/{relative}',
                       finished_at=time.time())
            _discard_temp(job)
    except OSError as exc:
        with _jobs_lock:
            job.update(status='failed', error=f'Could not save the export to Library: {exc.strerror or exc}',
                       finished_at=time.time())
            _discard_temp(job)
    with _jobs_lock:
        _concat_jobs.pop(job.get('_concat_job', ''), None)
        _save_jobs()


def _fail_running_jobs(reason: str) -> None:
    with _jobs_lock:
        for job in _jobs.values():
            if job.get('kind', 'export') == 'export' and job.get('status') in ('queued', 'running'):
                job.update(status='failed', error=reason, finished_at=time.time())
                _discard_temp(job)
        _concat_jobs.clear()
        _save_jobs()


# -- routes -------------------------------------------------------------------

@bp.errorhandler(WorkspaceError)
def _workspace_error(exc: WorkspaceError):
    return jsonify({'error': exc.message, 'code': exc.code}), exc.status


@bp.route('/health')
def health():
    try:
        client = _engine()
        info = _check_version(client)
    except WorkspaceError as exc:
        return jsonify({'available': False, 'code': exc.code, 'error': exc.message,
                        'expectedApiVersion': EXPECTED_API_VERSION})
    except ConcatError as exc:
        return jsonify({'available': False, 'code': 'unavailable',
                        'error': f'Workspace engine unavailable: {_scrub(exc.message)}',
                        'expectedApiVersion': EXPECTED_API_VERSION})
    return jsonify({'available': True, 'concat': info.get('concat'), 'apiVersion': info.get('apiVersion'),
                    'capabilities': info.get('capabilities') or [],
                    'expectedApiVersion': EXPECTED_API_VERSION})


@bp.route('/projects', methods=['GET'])
def list_projects():
    """Listed from disk, so it works while the engine is stopped and never
    shows another identity's projects (Concat's own recents are machine-wide)."""
    user = _user()
    root = _user_root(user)
    projects = []
    if root.is_dir():
        for folder in root.iterdir():
            manifest = folder / 'concat.json'
            if not PROJECT_ID.match(folder.name) or folder.is_symlink() or not manifest.is_file():
                continue
            try:
                name = json.loads(manifest.read_text()).get('name') or folder.name
            except (OSError, ValueError):
                name = folder.name
            projects.append({'id': folder.name, 'name': name,
                             'modified_at': datetime.fromtimestamp(manifest.stat().st_mtime).isoformat()})
    projects.sort(key=lambda p: p['modified_at'], reverse=True)
    return jsonify({'projects': projects})


@bp.route('/projects', methods=['POST'])
def create_project():
    user = _user()
    body = request.get_json(silent=True) or {}
    name = ' '.join(str(body.get('name') or '').split())[:80] or 'Untitled edit'
    video = None
    if body.get('width') or body.get('height') or body.get('fps'):
        try:
            width, height = int(body.get('width') or 1920), int(body.get('height') or 1080)
            fps = int(body.get('fps') or 30)
        except (TypeError, ValueError):
            raise WorkspaceError(400, 'invalid', 'Width, height and fps must be numbers')
        if not (16 <= width <= MAX_DIMENSION and 16 <= height <= MAX_DIMENSION and 1 <= fps <= 120):
            raise WorkspaceError(400, 'invalid', 'Unsupported frame size or rate')
        video = {'width': width - width % 2, 'height': height - height % 2, 'rateNum': fps, 'rateDen': 1}
    user_root = _user_root(user)
    user_root.mkdir(parents=True, exist_ok=True)
    project_id = f'p-{secrets.token_hex(6)}'
    params: Dict[str, Any] = {'location': str(user_root), 'name': project_id}
    if video:
        params['video'] = video
    _call('project.create', params, user=user)
    project = _project_dir(user, project_id)
    # The folder is named by the id; the display name lives in the document.
    _call('project.save', {'path': str(project), 'name': name}, user=user, project=project)
    view = _call('project.get', {'path': str(project)}, user=user, project=project)
    return jsonify({**_view(user, project_id, project, view), 'dirty': False}), 201


@bp.route('/projects/<project_id>', methods=['GET'])
def get_project(project_id: str):
    user = _user()
    project, view = _open(user, project_id)
    return jsonify({**_view(user, project_id, project, view), 'dirty': _dirty(user, project)})


@bp.route('/projects/<project_id>/save', methods=['POST'])
def save_project(project_id: str):
    user = _user()
    project = _project_dir(user, project_id)
    body = request.get_json(silent=True) or {}
    params: Dict[str, Any] = {'path': str(project)}
    if body.get('name'):
        params['name'] = ' '.join(str(body['name']).split())[:80]
    _call('project.save', params, user=user, project=project)
    view = _call('project.get', {'path': str(project)}, user=user, project=project)
    return jsonify({**_view(user, project_id, project, view), 'dirty': False})


@bp.route('/projects/<project_id>/close', methods=['POST'])
def close_project(project_id: str):
    user = _user()
    project = _project_dir(user, project_id)
    save = bool((request.get_json(silent=True) or {}).get('save'))
    try:
        _call('project.close', {'path': str(project), 'save': save}, user=user)
    except WorkspaceError as exc:
        if exc.code != 'notOpen':
            raise
    _forget_frames(project)
    return jsonify({'closed': project_id, 'saved': save})


@bp.route('/projects/<project_id>/duplicate', methods=['POST'])
def duplicate_project(project_id: str):
    """Copy a saved project, and media uploaded into it, into a new project
    of the same owner. Unsaved changes in the source are not copied."""
    user = _user()
    source = _project_dir(user, project_id)
    body = request.get_json(silent=True) or {}
    new_id = f'p-{secrets.token_hex(6)}'
    target = _project_dir(user, new_id, must_exist=False)
    shutil.copytree(source, target, symlinks=True, ignore=shutil.ignore_patterns('.exports'))
    try:
        view = _call('project.open', {'path': str(target)}, user=user, project=target)
        name = ' '.join(str(body.get('name') or '').split())[:80] or \
            f"{(view.get('settings') or {}).get('name') or 'Untitled edit'} copy"
        # Media uploaded into the source project still points there; repoint
        # it at the copy so the two projects never share files.
        for item in (view.get('project') or {}).get('media') or []:
            raw = item.get('path') or ''
            if raw and _within(Path(raw), source):
                moved = target / Path(raw).relative_to(source)
                _call('edit.apply', {'path': str(target), 'command': {
                    'op': 'updateMediaPath', 'mediaId': item['id'], 'newPath': str(moved)}},
                    user=user, project=target)
        _call('project.save', {'path': str(target), 'name': name}, user=user, project=target)
        # Reopen so the relinking is not in the copy's undo history.
        _call('project.close', {'path': str(target), 'save': False}, user=user)
        view = _call('project.open', {'path': str(target)}, user=user, project=target)
    except WorkspaceError:
        shutil.rmtree(target, ignore_errors=True)
        raise
    return jsonify({**_view(user, new_id, target, view), 'dirty': False}), 201


@bp.route('/projects/<project_id>', methods=['DELETE'])
def delete_project(project_id: str):
    user = _user()
    project = _project_dir(user, project_id)
    with _jobs_lock:
        if any(j.get('project') == project_id and j.get('user') == user
               and j.get('status') in ('queued', 'running', 'finishing') for j in _jobs.values()):
            raise WorkspaceError(409, 'busy', 'Cancel this project\'s export before deleting it')
    try:
        _call('project.close', {'path': str(project), 'save': False}, user=user)
    except WorkspaceError as exc:
        if exc.code not in ('notOpen', 'unavailable'):
            raise
    shutil.rmtree(project)
    _forget_frames(project)
    return jsonify({'deleted': project_id})


def _import_file(user: str, project_id: str, project: Path, file: Path):
    _call('project.open', {'path': str(project)}, user=user, project=project)
    view = _call('media.import', {'path': str(project), 'file': str(file)},
                 user=user, project=project, timeout=120)
    _bump(project)
    return jsonify({**_view(user, project_id, project, view), 'dirty': True})


@bp.route('/projects/<project_id>/import', methods=['POST'])
def import_media(project_id: str):
    """Import a Library item: {"source": "output"|"input", "path": "<relative>"}."""
    user = _user()
    project = _project_dir(user, project_id)
    body = request.get_json(silent=True) or {}
    file = _resolve_library(user, body.get('source') or 'output', body.get('path'))
    return _import_file(user, project_id, project, file)


def _resolve_library(user: str, source: Any, raw: Any) -> Path:
    """A Library item the caller may use, as a checked local path: their own
    or unowned ComfyUI output, or a Studio input/upload."""
    raw = str(raw or '').strip()
    relative = Path(raw)
    if source not in ('output', 'input') or not raw or relative.is_absolute() or '..' in relative.parts:
        raise WorkspaceError(400, 'invalid', 'Choose a Library item')
    base = library_dir(source)
    file = (base / relative).resolve()
    # resolve() follows symlinks, so a link pointing out of the Library fails here.
    if not _within(file, base) or file == base or not file.is_file():
        raise WorkspaceError(404, 'not_found', 'That Library item no longer exists')
    if file.suffix.lower() not in MEDIA_EXTS:
        raise WorkspaceError(400, 'invalid', 'Workspace uses video, image and audio files only')
    if source == 'output':
        owner = _output_owner(file.relative_to(base).as_posix())
        if owner is not None and owner != user:
            raise WorkspaceError(404, 'not_found', 'That Library item no longer exists')
    return file


@bp.route('/projects/<project_id>/upload', methods=['POST'])
def upload_media(project_id: str):
    """Upload a local file into the project's own media folder and import it."""
    user = _user()
    project = _project_dir(user, project_id)
    uploaded = request.files.get('file')
    if uploaded is None or not uploaded.filename:
        raise WorkspaceError(400, 'invalid', 'No file uploaded')
    name = secure_filename(uploaded.filename) or f'upload-{int(time.time())}'
    if Path(name).suffix.lower() not in MEDIA_EXTS:
        raise WorkspaceError(400, 'invalid', 'Workspace imports video, image and audio files only')
    media_dir = project / 'media'
    media_dir.mkdir(exist_ok=True)
    target = media_dir / name
    counter = 1
    while target.exists():
        target = media_dir / f'{Path(name).stem}-{counter}{Path(name).suffix}'
        counter += 1
    uploaded.save(target)
    try:
        return _import_file(user, project_id, project, target)
    except WorkspaceError:
        target.unlink(missing_ok=True)
        raise


@bp.route('/projects/<project_id>/media/<media_id>')
def media_file(project_id: str, media_id: str):
    """Stream a bin item's source file, for browser playback of the moving preview."""
    user = _user()
    project, view = _open(user, project_id)
    item = next((m for m in (view.get('project') or {}).get('media') or [] if m.get('id') == media_id), None)
    if item is None or not item.get('path'):
        raise WorkspaceError(404, 'not_found', 'Media not found')
    file = Path(item['path']).resolve()
    allowed = _within(file, project) or _within(file, library_dir('input'))
    output_dir = library_dir('output')
    if _within(file, output_dir):
        owner = _output_owner(file.relative_to(output_dir).as_posix())
        allowed = owner is None or owner == user
    if not allowed or file.suffix.lower() not in MEDIA_EXTS or not file.is_file():
        raise WorkspaceError(404, 'not_found', 'Media not found')
    return send_file(file, conditional=True, max_age=0)


@bp.route('/projects/<project_id>/edit', methods=['POST'])
def edit(project_id: str):
    user = _user()
    project = _project_dir(user, project_id)
    command = (request.get_json(silent=True) or {}).get('command')
    if not isinstance(command, dict) or command.get('op') not in EDIT_OPS:
        raise WorkspaceError(400, 'invalid', 'That edit is not supported in Workspace yet')
    before = _call('project.get', {'path': str(project)}, user=user, project=project)
    _validate_command(user, command, before)
    view = _call('edit.apply', {'path': str(project), 'command': command}, user=user, project=project)
    # Concat answers a no-op (an overlapping move, an unknown id) with
    # success and an unchanged document, so say so explicitly.
    changed = (view.get('project') != before.get('project'))
    if changed:
        _bump(project)
    return jsonify({**_view(user, project_id, project, view), 'changed': changed,
                    'dirty': _dirty(user, project)})


def _catalogue(user: str) -> Dict[str, list]:
    """Concat's effect packages by kind, fetched once per engine connection."""
    global _catalogue_cache
    generation = _client._generation if _client is not None else None
    if _catalogue_cache and _catalogue_cache[0] == generation:
        return _catalogue_cache[1]
    grouped: Dict[str, list] = {}
    for kind in ('transition', 'effect', 'filter', 'audio'):
        grouped[kind] = _call('catalogue.list', {'kind': kind}, user=user)
    generation = _client._generation if _client is not None else None
    _catalogue_cache = (generation, grouped)
    return grouped


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _check_style(style: Any) -> None:
    if not isinstance(style, dict) or set(style) - TEXT_STYLE_FIELDS:
        raise WorkspaceError(400, 'invalid', 'Unsupported title style')
    for key, value in style.items():
        if isinstance(value, str):
            if len(value) > (2000 if key == 'content' else 80):
                raise WorkspaceError(400, 'invalid', 'Title text is too long')
        elif not (_is_number(value) or isinstance(value, bool)):
            raise WorkspaceError(400, 'invalid', 'Unsupported title style')


def _check_ease(ease: Any) -> None:
    if not ((isinstance(ease, str) and ease in KEY_EASES)
            or (isinstance(ease, list) and len(ease) == 4 and all(_is_number(v) for v in ease))):
        raise WorkspaceError(400, 'invalid', 'Unknown keyframe ease')


def _check_at(at: Any) -> None:
    if not (_is_number(at) and 0 <= at <= 1):
        raise WorkspaceError(400, 'invalid', 'A keyframe must sit inside its clip')


def _check_chain(user: str, chain: Any, kinds: Tuple[str, ...]) -> None:
    known = {item['id']: item for kind in kinds for item in _catalogue(user).get(kind, [])}
    if not isinstance(chain, list) or len(chain) > MAX_CHAIN:
        raise WorkspaceError(400, 'invalid', 'Unsupported effect chain')
    for entry in chain:
        if not isinstance(entry, dict) or set(entry) - {'id', 'params', 'enabled', 'keys'} or entry.get('id') not in known:
            raise WorkspaceError(400, 'invalid', 'Unknown effect')
        params = entry.get('params', {})
        allowed = {p['key'] for p in known[entry['id']].get('params') or []}
        if not isinstance(params, dict) or set(params) - allowed or not all(_is_number(v) for v in params.values()):
            raise WorkspaceError(400, 'invalid', 'Unsupported effect setting')
        if 'enabled' in entry and not isinstance(entry['enabled'], bool):
            raise WorkspaceError(400, 'invalid', 'Unsupported effect setting')
        # Keyframes ride along when the UI resends a chain; they must name
        # this package's own parameters.
        keys = entry.get('keys', {})
        if not isinstance(keys, dict) or set(keys) - allowed:
            raise WorkspaceError(400, 'invalid', 'Unsupported effect keyframes')
        for run in keys.values():
            if not isinstance(run, list) or len(run) > 500:
                raise WorkspaceError(400, 'invalid', 'Unsupported effect keyframes')
            for key in run:
                if not isinstance(key, dict) or set(key) - {'at', 'value', 'ease'} or not _is_number(key.get('value')):
                    raise WorkspaceError(400, 'invalid', 'Unsupported effect keyframes')
                _check_at(key.get('at'))
                if 'ease' in key:
                    _check_ease(key['ease'])


def _validate_command(user: str, command: Dict[str, Any], before: Dict[str, Any]) -> None:
    op = command['op']
    if op == 'updateClip':
        patch = command.get('patch')
        if not isinstance(patch, dict) or not patch or set(patch) - CLIP_PATCH_FIELDS:
            raise WorkspaceError(400, 'invalid', 'That clip property cannot be changed here')
        if patch.get('text') is not None:
            _check_style(patch['text'])
        if 'videoEffects' in patch:
            _check_chain(user, patch['videoEffects'], ('effect', 'filter'))
        if 'filters' in patch:
            _check_chain(user, patch['filters'], ('audio',))
        transition = patch.get('transitionIn')
        if transition is not None:
            ids = {t['id'] for t in _catalogue(user)['transition']}
            if (not isinstance(transition, dict) or set(transition) - {'id', 'duration'}
                    or transition.get('id') not in ids
                    or not (_is_number(transition.get('duration', 1)) and 0.05 <= transition.get('duration', 1) <= 10)):
                raise WorkspaceError(400, 'invalid', 'Unknown transition')
        crop = patch.get('crop')
        if crop is not None and (not isinstance(crop, dict) or set(crop) != {'left', 'top', 'right', 'bottom'}
                                 or not all(_is_number(v) and 0 <= v < 1 for v in crop.values())):
            raise WorkspaceError(400, 'invalid', 'Crop needs left, top, right and bottom between 0 and 1')
        if 'blend' in patch and patch['blend'] not in BLEND_MODES:
            raise WorkspaceError(400, 'invalid', 'Unknown blend mode')
        for flag in ('flipH', 'flipV', 'muted'):
            if flag in patch and not isinstance(patch[flag], bool):
                raise WorkspaceError(400, 'invalid', 'Unsupported clip setting')
    elif op == 'addTextClip':
        if command.get('style') is not None:
            _check_style(command['style'])
    elif op in ('setClipKey', 'clearClipKey', 'clearClipKeys'):
        if command.get('property') not in KEY_PROPERTIES:
            raise WorkspaceError(400, 'invalid', 'That property cannot be keyframed')
        if op != 'clearClipKeys':
            _check_at(command.get('at'))
        if op == 'setClipKey':
            if not _is_number(command.get('value')):
                raise WorkspaceError(400, 'invalid', 'A keyframe needs a numeric value')
            _check_ease(command.get('ease', 'linear'))
    elif op in ('setEffectKey', 'clearEffectKey', 'clearEffectKeys'):
        # The key must be a parameter of the effect at that link of this clip.
        clip = next((c for tl in (before.get('project') or {}).get('timelines') or []
                     for c in tl.get('clips') or [] if c.get('id') == command.get('clipId')), None)
        entry = command.get('entry')
        chain = (clip or {}).get('videoEffects') or []
        if not isinstance(entry, int) or isinstance(entry, bool) or not 0 <= entry < len(chain):
            raise WorkspaceError(400, 'invalid', 'That effect is no longer on the clip')
        known = {item['id']: item for kind in ('effect', 'filter') for item in _catalogue(user).get(kind, [])}
        package = known.get(chain[entry].get('id')) or {}
        if command.get('key') not in {p['key'] for p in package.get('params') or []}:
            raise WorkspaceError(400, 'invalid', 'That effect setting cannot be keyframed')
        if op != 'clearEffectKeys':
            _check_at(command.get('at'))
        if op == 'setEffectKey':
            if not _is_number(command.get('value')):
                raise WorkspaceError(400, 'invalid', 'A keyframe needs a numeric value')
            _check_ease(command.get('ease', 'linear'))


@bp.route('/catalogue')
def catalogue():
    """Transitions, video effects, looks and audio effects, with their knobs."""
    user = _user()
    keep = ('id', 'name', 'kind', 'category', 'description', 'intensity', 'params')
    grouped = _catalogue(user)
    return jsonify({kind: [{k: item.get(k) for k in keep} for item in items]
                    for kind, items in grouped.items()})


def _history(project_id: str, method: str):
    user = _user()
    project = _project_dir(user, project_id)
    view = _call(method, {'path': str(project)}, user=user, project=project)
    _bump(project)
    return jsonify({**_view(user, project_id, project, view), 'dirty': _dirty(user, project)})


@bp.route('/projects/<project_id>/undo', methods=['POST'])
def undo(project_id: str):
    return _history(project_id, 'edit.undo')


@bp.route('/projects/<project_id>/redo', methods=['POST'])
def redo(project_id: str):
    return _history(project_id, 'edit.redo')


def _forget_frames(project: Path) -> None:
    key = str(project)
    with _state_lock:
        for cache_key in [k for k in _frame_cache if k[0] == key]:
            _frame_cache.pop(cache_key, None)


@bp.route('/projects/<project_id>/frame')
def frame(project_id: str):
    """The exact composited frame at one instant, as PNG. Cached by project
    revision, time and size; meant for paused/scrub-release preview, not for
    playback-rate use."""
    user = _user()
    project = _project_dir(user, project_id)
    try:
        t = max(0.0, float(request.args.get('t', 0)))
        width = int(request.args.get('w', 640))
        height = int(request.args.get('h', 360))
    except ValueError:
        raise WorkspaceError(400, 'invalid', 'Bad frame request')
    width = max(16, min(width, 1920)) & ~1
    height = max(16, min(height, 1080)) & ~1
    key = (str(project), _revisions.get(str(project), 0), round(t, 3), width, height)
    with _state_lock:
        png = _frame_cache.get(key)
        if png is not None:
            _frame_cache.move_to_end(key)
    if png is None:
        picture = _call('preview.frame', {'path': str(project), 'time': t, 'width': width, 'height': height},
                        user=user, project=project, timeout=30)
        png = base64.b64decode(picture.get('png') or '')
        with _state_lock:
            _frame_cache[key] = png
            while len(_frame_cache) > FRAME_CACHE_SIZE:
                _frame_cache.popitem(last=False)
    from io import BytesIO
    response = send_file(BytesIO(png), mimetype='image/png', max_age=0)
    response.headers['X-Workspace-Revision'] = str(key[1])
    return response


@bp.route('/projects/<project_id>/export', methods=['POST'])
def start_export(project_id: str):
    user = _user()
    project = _project_dir(user, project_id)
    body = request.get_json(silent=True) or {}
    spec: Dict[str, Any] = {}
    try:
        if body.get('width') or body.get('height'):
            width, height = int(body.get('width')), int(body.get('height'))
            if not (16 <= width <= MAX_DIMENSION and 16 <= height <= MAX_DIMENSION):
                raise ValueError
            spec.update(width=width - width % 2, height=height - height % 2)
        if body.get('crf') is not None:
            crf = int(body['crf'])
            if not 0 <= crf <= 51:
                raise ValueError
            spec['crf'] = crf
    except (TypeError, ValueError):
        raise WorkspaceError(400, 'invalid', 'Unsupported export size or quality')
    preset = body.get('preset')
    if preset:
        if preset not in EXPORT_PRESETS:
            raise WorkspaceError(400, 'invalid', 'Unknown export speed preset')
        spec['preset'] = preset
    with _jobs_lock:
        _load_jobs()
    view = _call('project.open', {'path': str(project)}, user=user, project=project)
    project_name = (view.get('settings') or {}).get('name') or project_id
    job_id = uuid.uuid4().hex[:12]
    exports = project / '.exports'
    exports.mkdir(exist_ok=True)
    temp = exports / f'{job_id}.mp4'
    started = _call('export.run', {'path': str(project), 'output': str(temp), **spec},
                    user=user, project=project)
    concat_job = str(started.get('job'))
    job = {'id': job_id, 'kind': 'export', 'user': user, 'project': project_id, 'project_name': project_name,
           'status': 'running', 'frame': 0, 'total': 0, 'stage': 'starting',
           'created_at': time.time(), '_temp': str(temp), '_concat_job': concat_job}
    with _jobs_lock:
        _jobs[job_id] = job
        _concat_jobs[concat_job] = job_id
        for name, params in _orphan_events.pop(concat_job, []):
            _apply_event(job, name, params)
        _save_jobs()
        return jsonify(_public_job(job)), 202


def _user_job(user: str, job_id: str) -> Dict[str, Any]:
    _load_jobs()
    job = _jobs.get(job_id)
    if job is None or job.get('user') != user:
        raise WorkspaceError(404, 'not_found', 'Export not found')
    return job


@bp.route('/jobs')
def list_jobs():
    user = _user()
    with _jobs_lock:
        _load_jobs()
        jobs = [_public_job(j) for j in _jobs.values() if j.get('user') == user]
    jobs.sort(key=lambda j: j.get('created_at', 0), reverse=True)
    return jsonify({'jobs': jobs[:50]})


@bp.route('/jobs/<job_id>')
def get_job(job_id: str):
    user = _user()
    with _jobs_lock:
        job = _user_job(user, job_id)
        running = job.get('kind', 'export') == 'export' and job.get('status') in ('queued', 'running')
    if running:
        client = _engine()
        if not client.connected:
            # The connection that would have carried this job's events is gone.
            _fail_running_jobs('The Workspace engine stopped during the export')
    with _jobs_lock:
        return jsonify(_public_job(_user_job(user, job_id)))


@bp.route('/jobs/<job_id>/cancel', methods=['POST'])
def cancel_job(job_id: str):
    user = _user()
    with _jobs_lock:
        job = _user_job(user, job_id)
        if job.get('status') not in ('queued', 'running'):
            return jsonify(_public_job(job))
        if job.get('kind') == 'captions':
            job['_cancel'] = True
            proc = job.get('_proc')
            if proc is not None and proc.poll() is None:
                proc.terminate()
            return jsonify(_public_job(job))
        concat_job = job.get('_concat_job')
    _call('export.cancel', {'job': concat_job}, user=user)
    with _jobs_lock:
        return jsonify(_public_job(job))


# -- templates ------------------------------------------------------------------
# Concat's own template feature, kept per identity. `template.save` can only
# write into Concat's machine-wide config folder, so Studio uses that as a
# staging area and moves each bundle at once into
# WORKSPACE_DATA_DIR/templates/<identity>/<id>/. Studio never calls
# `template.list`, so no identity sees another's templates.

TEMPLATE_ID = re.compile(r'^t-[0-9a-f]{12}$')
TEMPLATE_META = 'studio-template.json'


def _template_dir(user: str, template_id: str, must_exist: bool = True) -> Path:
    if not TEMPLATE_ID.match(template_id or ''):
        raise WorkspaceError(404, 'not_found', 'Template not found')
    root = (data_dir() / 'templates' / user).resolve()
    path = (root / template_id).resolve()
    if path.parent != root or (must_exist and not (path / TEMPLATE_META).is_file()):
        raise WorkspaceError(404, 'not_found', 'Template not found')
    return path


def _template_info(template_id: str, path: Path) -> Dict[str, Any]:
    meta = json.loads((path / TEMPLATE_META).read_text())
    return {'id': template_id, 'name': meta.get('name'), 'created_at': meta.get('created_at'),
            'width': meta.get('width'), 'height': meta.get('height'), 'fps': meta.get('fps'),
            'slots': meta.get('slots') or [],
            'has_poster': (path / 'poster.png').is_file() or (path / 'poster.jpg').is_file()}


@bp.route('/templates')
def list_templates():
    user = _user()
    root = data_dir() / 'templates' / user
    templates = []
    if root.is_dir():
        for folder in sorted(root.iterdir()):
            if TEMPLATE_ID.match(folder.name) and not folder.is_symlink() and (folder / TEMPLATE_META).is_file():
                try:
                    templates.append(_template_info(folder.name, folder))
                except (OSError, ValueError):
                    continue
    templates.sort(key=lambda t: t.get('created_at') or '', reverse=True)
    return jsonify({'templates': templates})


@bp.route('/projects/<project_id>/template', methods=['POST'])
def save_template(project_id: str):
    """Pack the open project (including unsaved edits) as a template. Media
    named in `slots` become placeholders to fill later; everything else is
    copied into the template."""
    user = _user()
    project = _project_dir(user, project_id)
    body = request.get_json(silent=True) or {}
    name = ' '.join(str(body.get('name') or '').split())[:80] or 'Untitled template'
    slots = body.get('slots') or []
    view = _call('project.open', {'path': str(project)}, user=user, project=project)
    media_ids = {m.get('id') for m in (view.get('project') or {}).get('media') or []}
    if not isinstance(slots, list) or not all(isinstance(m, str) and m in media_ids for m in slots):
        raise WorkspaceError(400, 'invalid', 'Choose slots from this project\'s media')
    template_id = f't-{secrets.token_hex(6)}'
    target = _template_dir(user, template_id, must_exist=False)
    marked = False
    staged: Optional[Path] = None
    try:
        if slots:
            # One undo step, taken back once the template is written.
            _call('edit.apply', {'path': str(project), 'command': {'op': 'batch', 'commands': [
                {'op': 'setMediaPlaceholder', 'mediaId': m, 'placeholder': True} for m in slots]}},
                user=user, project=project)
            marked = True
        info = _call('template.save', {'path': str(project), 'name': f'studio-{template_id}'},
                     user=user, project=project, timeout=600)
        staged = Path(info['path'])
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(staged), str(target))
        staged = None
    finally:
        if marked:
            _call('edit.undo', {'path': str(project)}, user=user, project=project)
        if staged is not None and staged.exists():
            shutil.rmtree(staged, ignore_errors=True)
    settings = view.get('settings') or {}
    meta = {
        'name': name,
        'created_at': datetime.now().isoformat(timespec='seconds'),
        'width': info.get('width'), 'height': info.get('height'),
        'fps': round((info.get('rateNum') or 30) / (info.get('rateDen') or 1), 3),
        'slots': [{'mediaId': s.get('mediaId'), 'name': s.get('name'), 'kind': s.get('kind'),
                   'seconds': s.get('seconds')} for s in info.get('slots') or []],
        'source_project': settings.get('name'),
    }
    (target / TEMPLATE_META).write_text(json.dumps(meta, indent=1))
    # Concat takes its poster from a file only the desktop window writes;
    # render one from the edit instead (best effort).
    try:
        length = max((c.get('start', 0) + c.get('duration', 0) for tl in (view.get('project') or {}).get('timelines') or []
                      for c in tl.get('clips') or []), default=0)
        picture = _call('preview.frame', {'path': str(project), 'time': length / 3, 'width': 480, 'height': 270},
                        user=user, project=project)
        (target / 'poster.png').write_bytes(base64.b64decode(picture.get('png') or ''))
    except (WorkspaceError, OSError, ValueError):
        pass
    return jsonify(_template_info(template_id, target)), 201


@bp.route('/templates/<template_id>/poster')
def template_poster(template_id: str):
    user = _user()
    folder = _template_dir(user, template_id)
    for poster, mimetype in ((folder / 'poster.png', 'image/png'), (folder / 'poster.jpg', 'image/jpeg')):
        if poster.is_file():
            return send_file(poster, mimetype=mimetype, max_age=0)
    raise WorkspaceError(404, 'not_found', 'No poster')


@bp.route('/templates/<template_id>', methods=['DELETE'])
def delete_template(template_id: str):
    user = _user()
    shutil.rmtree(_template_dir(user, template_id))
    return jsonify({'deleted': template_id})


@bp.route('/templates/<template_id>/instantiate', methods=['POST'])
def instantiate_template(template_id: str):
    """A new project from a template, every slot filled from the caller's Library."""
    user = _user()
    bundle = _template_dir(user, template_id)
    info = _template_info(template_id, bundle)
    body = request.get_json(silent=True) or {}
    fills = body.get('fills') or []
    slot_ids = {s['mediaId'] for s in info['slots']}
    if not isinstance(fills, list) or {f.get('mediaId') for f in fills if isinstance(f, dict)} != slot_ids \
            or len(fills) != len(slot_ids):
        raise WorkspaceError(400, 'invalid', 'Fill every slot with a Library item')
    resolved = [{'mediaId': f['mediaId'], 'file': str(_resolve_library(user, f.get('source') or 'output', f.get('path')))}
                for f in fills]
    user_root = _user_root(user)
    user_root.mkdir(parents=True, exist_ok=True)
    project_id = f'p-{secrets.token_hex(6)}'
    _call('template.instantiate', {'template': str(bundle), 'location': str(user_root),
                                   'name': project_id, 'fills': resolved}, user=user, timeout=600)
    project = _project_dir(user, project_id)
    name = ' '.join(str(body.get('name') or '').split())[:80] or info['name']
    _call('project.save', {'path': str(project), 'name': name}, user=user, project=project)
    view = _call('project.get', {'path': str(project)}, user=user, project=project)
    return jsonify({**_view(user, project_id, project, view), 'dirty': False}), 201


# -- automatic captions -----------------------------------------------------------
# Concat's own transcription lives in its desktop window, not its API, so
# Studio runs whisper.cpp (MIT) itself: the clip's audio window is extracted
# with FFmpeg, transcribed with word timings, grouped into caption lines the
# way Concat words them (42 characters, a sentence or a pause ends a line),
# and placed as titles in one undoable batch.

CAPTION_CHARS = 42
CAPTION_PLACEMENT = {'bottom': 0.35, 'middle': 0.0, 'top': -0.35}
CAPTION_SIZE = {'small': 0.04, 'medium': 0.05, 'large': 0.065}
CAPTION_LANGUAGES = re.compile(r'^(auto|[a-z]{2,3})$')
_captions_lock = threading.Lock()


def _whisper_paths() -> Tuple[Path, Path]:
    config = _config()
    cli = Path(config.get('WHISPER_CLI') or Path.home() / '.local/opt/whisper.cpp/src/build/bin/whisper-cli')
    models = Path(config.get('WHISPER_MODELS_DIR') or Path.home() / '.local/opt/whisper.cpp/models')
    return cli, models


def _ffmpeg() -> Tuple[str, Dict[str, str]]:
    config = _config()
    lib = config.get('CONCAT_LIB_DIR') or str(Path.home() / '.local/opt/concat/ffmpeg-8.1/lib')
    binary = config.get('FFMPEG_BIN') or str(Path(lib).parent / 'bin' / 'ffmpeg')
    env = dict(os.environ)
    env['LD_LIBRARY_PATH'] = f"{lib}:{env.get('LD_LIBRARY_PATH', '')}"
    return binary, env


def caption_models() -> list:
    cli, models = _whisper_paths()
    if not cli.is_file() or not models.is_dir():
        return []
    return sorted(m.name[len('ggml-'):-len('.bin')] for m in models.glob('ggml-*.bin'))


def group_caption_words(words: list) -> list:
    """Words with timings, as `(text, start, end)` seconds, into caption lines."""
    lines, current = [], []

    def flush():
        if current:
            lines.append((' '.join(w[0] for w in current), current[0][1], current[-1][2]))
            current.clear()

    for text, start, end in words:
        if current:
            joined = len(' '.join(w[0] for w in current))
            previous = current[-1][0]
            if (joined + 1 + len(text) > CAPTION_CHARS
                    or start - current[-1][2] > 0.7
                    or previous[-1] in '.?!…。！？'
                    or (previous[-1] in ',;:' and joined >= 18)
                    # Unpunctuated speech and lyrics: a capital usually
                    # starts a new line or sentence.
                    or (text[:1].isupper() and text.split("'")[0] != 'I' and previous[-1] != ','
                        and joined >= 12)):
                flush()
        current.append((text, start, end))
    flush()
    # Hold each line until the next starts when the gap is short, so the
    # captions do not flicker, and keep every line readable for a moment.
    timed = []
    for i, (text, start, end) in enumerate(lines):
        next_start = lines[i + 1][1] if i + 1 < len(lines) else None
        if next_start is not None and next_start - end < 0.3:
            end = next_start
        end = max(end, start + 0.4)
        if next_start is not None:
            end = min(end, next_start)
        timed.append((text, start, end))
    return timed


def _run_captions(job: Dict[str, Any], user: str, project: Path, clip: Dict[str, Any], media_path: str,
                  model: str, language: str, look: Dict[str, Any]) -> None:
    work = project / '.captions'
    work.mkdir(exist_ok=True)
    wav = work / f"{job['id']}.wav"
    out = work / job['id']

    def update(**fields):
        with _jobs_lock:
            job.update(**fields)

    def run(cmd, env=None, progress=False):
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, env=env)
        update(_proc=proc)
        tail = []
        for line in proc.stderr:
            tail = (tail + [line.strip()])[-5:]
            match = re.search(r'progress =\s*(\d+)%', line) if progress else None
            if match:
                update(percent=int(match.group(1)))
        proc.wait()
        update(_proc=None)
        if job.get('_cancel'):
            raise InterruptedError
        if proc.returncode != 0:
            raise RuntimeError(_scrub(' '.join(tail[-2:]) or f'exit status {proc.returncode}', user))

    try:
        ffmpeg, env = _ffmpeg()
        speed = clip.get('speed') or 1.0
        window = clip['duration'] * speed
        update(stage='extracting audio')
        run([ffmpeg, '-v', 'error', '-y', '-ss', f"{clip.get('sourceStart') or 0:.3f}", '-t', f'{window:.3f}',
             '-i', media_path, '-vn', '-ac', '1', '-ar', '16000', '-f', 'wav', str(wav)], env=env)
        update(stage='transcribing', percent=0)
        cli, models = _whisper_paths()
        threads = str(max(2, min(16, (os.cpu_count() or 4) // 2)))
        run([str(cli), '-m', str(models / f'ggml-{model}.bin'), '-f', str(wav), '-l', language, '-t', threads,
             '-ml', '1', '-sow', '-oj', '-of', str(out), '-pp'], progress=True)
        result = json.loads(out.with_suffix('.json').read_text())
        words = []
        for segment in result.get('transcription') or []:
            text = (segment.get('text') or '').strip()
            if not text or re.fullmatch(r'[\[(].*[\])]|[♪♫\s]+', text):
                continue   # [BLANK_AUDIO], (music) and the like
            offsets = segment.get('offsets') or {}
            words.append((text, offsets.get('from', 0) / 1000, offsets.get('to', 0) / 1000))
        lines = group_caption_words(words)
        update(stage='placing captions')
        clip_end = clip['start'] + clip['duration']
        commands = []
        for text, start, end in lines:
            at = clip['start'] + start / speed
            if at >= clip_end:
                break
            duration = min(end / speed + clip['start'], clip_end) - at
            commands.append({'op': 'addTextClip', 'above': True, 'start': round(at, 3),
                             'duration': round(max(duration, 0.2), 3), 'offsetY': look['offsetY'],
                             'style': {'content': text, 'fontFamily': '"Hanken Grotesk"', 'fontSize': look['fontSize'],
                                       'fontWeight': 600, **({'background': '#000000aa'} if look['box'] else {})}})
        if job.get('_cancel'):
            raise InterruptedError
        if commands:
            _call('edit.apply', {'path': str(project), 'command': {'op': 'batch', 'commands': commands}},
                  user=user, project=project, timeout=120)
            _bump(project)
        update(status='done', stage='', percent=100, captions=len(commands), language=result.get('result', {}).get('language'),
               finished_at=time.time())
    except InterruptedError:
        update(status='cancelled', error='Captioning cancelled', finished_at=time.time())
    except (RuntimeError, OSError, ValueError, KeyError, WorkspaceError) as exc:
        message = exc.message if isinstance(exc, WorkspaceError) else str(exc)
        update(status='failed', error=f'Captioning failed: {message}', finished_at=time.time())
    finally:
        for leftover in work.glob(f"{job['id']}*"):
            leftover.unlink(missing_ok=True)
        _captions_lock.release()
        with _jobs_lock:
            job.pop('_proc', None)
            _save_jobs()


@bp.route('/captions/models')
def captions_models():
    _user()
    return jsonify({'models': caption_models()})


@bp.route('/projects/<project_id>/captions', methods=['POST'])
def start_captions(project_id: str):
    """Transcribe one clip's sound and add its words as captions."""
    user = _user()
    project = _project_dir(user, project_id)
    body = request.get_json(silent=True) or {}
    models = caption_models()
    model = body.get('model') or ('small' if 'small' in models else (models[0] if models else ''))
    if model not in models:
        raise WorkspaceError(503 if not models else 400, 'unavailable' if not models else 'invalid',
                             'Speech recognition is not installed' if not models else 'Unknown speech model')
    language = str(body.get('language') or 'auto')
    if not CAPTION_LANGUAGES.match(language):
        raise WorkspaceError(400, 'invalid', 'Unknown language')
    if body.get('placement', 'bottom') not in CAPTION_PLACEMENT or body.get('size', 'medium') not in CAPTION_SIZE:
        raise WorkspaceError(400, 'invalid', 'Unknown caption placement or size')
    look = {'offsetY': CAPTION_PLACEMENT[body.get('placement', 'bottom')],
            'fontSize': CAPTION_SIZE[body.get('size', 'medium')], 'box': bool(body.get('box'))}
    view = _call('project.open', {'path': str(project)}, user=user, project=project)
    clip = next((c for tl in (view.get('project') or {}).get('timelines') or []
                 for c in tl.get('clips') or [] if c.get('id') == body.get('clipId')), None)
    media = next((m for m in (view.get('project') or {}).get('media') or []
                  if clip and m.get('id') == clip.get('mediaId')), None)
    if clip is None or media is None or clip.get('kind') not in ('video', 'audio'):
        raise WorkspaceError(400, 'invalid', 'Choose a video or audio clip to caption')
    if media.get('kind') == 'video' and not media.get('hasAudio'):
        raise WorkspaceError(400, 'invalid', 'That clip has no sound')
    if not Path(media.get('path') or '').is_file():
        raise WorkspaceError(404, 'not_found', 'The clip\'s source file is missing')
    if not _captions_lock.acquire(blocking=False):
        raise WorkspaceError(409, 'busy', 'Captions are already being made; try again when they finish')
    job = {'id': uuid.uuid4().hex[:12], 'kind': 'captions', 'user': user, 'project': project_id,
           'project_name': (view.get('settings') or {}).get('name'), 'clip': clip['id'], 'model': model,
           'status': 'running', 'stage': 'starting', 'percent': 0, 'created_at': time.time()}
    with _jobs_lock:
        _load_jobs()
        _jobs[job['id']] = job
    threading.Thread(target=_run_captions, args=(job, user, project, clip, media['path'], model, language, look),
                     daemon=True, name='workspace-captions').start()
    return jsonify(_public_job(job)), 202
