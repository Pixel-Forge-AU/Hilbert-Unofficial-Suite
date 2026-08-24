#!/usr/bin/env python3
"""
AI Suite Launcher

A comprehensive workflow launcher for managing and executing AI generation workflows.

Features:
- Flask-based web interface for workflow management
- CLI interface for command-line workflow execution
- Configuration management from suite.yaml
- Registry loading from registry.json
- Workflow dependency resolution
- Model availability checking
- Hardware compatibility validation
- Job queue management
- Progress monitoring
"""

import argparse
import copy
import json
import os
import random
import re
import shlex
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml
from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

sys.path.insert(0, str(Path(__file__).resolve().parent))
from tools import pack_mover
from tools.registry_generator import generate_registry

# Try to import optional dependencies
try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

try:
    import websocket  # websocket-client; used to track live ComfyUI sampling progress
    WEBSOCKET_AVAILABLE = True
except ImportError:
    WEBSOCKET_AVAILABLE = False

try:
    from hilbert_chat import (
        ChatStore,
        USERS as CHAT_USERS,
        extract_search_query,
        format_search_context,
        generate_image_with_comfy,
        looks_like_image_request,
        looks_like_search_request,
        web_search,
    )
    CHAT_AVAILABLE = True
    CHAT_IMPORT_ERROR = ""
except Exception as exc:
    CHAT_AVAILABLE = False
    CHAT_IMPORT_ERROR = str(exc)

__version__ = "3.1.0"
__author__ = "AI Suite Team"


class ConfigManager:
    """Handles loading and managing configuration from suite.yaml."""

    def __init__(self, config_path: str = "config/suite.yaml"):
        """Initialize configuration manager with path to suite.yaml."""
        self.config_path = Path(config_path)
        self.config: Dict[str, Any] = {}
        self._load_config()

    def _load_config(self) -> None:
        """Load configuration from suite.yaml."""
        try:
            if self.config_path.exists():
                with open(self.config_path, 'r') as f:
                    self.config = yaml.safe_load(f)
            else:
                # Default configuration
                self.config = {
                    'suite': {
                        'name': 'AI Suite',
                        'version': '2.0.0',
                        'description': 'Modular ComfyUI workflow platform'
                    },
                    'paths': {
                        'workflows': './workflows',
                        'packs': './packs',
                        'shared': './shared',
                        'presets': './presets',
                        'registry': './registry',
                        'config': './config',
                        'docs': './docs',
                        'tests': './tests',
                        'tools': './tools'
                    },
                    'settings': {
                        'default_width': 1024,
                        'default_height': 1024,
                        'default_steps': 20,
                        'default_guidance': 7.5,
                        'default_sampler': 'euler',
                        'default_scheduler': 'normal',
                        'default_batch_size': 1,
                        'comfyui_host': '127.0.0.1',
                        'comfyui_port': 39003,
                        'comfyui_timeout': 300,
                        'launcher_host': '127.0.0.1',
                        'launcher_port': 39000,
                        'enable_batch_processing': True,
                        'enable_dependency_check': True,
                        'enable_quality_control': True,
                        'enable_workflow_registry': True,
                        'enable_preset_system': True,
                        'max_queue_size': 50,
                        'max_history_size': 100,
                        'queue_release_progress': 90,
                        'output_format': 'webp',
                        'output_quality': 90
                    },
                    'logging': {
                        'level': 'info',
                        'format': 'json',
                        'file': './logs/suite.log'
                    },
                    'dependencies': {
                        'check_nodes': True,
                        'auto_install_optional': False,
                        'show_optional_warnings': True
                    }
                }
        except yaml.YAMLError as e:
            print(f"Warning: Failed to load config from {self.config_path}: {e}")
            self._load_default_config()
        except Exception as e:
            print(f"Warning: Error loading config: {e}")
            self._load_default_config()

    def _load_default_config(self) -> None:
        """Load default configuration."""
        self.config = {
            'suite': {
                'name': 'AI Suite',
                'version': '2.0.0',
                'description': 'Modular ComfyUI workflow platform'
            },
            'paths': {
                'workflows': './workflows',
                'packs': './packs',
                'shared': './shared',
                'presets': './presets',
                'registry': './registry',
                'config': './config',
                'docs': './docs',
                'tests': './tests',
                'tools': './tools'
            },
            'settings': {
                'default_width': 1024,
                'default_height': 1024,
                'default_steps': 20,
                'default_guidance': 7.5,
                'default_sampler': 'euler',
                'default_scheduler': 'normal',
                'default_batch_size': 1,
                'comfyui_host': '127.0.0.1',
                'comfyui_port': 39003,
                'comfyui_timeout': 300,
                'launcher_host': '127.0.0.1',
                'launcher_port': 39000,
                'enable_batch_processing': True,
                'enable_dependency_check': True,
                'enable_quality_control': True,
                'enable_workflow_registry': True,
                'enable_preset_system': True,
                'max_queue_size': 50,
                'max_history_size': 100,
                'queue_release_progress': 90,
                'output_format': 'webp',
                'output_quality': 90
            },
            'logging': {
                'level': 'info',
                'format': 'json',
                'file': './logs/suite.log'
            },
            'dependencies': {
                'check_nodes': True,
                'auto_install_optional': False,
                'show_optional_warnings': True
            }
        }

    def get(self, key: str, default: Any = None) -> Any:
        """Get a configuration value."""
        return self.config.get(key, default)

    def get_setting(self, key: str, default: Any = None) -> Any:
        """Get a setting value."""
        return self.config.get('settings', {}).get(key, default)

    def get_path(self, key: str) -> str:
        """Get a path value."""
        return self.config.get('paths', {}).get(key, '.')

    def get_comfyui_config(self) -> Dict[str, Any]:
        """Get ComfyUI connection configuration."""
        settings = self.config.get('settings', {})
        return {
            'host': settings.get('comfyui_host', '127.0.0.1'),
            'port': settings.get('comfyui_port', 39003),
            'timeout': settings.get('comfyui_timeout', 300)
        }

    def get_launcher_config(self) -> Dict[str, Any]:
        """Get launcher configuration."""
        settings = self.config.get('settings', {})
        return {
            'host': settings.get('launcher_host', '127.0.0.1'),
            'port': settings.get('launcher_port', 39000)
        }


class RegistryManager:
    """Manages workflow registry loading and management."""

    def __init__(self, registry_path: str = "registry/registry.json"):
        """Initialize registry manager with path to registry.json."""
        self.registry_path = Path(registry_path)
        self.registry: Dict[str, Any] = {
            'version': '2.0.0',
            'generated_at': None,
            'workflows': [],
            'packs': [],
            'models': [],
            'custom_nodes': []
        }
        self._load_registry()

    def _load_registry(self) -> None:
        """Load registry from registry.json."""
        try:
            if self.registry_path.exists():
                with open(self.registry_path, 'r') as f:
                    self.registry = json.load(f)
                self.registry['generated_at'] = datetime.now().isoformat()
            else:
                # Create default registry
                self.registry['generated_at'] = datetime.now().isoformat()
        except json.JSONDecodeError as e:
            print(f"Warning: Failed to load registry from {self.registry_path}: {e}")
            self.registry['generated_at'] = datetime.now().isoformat()
        except Exception as e:
            print(f"Warning: Error loading registry: {e}")
            self.registry['generated_at'] = datetime.now().isoformat()

    def get_workflows(self) -> List[Dict[str, Any]]:
        """Get all registered workflows."""
        return self.registry.get('workflows', [])

    def get_workflow_by_id(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """Get a workflow by its ID."""
        for workflow in self.registry.get('workflows', []):
            if workflow.get('id') == workflow_id:
                return workflow
        return None

    def get_packs(self) -> List[Dict[str, Any]]:
        """Get all registered packs."""
        return self.registry.get('packs', [])

    def refresh(self) -> None:
        """Refresh registry from disk."""
        self._load_registry()


class ModelManager:
    """Manages model paths and availability checking."""

    def __init__(self, config_manager: ConfigManager):
        """Initialize model manager with configuration."""
        self.config_manager = config_manager
        self.model_paths: Dict[str, str] = {}
        self._load_model_paths()

    def _load_model_paths(self) -> None:
        """Load model paths from config."""
        paths_config = self.config_manager.config.get('model_paths', {})
        if paths_config:
            self.model_paths = paths_config.get('paths', {})
        else:
            comfy_models = None
            try:
                from ai_manager import load_config

                comfy_dir = Path(load_config().get('COMFYUI_DIR', ''))
                if comfy_dir.exists():
                    comfy_models = comfy_dir / 'models'
            except Exception:
                comfy_models = None

            base = comfy_models if comfy_models and comfy_models.exists() else Path('./models')
            self.model_paths = {
                'checkpoints': str(base / 'checkpoints'),
                'checkpoint': str(base / 'checkpoints'),
                'vae': str(base / 'vae'),
                'lora': str(base / 'loras'),
                'loras': str(base / 'loras'),
                'controlnet': str(base / 'controlnet'),
                'upscale': str(base / 'upscale_models'),
                'upscale_models': str(base / 'upscale_models'),
                'embedding': str(base / 'embeddings'),
                'embeddings': str(base / 'embeddings'),
                'clip': str(base / 'clip'),
                'text_encoders': str(base / 'text_encoders'),
                't5': str(base / 'text_encoders'),
                'segmentation': str(base / 'segmentation'),
                'face_detection': str(base / 'face_detection'),
                'vision_encoder': str(base / 'clip_vision'),
                'clip_vision': str(base / 'clip_vision'),
            }

    def get_model_path(self, model_type: str) -> str:
        """Get path for a model type."""
        if model_type in self.model_paths:
            return self.model_paths[model_type]
        try:
            from ai_manager import load_config

            comfy_dir = Path(load_config().get('COMFYUI_DIR', ''))
            if comfy_dir.exists():
                return str(comfy_dir / 'models' / model_type)
        except Exception:
            pass
        return f'./models/{model_type}'

    def check_model_availability(self, model_name: str, model_type: str) -> bool:
        """Check if a model is available."""
        path = self.get_model_path(model_type)
        model_file = Path(path) / model_name
        return model_file.exists()

    def get_available_models(self, model_type: str) -> List[str]:
        """Get list of available models of a type."""
        path = self.get_model_path(model_type)
        model_dir = Path(path)
        if model_dir.exists():
            return [f.name for f in model_dir.iterdir() if f.is_file()]
        return []


class HardwareManager:
    """Manages hardware profile selection and validation."""

    def __init__(self, config_manager: ConfigManager):
        """Initialize hardware manager with configuration."""
        self.config_manager = config_manager
        self.profiles: Dict[str, Dict[str, Any]] = {}
        self._load_hardware_profiles()

    def _load_hardware_profiles(self) -> None:
        """Load hardware profiles from config."""
        # Load from config file if available
        hardware_profiles = self.config_manager.config.get('hardware_profiles', {})
        if hardware_profiles:
            self.profiles = hardware_profiles.get('profiles', {})
        else:
            # Default profiles
            self.profiles = {
                'low_vram': {
                    'name': 'Low VRAM (4-6GB)',
                    'vram_gb': 4,
                    'recommended_vram_gb': 6,
                    'optimization': {
                        'cpu_offload': True,
                        'low_vram_mode': True,
                        'batch_size': 1,
                        'precision': 'fp16'
                    },
                    'generation_defaults': {
                        'max_resolution': 768,
                        'max_steps': 30,
                        'max_guidance': 8.0
                    },
                    'compatible_workflows': ['core.*', 'editing.*']
                },
                'mid_vram': {
                    'name': 'Mid VRAM (8-12GB)',
                    'vram_gb': 8,
                    'recommended_vram_gb': 12,
                    'optimization': {
                        'cpu_offload': False,
                        'low_vram_mode': False,
                        'batch_size': 2,
                        'precision': 'fp16'
                    },
                    'generation_defaults': {
                        'max_resolution': 1024,
                        'max_steps': 50,
                        'max_guidance': 10.0
                    },
                    'compatible_workflows': ['core.*', 'editing.*', 'character.*', 'horror.*']
                },
                'high_vram': {
                    'name': 'High VRAM (16-24GB)',
                    'vram_gb': 16,
                    'recommended_vram_gb': 24,
                    'optimization': {
                        'cpu_offload': False,
                        'low_vram_mode': False,
                        'batch_size': 4,
                        'precision': 'fp16'
                    },
                    'generation_defaults': {
                        'max_resolution': 2048,
                        'max_steps': 100,
                        'max_guidance': 12.0
                    },
                    'compatible_workflows': ['*']
                },
                'cpu_only': {
                    'name': 'CPU Only',
                    'vram_gb': 0,
                    'recommended_vram_gb': 0,
                    'optimization': {
                        'cpu_offload': True,
                        'low_vram_mode': True,
                        'batch_size': 1,
                        'precision': 'fp32'
                    },
                    'generation_defaults': {
                        'max_resolution': 512,
                        'max_steps': 20,
                        'max_guidance': 5.0
                    },
                    'compatible_workflows': ['core.text-to-image-fast', 'core.outpainting-square-to-landscape']
                }
            }

    def get_profile(self, profile_name: str) -> Optional[Dict[str, Any]]:
        """Get a hardware profile by name."""
        return self.profiles.get(profile_name)

    def select_profile(self, vram_gb: int) -> Dict[str, Any]:
        """Select the best profile for available VRAM."""
        if vram_gb >= 24:
            return self.profiles.get('premium_vram', self.profiles.get('high_vram'))
        elif vram_gb >= 16:
            return self.profiles.get('high_vram')
        elif vram_gb >= 8:
            return self.profiles.get('mid_vram')
        elif vram_gb >= 4:
            return self.profiles.get('low_vram')
        else:
            return self.profiles.get('cpu_only')

    def validate_workflow_compatibility(
        self,
        workflow: Dict[str, Any],
        profile_name: str
    ) -> Tuple[bool, List[str]]:
        """Validate if a workflow is compatible with a hardware profile."""
        warnings = []
        profile = self.get_profile(profile_name)

        if not profile:
            return False, ["Invalid hardware profile"]

        workflow_vram = workflow.get('hardware', {}).get('minimum_vram_gb', 8)

        if profile['vram_gb'] < workflow_vram:
            warnings.append(
                f"Workflow requires {workflow_vram}GB VRAM, "
                f"but {profile_name} only provides {profile['vram_gb']}GB"
            )

        return len(warnings) == 0, warnings


class DependencyManager:
    """Manages workflow dependencies."""

    def __init__(
        self,
        config_manager: ConfigManager,
        model_manager: ModelManager
    ):
        """Initialize dependency manager."""
        self.config_manager = config_manager
        self.model_manager = model_manager
        self.feature_flags = self._load_feature_flags()

    def _load_feature_flags(self) -> Dict[str, Any]:
        """Load feature flags from config."""
        return self.config_manager.config.get('features', {})

    def check_workflow_dependencies(
        self,
        workflow: Dict[str, Any]
    ) -> Tuple[bool, List[str], List[str]]:
        """Check if all dependencies for a workflow are satisfied."""
        errors = []
        warnings = []

        if not self.feature_flags.get('dependency_check', {}).get('enabled', True):
            return True, errors, warnings

        models = workflow.get('models', {})
        required_models = models.get('required', [])
        optional_models = models.get('optional', [])

        for model in required_models:
            model_name = model.get('name', '')
            model_type = model.get('type') or model.get('directory') or 'checkpoint'
            if not model_name:
                continue

            if not self.model_manager.check_model_availability(model_name, model_type):
                errors.append(f"Required model not found: {model_name} ({model_type})")

        for model in optional_models:
            model_name = model.get('name', '')
            model_type = model.get('type') or model.get('directory') or 'checkpoint'
            if not model_name:
                continue

            if not self.model_manager.check_model_availability(model_name, model_type):
                warnings.append(f"Optional model not found: {model_name} ({model_type})")

        custom_nodes = workflow.get('custom_nodes', {})
        required_nodes = custom_nodes.get('required', [])

        # Check for required custom nodes (placeholder - would need actual detection)
        for node in required_nodes:
            if not self._check_custom_node(node):
                warnings.append(f"Optional custom node not found: {node}")

        return len(errors) == 0, errors, warnings

    def _check_custom_node(self, node_name: str) -> bool:
        """Check if a custom node is available."""
        # Placeholder - would need actual custom node detection
        return True


JOBS_STATE_PATH = Path(__file__).resolve().parent / 'state' / 'jobs.json'


class JobQueue:
    """Manages the workflow job queue.

    Jobs are mirrored to JOBS_STATE_PATH on every mutation so a launcher
    restart (crash, redeploy, manual bounce) doesn't silently drop jobs that
    were still queued or running - those get reloaded into running_jobs and
    picked up again by _reconcile_running_jobs() against ComfyUI's own
    history, instead of just vanishing from the in-memory dicts.
    """

    def __init__(self, max_size: int = 50):
        """Initialize job queue."""
        self.max_size = max_size
        self.queued_jobs: Dict[str, Dict[str, Any]] = {}
        self.running_jobs: Dict[str, Dict[str, Any]] = {}
        self.completed_jobs: Dict[str, Dict[str, Any]] = {}
        self.lock = threading.Lock()
        self._load()
        self._cleanup_completed()

    def _load(self) -> None:
        try:
            raw = json.loads(JOBS_STATE_PATH.read_text())
        except (FileNotFoundError, ValueError):
            return
        self.queued_jobs = raw.get('queued_jobs', {})
        # Anything that was "running" when the process last wrote state gets
        # restored as running too - _reconcile_running_jobs() will re-poll
        # ComfyUI by prompt_id and resolve it to completed/failed/stalled.
        self.running_jobs = raw.get('running_jobs', {})
        self.completed_jobs = raw.get('completed_jobs', {})

    def _save(self) -> None:
        try:
            JOBS_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
            tmp_path = JOBS_STATE_PATH.with_suffix('.tmp')
            tmp_path.write_text(json.dumps({
                'queued_jobs': self.queued_jobs,
                'running_jobs': self.running_jobs,
                'completed_jobs': self.completed_jobs,
            }))
            tmp_path.replace(JOBS_STATE_PATH)
        except OSError:
            pass

    def _cleanup_completed(self) -> None:
        """Cleanup old completed jobs."""
        settings = ConfigManager().config.get('settings', {})
        max_history = settings.get('max_history_size', 100)

        if len(self.completed_jobs) > max_history:
            # Keep only the most recent jobs
            sorted_jobs = sorted(
                self.completed_jobs.items(),
                key=lambda x: x[1].get('completed_at', ''),
                reverse=True
            )
            to_remove = sorted_jobs[max_history:]
            for job_id, _ in to_remove:
                del self.completed_jobs[job_id]

    def add_job(
        self,
        workflow_id: str,
        inputs: Dict[str, Any],
        job_id: Optional[str] = None
    ) -> str:
        """Add a job to the queue."""
        with self.lock:
            if len(self.queued_jobs) >= self.max_size:
                raise ValueError("Job queue is full")

            if job_id is None:
                job_id = f"job_{uuid.uuid4().hex[:8]}"

            job = {
                'job_id': job_id,
                'workflow_id': workflow_id,
                'inputs': inputs,
                'status': 'queued',
                'created_at': datetime.now().isoformat(),
                'started_at': None,
                'completed_at': None,
                'progress': 0,
                'result': None,
                'error': None
            }

            self.queued_jobs[job_id] = job
            self._save()
            return job_id

    def start_job(self, job_id: str) -> bool:
        """Mark a job as started."""
        with self.lock:
            if job_id not in self.queued_jobs:
                return False

            job = self.queued_jobs.pop(job_id)
            job['status'] = 'running'
            job['started_at'] = datetime.now().isoformat()
            self.running_jobs[job_id] = job
            self._save()
            return True

    def update_job(
        self,
        job_id: str,
        status: Optional[str] = None,
        progress: Optional[int] = None,
        result: Optional[Dict[str, Any]] = None,
        error: Optional[str] = None
    ) -> bool:
        """Update job status."""
        with self.lock:
            if job_id not in self.running_jobs:
                return False

            job = self.running_jobs[job_id]

            if status:
                job['status'] = status
            if progress is not None:
                job['progress'] = progress
            if result:
                job['result'] = result
            if error:
                job['error'] = error

            if status in ['completed', 'failed', 'cancelled', 'stalled']:
                job['completed_at'] = datetime.now().isoformat()
                self.completed_jobs[job_id] = job
                del self.running_jobs[job_id]

            self._save()
            return True

    def get_job(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get job by ID."""
        with self.lock:
            for jobs_dict in [self.queued_jobs, self.running_jobs, self.completed_jobs]:
                if job_id in jobs_dict:
                    return jobs_dict[job_id].copy()
        return None

    def get_queue(self) -> List[Dict[str, Any]]:
        """Get all queued jobs."""
        with self.lock:
            return [job.copy() for job in self.queued_jobs.values()]

    def reorder_queued_job(self, job_id: str, action: str) -> Optional[int]:
        """Move a queued job and return its new one-based position."""
        with self.lock:
            if job_id not in self.queued_jobs:
                return None

            items = list(self.queued_jobs.items())
            current_index = next(index for index, (queued_id, _job) in enumerate(items) if queued_id == job_id)
            if action == 'up':
                new_index = max(0, current_index - 1)
            elif action == 'down':
                new_index = min(len(items) - 1, current_index + 1)
            elif action == 'top':
                new_index = 0
            elif action == 'bottom':
                new_index = len(items) - 1
            else:
                raise ValueError("Unknown queue move action")

            if new_index != current_index:
                item = items.pop(current_index)
                items.insert(new_index, item)
                self.queued_jobs = dict(items)
                self._save()

            return new_index + 1

    def cancel_queued_job(self, job_id: str) -> bool:
        """Remove a not-yet-dispatched job from the queue and mark it cancelled."""
        with self.lock:
            if job_id not in self.queued_jobs:
                return False
            job = self.queued_jobs.pop(job_id)
            job['status'] = 'cancelled'
            job['completed_at'] = datetime.now().isoformat()
            self.completed_jobs[job_id] = job
            self._save()
            return True

    def get_running(self) -> List[Dict[str, Any]]:
        """Get all running jobs."""
        with self.lock:
            return [job.copy() for job in self.running_jobs.values()]

    def get_completed(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get completed jobs."""
        with self.lock:
            sorted_jobs = sorted(
                self.completed_jobs.items(),
                key=lambda x: x[1].get('completed_at', ''),
                reverse=True
            )
            return [job.copy() for _, job in sorted_jobs[:limit]]

    def clear_completed(self) -> int:
        """Clear all completed jobs."""
        with self.lock:
            count = len(self.completed_jobs)
            self.completed_jobs.clear()
            self._save()
            return count


# ComfyUI only targets "progress" websocket events at the client_id that
# submitted the prompt (see ComfyUI's execution.py hijack_progress /
# send_sync(..., sid=client_id)), so the launcher submits every prompt under
# this one fixed id and keeps a single websocket open under the same id to
# receive them all.
COMFY_WS_CLIENT_ID = str(uuid.uuid4())


class ComfyProgressMonitor:
    """Tracks live per-prompt sampling progress from ComfyUI's websocket feed.

    ComfyUI's REST /history endpoint only exposes coarse states (queued,
    running, done) - there's no percentage in it. Real "90% of the way
    through this render" requires listening for the websocket `progress`
    events ComfyUI emits while a sampler node is stepping through a prompt.
    """

    def __init__(self) -> None:
        self._percent_by_prompt: Dict[str, int] = {}
        self._lock = threading.Lock()
        self._thread: Optional[threading.Thread] = None
        self._stop = False

    def start(self, comfyui_config: Dict[str, Any]) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop = False
        self._thread = threading.Thread(
            target=self._run, args=(comfyui_config,), daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop = True

    def percent_for(self, prompt_id: str) -> Optional[int]:
        with self._lock:
            return self._percent_by_prompt.get(prompt_id)

    def clear(self, prompt_id: str) -> None:
        with self._lock:
            self._percent_by_prompt.pop(prompt_id, None)

    def _run(self, comfyui_config: Dict[str, Any]) -> None:
        host = comfyui_config.get('host', '127.0.0.1')
        port = comfyui_config.get('port', 39003)
        url = f"ws://{host}:{port}/ws?clientId={COMFY_WS_CLIENT_ID}"
        backoff = 1
        while not self._stop:
            ws = None
            try:
                ws = websocket.create_connection(url, timeout=10)
                ws.settimeout(None)  # only the initial connect should time out; idle recv() should block
                backoff = 1
                while not self._stop:
                    raw = ws.recv()
                    if isinstance(raw, str):
                        self._handle_message(raw)
            except Exception:
                pass
            finally:
                if ws is not None:
                    try:
                        ws.close()
                    except Exception:
                        pass
            if self._stop:
                return
            time.sleep(backoff)
            backoff = min(backoff * 2, 30)

    def _handle_message(self, raw: str) -> None:
        try:
            message = json.loads(raw)
        except ValueError:
            return
        if message.get('type') != 'progress':
            return
        data = message.get('data') or {}
        prompt_id = data.get('prompt_id')
        value = data.get('value')
        max_value = data.get('max')
        if not prompt_id or not max_value:
            return
        try:
            percent = round(float(value) / float(max_value) * 100)
        except (TypeError, ZeroDivisionError):
            return
        percent = max(0, min(100, percent))
        with self._lock:
            self._percent_by_prompt[prompt_id] = percent


# A job stuck "running" this long while ComfyUI is unresponsive gets marked
# stalled instead of sitting as "running" forever with no way to retry it -
# see ComfyHealthMonitor and its use in _reconcile_running_jobs().
COMFY_STALE_AFTER_SECONDS = 180


class ComfyHealthMonitor:
    """Polls ComfyUI's lightweight /system_stats endpoint on a background
    thread so the rest of the app can tell "ComfyUI is wedged" apart from
    "this particular job is just slow" without every request paying a
    multi-second timeout to find out.

    Grew out of an incident where ComfyUI hung under swap pressure: its
    process kept running (high CPU, GPU idle) but stopped answering HTTP
    requests entirely, so a finished render never got marked "completed" in
    the job list and looked like it silently vanished, even though the file
    was already safely on disk.
    """

    def __init__(self, check_interval: float = 20.0, timeout: float = 5.0) -> None:
        self.check_interval = check_interval
        self.timeout = timeout
        self._lock = threading.Lock()
        self._status = 'unknown'
        self._last_ok_at: Optional[str] = None
        self._last_error: Optional[str] = None
        self._consecutive_failures = 0
        self._down_since: Optional[str] = None
        self._thread: Optional[threading.Thread] = None
        self._stop = False

    def start(self, comfyui_config: Dict[str, Any]) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop = False
        self._thread = threading.Thread(target=self._run, args=(comfyui_config,), daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop = True

    def _run(self, comfyui_config: Dict[str, Any]) -> None:
        from comfy_studio import comfy_base_url, http_json
        config = {'COMFY_HOST': comfyui_config.get('host', '127.0.0.1'), 'COMFY_PORT': comfyui_config.get('port', 39003)}
        while not self._stop:
            try:
                http_json(f"{comfy_base_url(config)}/system_stats", timeout=self.timeout)
                with self._lock:
                    self._status = 'ok'
                    self._last_ok_at = datetime.now().isoformat()
                    self._last_error = None
                    self._consecutive_failures = 0
                    self._down_since = None
            except Exception as exc:
                with self._lock:
                    self._consecutive_failures += 1
                    self._last_error = str(exc)
                    if self._down_since is None:
                        self._down_since = datetime.now().isoformat()
                    # A single missed check is treated as a blip, not a hang.
                    self._status = 'down' if self._consecutive_failures >= 3 else 'degraded'
            for _ in range(int(self.check_interval)):
                if self._stop:
                    return
                time.sleep(1)

    def snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return {
                'status': self._status,
                'last_ok_at': self._last_ok_at,
                'last_error': self._last_error,
                'consecutive_failures': self._consecutive_failures,
                'down_since': self._down_since,
            }

    def down_seconds(self) -> float:
        with self._lock:
            down_since = self._down_since
            status = self._status
        if status != 'down' or not down_since:
            return 0.0
        try:
            return (datetime.now() - datetime.fromisoformat(down_since)).total_seconds()
        except ValueError:
            return 0.0


class WorkflowManager:
    """Manages workflow loading and execution."""

    def __init__(
        self,
        config_manager: ConfigManager,
        registry_manager: RegistryManager,
        dependency_manager: DependencyManager,
        hardware_manager: HardwareManager
    ):
        """Initialize workflow manager."""
        self.config_manager = config_manager
        self.registry_manager = registry_manager
        self.dependency_manager = dependency_manager
        self.hardware_manager = hardware_manager
        self.workflows: Dict[str, Dict[str, Any]] = {}
        self._comfy_object_info_cache: Optional[Dict[str, Any]] = None
        self._load_workflows()

    def reload(self) -> None:
        """Re-scan the packs directory from scratch (e.g. after a pack was moved between categories)."""
        self.workflows = {}
        self._load_workflows()

    def _load_workflows(self) -> None:
        """Load workflows from packs directory."""
        packs_path = Path(self.config_manager.get_path('packs'))

        if not packs_path.exists():
            print(f"Warning: Packs directory not found: {packs_path}")
        else:
            for pack_dir in packs_path.iterdir():
                if pack_dir.is_dir():
                    for workflow_dir in pack_dir.iterdir():
                        if workflow_dir.is_dir() and (workflow_dir / 'manifest.yaml').exists():
                            self._load_workflow(workflow_dir)

    def _load_workflow(self, workflow_dir: Path) -> None:
        """Load a workflow from its directory."""
        manifest_path = workflow_dir / 'manifest.yaml'
        workflow_path = workflow_dir / 'workflow.json'
        workflow_api_path = workflow_dir / 'workflow-api.json'

        try:
            with open(manifest_path, 'r') as f:
                manifest = yaml.safe_load(f)

            workflow_data = {
                'manifest': manifest,
                'workflow_dir': str(workflow_dir),
                'workflow': None,
                'workflow_api': None
            }

            # Load workflow JSON if exists
            if workflow_path.exists():
                with open(workflow_path, 'r') as f:
                    workflow = json.load(f)
                    if self._is_runnable_workflow(workflow):
                        workflow_data['workflow'] = workflow
            if workflow_api_path.exists():
                with open(workflow_api_path, 'r') as f:
                    workflow_api = json.load(f)
                    if self._is_runnable_workflow(workflow_api):
                        workflow_data['workflow_api'] = workflow_api

            workflow_id = manifest.get('id', workflow_dir.name)
            self.workflows[workflow_id] = workflow_data

        except Exception as e:
            print(f"Warning: Failed to load workflow from {workflow_dir}: {e}")

    def _is_runnable_workflow(self, workflow: Any) -> bool:
        """Return True for Comfy UI graphs or Comfy prompt API mappings."""
        if not isinstance(workflow, dict):
            return False
        if isinstance(workflow.get('nodes'), list):
            return True
        return bool(workflow) and all(
            isinstance(node, dict) and 'class_type' in node
            for node in workflow.values()
        )

    def get_workflows(
        self,
        category: Optional[str] = None,
        search: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """Get workflows with optional filtering."""
        result = []

        for workflow_id, workflow_data in self.workflows.items():
            manifest = workflow_data.get('manifest', {})

            # Filter by category
            if category and manifest.get('category') != category:
                continue

            # Filter by search term
            if search:
                search_lower = search.lower()
                name = manifest.get('name', '').lower()
                description = manifest.get('description', '').lower()
                tags = ' '.join(manifest.get('tags', [])).lower()

                if search_lower not in name and search_lower not in description and search_lower not in tags:
                    continue

            result.append({
                'id': workflow_id,
                'name': manifest.get('name', workflow_id),
                'description': manifest.get('description', ''),
                'category': self._workflow_category(manifest, workflow_id),
                'media_type': self._infer_workflow_media_type(manifest, workflow_id),
                'runnable': self._workflow_is_runnable(workflow_data),
                'missing_nodes': self._missing_comfy_nodes(workflow_data),
                'status': manifest.get('status', 'unknown'),
                'thumbnail': manifest.get('thumbnail', ''),
                'version': manifest.get('version', '1.0.0'),
                'hardware': self._workflow_hardware(manifest),
                'speed': self._workflow_speed_tier(manifest, workflow_id)
            })

        return result

    def _workflow_is_runnable(self, workflow_data: Dict[str, Any]) -> bool:
        manifest = workflow_data.get('manifest', {})
        if self._is_service_workflow(manifest):
            return True
        return bool(
            (workflow_data.get('workflow') or workflow_data.get('workflow_api'))
            and not self._missing_comfy_nodes(workflow_data)
        )

    def _missing_comfy_nodes(self, workflow_data: Dict[str, Any]) -> List[str]:
        manifest = workflow_data.get('manifest') or {}
        if self._is_service_workflow(manifest):
            return []
        workflow = workflow_data.get('workflow_api') or workflow_data.get('workflow')
        if not workflow:
            return []

        if 'nodes' in workflow:
            from comfy_studio import PRIMITIVE_NODE_TYPES, SKIP_NODE_TYPES, expand_subgraphs
            expanded = expand_subgraphs(workflow)
            node_types = [
                node.get('type')
                for node in expanded.get('nodes', [])
                if node.get('type') not in PRIMITIVE_NODE_TYPES
                and node.get('type') not in SKIP_NODE_TYPES
            ]
        else:
            node_types = [
                node.get('class_type')
                for node in workflow.values()
                if isinstance(node, dict)
            ]

        if not node_types:
            return []

        available = self._available_comfy_node_types()
        if available is None:
            return []
        return sorted({
            str(node_type)
            for node_type in node_types
            if node_type and str(node_type) not in available
        })

    def _is_service_workflow(self, manifest: Dict[str, Any]) -> bool:
        """Return True for workflows handled by a local service instead of ComfyUI."""
        runtime = manifest.get('runtime') or {}
        return runtime.get('type') == 'llm_service'

    def _get_comfy_object_info(self) -> Optional[Dict[str, Any]]:
        """Process-lifetime cache of ComfyUI's full /object_info payload - drives
        both node-type availability checks and widget-schema-based prompt
        conversion (see _build_comfy_prompt). No TTL/invalidation: a stale cache
        (e.g. after installing a new custom node) just means it's not recognized
        until this process restarts, same tradeoff the old node-name-only cache
        already made."""
        if self._comfy_object_info_cache is not None:
            return self._comfy_object_info_cache
        if not REQUESTS_AVAILABLE:
            return None

        comfyui_config = self.config_manager.get_comfyui_config()
        try:
            response = requests.get(
                f"http://{comfyui_config['host']}:{comfyui_config['port']}/object_info",
                timeout=5,
            )
            if response.status_code != 200:
                return None
            self._comfy_object_info_cache = response.json()
            return self._comfy_object_info_cache
        except Exception:
            return None

    def _available_comfy_node_types(self) -> Optional[set]:
        object_info = self._get_comfy_object_info()
        if object_info is None:
            return None
        return set(object_info.keys())

    def _workflow_category(self, manifest: Dict[str, Any], workflow_id: str) -> str:
        category = manifest.get('category')
        if category:
            return str(category)
        if workflow_id.startswith('three-d.'):
            return 'three-d'
        return 'uncategorized'

    def _workflow_hardware(self, manifest: Dict[str, Any]) -> Dict[str, Any]:
        hardware = manifest.get('hardware') or {}
        requirements = manifest.get('hardware_requirements') or {}
        if hardware:
            return hardware
        if not requirements:
            return {}
        return {
            'minimum_vram_gb': requirements.get('min_vram_gb'),
            'recommended_vram_gb': requirements.get('recommended_vram_gb'),
            'supports_low_vram': requirements.get('supports_low_vram'),
            'supports_cpu_offload': requirements.get('supports_cpu_offload'),
        }

    # Manifests in the wild use `runtime.class` inconsistently (light/medium/heavy
    # per the schema, but also large/high/low/batch from packs authored before it
    # was tightened up) - normalize whatever's there instead of trusting the enum.
    _SPEED_CLASS_ALIASES = {
        'light': 'fast', 'low': 'fast', 'fast': 'fast',
        'medium': 'medium', 'batch': 'medium',
        'heavy': 'slow', 'large': 'slow', 'high': 'slow', 'slow': 'slow',
    }
    _SPEED_LABELS = {
        'fast': 'Fast',
        'medium': 'Medium',
        'slow': 'Slow (may take a while)',
    }

    def _workflow_speed_tier(self, manifest: Dict[str, Any], workflow_id: str) -> Dict[str, str]:
        """Classify how long a workflow's generations tend to take.

        Prefers an explicit `runtime.class` from the manifest; falls back to a
        heuristic from media type and VRAM footprint for the majority of packs
        (mostly video/3D imports) that don't set one.
        """
        runtime = manifest.get('runtime') or {}
        raw_class = str(runtime.get('class', '')).strip().lower()
        tier = self._SPEED_CLASS_ALIASES.get(raw_class)

        if not tier:
            media_type = self._infer_workflow_media_type(manifest, workflow_id)
            hardware = self._workflow_hardware(manifest)
            try:
                vram = float(hardware.get('recommended_vram_gb') or hardware.get('minimum_vram_gb') or 0)
            except (TypeError, ValueError):
                vram = 0

            if media_type in ('video', 'model'):
                tier = 'slow'
            elif vram >= 20:
                tier = 'slow'
            elif vram >= 12:
                tier = 'medium'
            else:
                tier = 'fast'

        return {'tier': tier, 'label': self._SPEED_LABELS[tier]}

    def _infer_workflow_media_type(self, manifest: Dict[str, Any], workflow_id: str) -> str:
        """Infer the primary output media class used by Studio."""
        explicit = manifest.get('media_type') or manifest.get('mediaType')
        if explicit:
            return 'model' if explicit in ('3d', 'mesh') else str(explicit)

        raw_output_types = manifest.get('output_types')
        if isinstance(raw_output_types, list):
            for output_type in raw_output_types:
                output_type = str(output_type).lower()
                if output_type in ('video', 'mp4', 'webm', 'mov'):
                    return 'video'
                if output_type in ('model', 'mesh', '3d', 'obj', 'gltf', 'glb', 'point_cloud'):
                    return 'model'

        outputs = manifest.get('outputs') or []
        if isinstance(outputs, list):
            has_image = False
            for output in outputs:
                output_type = output.get('type') if isinstance(output, dict) else output
                output_type = str(output_type).lower()
                if output_type in ('video', 'mp4', 'webm', 'mov'):
                    return 'video'
                if output_type in ('model', 'mesh', '3d', 'obj', 'gltf', 'glb', 'point_cloud'):
                    return 'model'
                if output_type in ('image', 'png', 'jpg', 'jpeg', 'webp'):
                    has_image = True
            if has_image:
                return 'image'

        haystack = ' '.join(str(value).lower() for value in [
            workflow_id,
            manifest.get('category', ''),
            manifest.get('subcategory', ''),
            manifest.get('name', ''),
            manifest.get('description', ''),
        ])
        if any(term in haystack for term in ('video', 'animation', 'lip sync', 'talking head')):
            return 'video'
        if any(term in haystack for term in ('three-d', '3d', 'mesh', 'gltf', 'gaussian splat', 'point cloud')):
            return 'model'
        return 'image'

    def get_workflow_by_id(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """Get workflow by ID."""
        return self.workflows.get(workflow_id)

    def check_workflow_dependencies(
        self,
        workflow_id: str
    ) -> Tuple[bool, List[str], List[str]]:
        """Check dependencies for a workflow."""
        workflow_data = self.workflows.get(workflow_id)
        if not workflow_data:
            return False, ["Workflow not found"], []

        return self.dependency_manager.check_workflow_dependencies(workflow_data['manifest'])

    def get_input_fields(self, workflow_id: str) -> List[Dict[str, Any]]:
        """Get input fields for a workflow."""
        workflow_data = self.workflows.get(workflow_id)
        if not workflow_data:
            return []

        return workflow_data['manifest'].get('inputs', [])

    def get_presets(self, workflow_id: str) -> List[Dict[str, Any]]:
        """Get flattened preset values for a workflow pack."""
        workflow_data = self.workflows.get(workflow_id)
        if not workflow_data:
            return []
        workflow_dir = Path(workflow_data.get('workflow_dir') or '')
        presets_dir = workflow_dir / 'presets'
        manifest = workflow_data.get('manifest') or {}
        preset_names = manifest.get('presets') or []
        preset_paths: List[Path] = []
        if presets_dir.exists():
            seen: set = set()
            for name in preset_names:
                for candidate in (presets_dir / f'{name}.yaml', presets_dir / f'{name}.yml'):
                    if candidate.exists():
                        preset_paths.append(candidate)
                        seen.add(candidate)
                        break
            # Union in anything else sitting in presets/ (e.g. user-saved presets from
            # save_preset()) that isn't already named in the manifest's curated list.
            for candidate in sorted(list(presets_dir.glob('*.yaml')) + list(presets_dir.glob('*.yml'))):
                if candidate not in seen:
                    preset_paths.append(candidate)
                    seen.add(candidate)

        presets = []
        for path in preset_paths:
            try:
                with open(path, 'r') as f:
                    data = yaml.safe_load(f) or {}
            except Exception as e:
                presets.append({
                    'id': path.stem,
                    'name': path.stem.replace('-', ' ').title(),
                    'description': f'Could not load preset: {e}',
                    'values': {},
                })
                continue
            presets.append({
                'id': path.stem,
                'name': data.get('name') or path.stem.replace('-', ' ').title(),
                'description': data.get('description') or '',
                'values': self._flatten_preset_values(data),
            })
        return presets

    def _flatten_preset_values(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Flatten nested preset YAML into form-friendly input values."""
        values: Dict[str, Any] = {}

        def walk(prefix: str, item: Any) -> None:
            if isinstance(item, dict):
                for key, value in item.items():
                    if key in ('name', 'description'):
                        continue
                    walk(f'{prefix}.{key}' if prefix else str(key), value)
                return
            key = prefix.split('.')[-1]
            aliases = {
                'sampler': 'sampler_name',
                'guidance': 'cfg',
                'resolution': 'mesh_resolution',
                'intensity': 'muppet_intensity',
                'identity_strength': 'denoise',
            }
            values[key] = item
            if key in aliases:
                values[aliases[key]] = item

        walk('', data)
        return values

    def save_preset(self, workflow_id: str, name: str, values: Dict[str, Any]) -> Dict[str, Any]:
        """Persist the given input values as a new named preset for a workflow pack."""
        workflow_data = self.workflows.get(workflow_id)
        if not workflow_data:
            raise ValueError('Workflow not found')

        title = (name or '').strip()
        if not title:
            raise ValueError('Preset name is required')

        slug = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-') or 'preset'
        workflow_dir = Path(workflow_data.get('workflow_dir') or '')
        presets_dir = workflow_dir / 'presets'
        presets_dir.mkdir(parents=True, exist_ok=True)

        path = presets_dir / f'{slug}.yaml'
        suffix = 2
        while path.exists():
            path = presets_dir / f'{slug}-{suffix}.yaml'
            suffix += 1

        data: Dict[str, Any] = {'name': title, 'description': 'Saved from the Studio workbench.'}
        data.update(values)
        with open(path, 'w') as f:
            yaml.safe_dump(data, f, sort_keys=False)

        return {
            'id': path.stem,
            'name': title,
            'description': data['description'],
            'values': self._flatten_preset_values(data),
        }

    def run_workflow(
        self,
        workflow_id: str,
        inputs: Dict[str, Any]
    ) -> Tuple[bool, Dict[str, Any]]:
        """Run a workflow."""
        workflow_data = self.workflows.get(workflow_id)
        if not workflow_data:
            return False, {'error': 'Workflow not found'}

        manifest = workflow_data.get('manifest', {})
        effective_inputs = self._prepare_workflow_inputs(manifest, inputs)
        if self._is_service_workflow(manifest):
            return self._run_service_workflow(manifest, effective_inputs)

        if not workflow_data.get('workflow') and not workflow_data.get('workflow_api'):
            return False, {
                'error': 'Workflow is not wired to an executable ComfyUI graph yet',
                'workflow_id': workflow_id,
            }

        missing_nodes = self._missing_comfy_nodes(workflow_data)
        if missing_nodes:
            return False, {
                'error': 'Workflow requires ComfyUI nodes that are not installed',
                'workflow_id': workflow_id,
                'missing_nodes': missing_nodes,
            }

        # Check dependencies
        success, errors, warnings = self.check_workflow_dependencies(workflow_id)
        if not success:
            return False, {'error': 'Dependency check failed', 'errors': errors}

        # Get ComfyUI configuration
        comfyui_config = self.config_manager.get_comfyui_config()

        if REQUESTS_AVAILABLE:
            try:
                prompt = self._build_comfy_prompt(workflow_data, effective_inputs)
                response = requests.post(
                    f"http://{comfyui_config['host']}:{comfyui_config['port']}/prompt",
                    json={'prompt': prompt, 'client_id': COMFY_WS_CLIENT_ID},
                    timeout=comfyui_config['timeout'],
                )
                if response.status_code != 200:
                    return False, {'error': f'ComfyUI rejected workflow: {response.text}'}
                result = response.json()
                return True, {
                    'message': 'Workflow queued in ComfyUI',
                    'workflow_id': workflow_id,
                    'prompt_id': result.get('prompt_id'),
                    'inputs': effective_inputs,
                }
            except Exception as e:
                return False, {'error': f'ComfyUI workflow failed: {str(e)}'}
        else:
            return False, {'error': 'requests library not installed'}

        return False, {'error': 'Workflow execution not implemented'}

    def _run_service_workflow(
        self,
        manifest: Dict[str, Any],
        inputs: Dict[str, Any]
    ) -> Tuple[bool, Dict[str, Any]]:
        """Run a non-Comfy workflow through an attached local service."""
        service = (manifest.get('runtime') or {}).get('service')
        if service == 'llama_cpp':
            return self._run_llm_workflow(manifest, inputs)
        return False, {
            'error': f"Unsupported service workflow runtime: {service or 'unknown'}",
            'workflow_id': manifest.get('id'),
        }

    def _run_llm_workflow(
        self,
        manifest: Dict[str, Any],
        inputs: Dict[str, Any]
    ) -> Tuple[bool, Dict[str, Any]]:
        """Run LLM orchestration packs against configured OpenAI-compatible servers."""
        workflow_id = manifest.get('id', '')
        prompt = self._llm_workflow_prompt(workflow_id, inputs)
        if not prompt:
            return False, {'error': f'Unsupported LLM workflow: {workflow_id}'}

        try:
            try:
                from ai_manager import load_config
                runtime_config = load_config()
            except Exception:
                runtime_config = {}

            requested_model = str(inputs.get('llm_model') or '').strip()
            if requested_model.startswith(('gpt-', 'claude-', 'llama-3')):
                requested_model = ''
            endpoints = self._llm_endpoint_candidates(runtime_config, requested_model)
            payload_base = {
                'messages': [
                    {
                        'role': 'system',
                        'content': (
                            'You are the AI Suite local orchestration assistant. '
                            'Return concise, practical results. When JSON is requested, return valid JSON only.'
                        ),
                    },
                    {'role': 'user', 'content': prompt},
                ],
                'temperature': float(inputs.get('temperature', 0.4)),
                'max_tokens': int(inputs.get('max_tokens', 2048)),
            }
            failures = []
            for endpoint in endpoints:
                payload = dict(payload_base)
                payload['model'] = endpoint['model']
                try:
                    response = requests.post(endpoint['url'], json=payload, timeout=180)
                    if response.status_code != 200:
                        failures.append(f"{endpoint['name']}: HTTP {response.status_code} {response.text[:300]}")
                        continue
                    data = response.json()
                    text = (
                        data.get('choices', [{}])[0]
                        .get('message', {})
                        .get('content', '')
                        .strip()
                    )
                    if not text:
                        text = (
                            data.get('choices', [{}])[0]
                            .get('message', {})
                            .get('reasoning_content', '')
                            .strip()
                        )
                    return True, {
                        'message': f"Workflow completed with LLM endpoint {endpoint['name']}",
                        'workflow_id': workflow_id,
                        'service': 'llama_cpp',
                        'endpoint': endpoint['name'],
                        'model': endpoint['model'],
                        'inputs': inputs,
                        'output': {
                            'type': 'text',
                            'text': text,
                        },
                        'outputs': self._shape_llm_outputs(workflow_id, text),
                    }
                except Exception as exc:
                    failures.append(f"{endpoint['name']}: {exc}")
            return False, {
                'error': 'No configured LLM endpoint completed the workflow',
                'workflow_id': workflow_id,
                'attempts': failures,
            }
        except Exception as e:
            return False, {
                'error': f'Local LLM workflow failed: {e}',
                'workflow_id': workflow_id,
            }

    def _llm_endpoint_candidates(self, runtime_config: Dict[str, Any], requested_model: str) -> List[Dict[str, str]]:
        """Build ordered OpenAI-compatible LLM endpoint candidates."""
        candidates: List[Dict[str, str]] = []

        def chat_url(base: str) -> str:
            base = base.strip().rstrip('/')
            if base.endswith('/chat/completions'):
                return base
            if base.endswith('/v1'):
                return f'{base}/chat/completions'
            return f'{base}/v1/chat/completions'

        def connect_host(host: Any) -> str:
            host = str(host or '127.0.0.1')
            return '127.0.0.1' if host in ('0.0.0.0', '::') else host

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
                'url': chat_url(base),
                'model': (model or requested_model or runtime_config.get('LLAMA_ALIAS') or 'local-llama').strip(),
            })

        sidecar_model = requested_model or runtime_config.get('QWEN_SIDECAR_ALIAS') or 'qwen-sidecar'
        candidates.append({
            'name': 'qwen-sidecar',
            'url': chat_url(f"http://{connect_host(runtime_config.get('QWEN_SIDECAR_HOST', '127.0.0.1'))}:{runtime_config.get('QWEN_SIDECAR_PORT', '39002')}"),
            'model': str(sidecar_model),
        })
        main_model = requested_model or runtime_config.get('LLAMA_ALIAS') or 'local-llama'
        candidates.append({
            'name': 'llama',
            'url': chat_url(f"http://{connect_host(runtime_config.get('LLAMA_HOST', '127.0.0.1'))}:{runtime_config.get('LLAMA_PORT', '39001')}"),
            'model': str(main_model),
        })
        ollama_model = requested_model or runtime_config.get('OLLAMA_MODEL') or ''
        if ollama_model:
            candidates.append({
                'name': 'ollama',
                'url': chat_url(f"http://{connect_host(runtime_config.get('OLLAMA_HOST', '127.0.0.1'))}:{runtime_config.get('OLLAMA_PORT', '11434')}"),
                'model': str(ollama_model),
            })
        return candidates

    def _llm_workflow_prompt(self, workflow_id: str, inputs: Dict[str, Any]) -> str:
        """Build a service prompt for each LLM orchestration workflow."""
        if workflow_id == 'llm.prompt-engineer':
            return (
                'Enhance this image-generation prompt.\n\n'
                f"Prompt: {inputs.get('prompt', '')}\n"
                f"Negative prompt: {inputs.get('negative_prompt', '')}\n"
                f"Enhancement level: {inputs.get('enhancement_level', 2)}\n"
                f"Style presets: {inputs.get('style_presets', '')}\n\n"
                'Return JSON with enhanced_prompt, negative_prompt_enhanced, and analysis.'
            )
        if workflow_id == 'llm.workflow-router':
            return (
                'Choose the best AI Suite workflow for this request.\n\n'
                f"Input: {inputs.get('input_text', '')}\n"
                f"Context: {inputs.get('context', '')}\n"
                f"Available workflows: {inputs.get('available_workflows', 'all')}\n\n"
                'Return JSON with selected_workflow, confidence, reasoning, and parameters.'
            )
        if workflow_id == 'llm.iterative-refinement':
            return (
                'Refine this content through a short iterative critique-and-rewrite loop.\n\n'
                f"Initial content: {inputs.get('initial_content', '')}\n"
                f"Iterations requested: {inputs.get('refinement_iterations', 3)}\n"
                f"Focus: {inputs.get('refinement_focus', 'overall quality')}\n\n"
                'Return JSON with final_content, iteration_history, feedback_summary, and improvement_metrics.'
            )
        if workflow_id == 'llm.best-of-n':
            return (
                'Generate multiple variants and choose the best one.\n\n'
                f"Base prompt: {inputs.get('input_prompt', '')}\n"
                f"Number of variants: {inputs.get('num_variants', 3)}\n"
                f"Evaluation criteria: {inputs.get('evaluation_criteria', 'quality, creativity, relevance')}\n\n"
                'Return JSON with selected_variant, variant_scores, evaluation_reasoning, and all_variants.'
            )
        if workflow_id == 'llm.song-structure':
            return (
                'Plan a song structure and lyrics for a chained music-video generation pipeline.\n\n'
                f"Concept: {inputs.get('concept', '')}\n"
                f"Style tags: {inputs.get('tags', '')}\n"
                f"Target total duration (seconds): {inputs.get('duration', 180)}\n\n"
                'Break the song into an ordered list of sections (e.g. intro, verse-1, chorus-1, '
                'verse-2, chorus-2, bridge, outro - adapt to what suits the concept). For each '
                'section give: "name", a rough "duration_seconds" guess (all sections should sum to '
                'roughly the target total duration), "lyrics" (actual lyric lines for that section, '
                'joined with \\n; use an empty string for instrumental sections like intro/outro), '
                'and "scene" (a short, concrete visual description of album-art/film-still quality '
                'for that section, distinct from the other sections\' scenes so the video has real '
                'visual variety across the song).\n\n'
                'Also suggest an overall "bpm" (integer, a tempo that fits the concept and style tags) '
                'and "key" (one of: C major, C minor, C# major, C# minor, D major, D minor, D# major, '
                'D# minor, E major, E minor, F major, F minor, F# major, F# minor, G major, G minor, '
                'G# major, G# minor, A major, A minor, A# major, A# minor, B major, B minor).\n\n'
                'Return JSON only, shaped exactly as: '
                '{"bpm": <int>, "key": <string>, "sections": ['
                '{"name": <string>, "duration_seconds": <number>, "lyrics": <string>, "scene": <string>}, ...'
                ']}'
            )
        if workflow_id == 'llm.image-critic':
            return (
                'Critique an image-generation result from the available metadata.\n\n'
                f"Image file: {inputs.get('image', '')}\n"
                f"Original prompt: {inputs.get('original_prompt', '')}\n"
                f"Critique depth: {inputs.get('critique_depth', 2)}\n"
                f"Focus areas: {inputs.get('focus_areas', 'all')}\n\n"
                'Return JSON with critique, strengths, weaknesses, and score. '
                'If the image pixels are unavailable, say that the critique is based on metadata only.'
            )
        return ''

    def _shape_llm_outputs(self, workflow_id: str, text: str) -> Dict[str, Any]:
        """Expose a stable output key for UI/job history consumers."""
        primary = {
            'llm.prompt-engineer': 'enhanced_prompt',
            'llm.workflow-router': 'selected_workflow',
            'llm.iterative-refinement': 'final_content',
            'llm.best-of-n': 'selected_variant',
            'llm.image-critic': 'critique',
            'llm.song-structure': 'sections',
        }.get(workflow_id, 'text')
        outputs = {
            primary: text,
            'raw_response': text,
        }
        parsed = self._parse_llm_json(text)
        if isinstance(parsed, dict):
            outputs.update(parsed)
            outputs['parsed_response'] = parsed
        return outputs

    def _parse_llm_json(self, text: str) -> Optional[Dict[str, Any]]:
        """Parse a JSON object from an LLM response when the workflow requested one."""
        candidate = (text or '').strip()
        if candidate.startswith('```'):
            lines = candidate.splitlines()
            if lines and lines[0].startswith('```'):
                lines = lines[1:]
            if lines and lines[-1].startswith('```'):
                lines = lines[:-1]
            candidate = '\n'.join(lines).strip()
        start = candidate.find('{')
        end = candidate.rfind('}')
        if start == -1 or end == -1 or end <= start:
            return None
        try:
            parsed = json.loads(candidate[start:end + 1])
        except Exception:
            return None
        return parsed if isinstance(parsed, dict) else None

    def _build_comfy_prompt(
        self,
        workflow_data: Dict[str, Any],
        inputs: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Convert a stored Comfy UI workflow into prompt API JSON."""
        manifest = workflow_data.get('manifest') or {}
        inputs = self._prepare_workflow_inputs(manifest, inputs)
        workflow = workflow_data.get('workflow_api') or workflow_data.get('workflow')

        if not workflow:
            raise ValueError('Workflow JSON is missing or unsupported')

        if 'nodes' not in workflow:
            prompt = copy.deepcopy(workflow)
        else:
            from comfy_studio import workflow_to_api

            # Widget names/order/defaults come from ComfyUI's own live
            # /object_info schema (see workflow_to_api), not a hardcoded table -
            # this is the one converter for every pack now, "v1" or not.
            prompt = workflow_to_api(workflow, object_info=self._get_comfy_object_info())
            self._apply_generic_input_routing(prompt, workflow, inputs)

        self._apply_manifest_controls(prompt, manifest, inputs)
        self._finalize_workflow_prompt(prompt, manifest, inputs)
        return prompt

    def _apply_generic_input_routing(
        self,
        prompt: Dict[str, Any],
        workflow: Dict[str, Any],
        inputs: Dict[str, Any]
    ) -> None:
        """Route Studio-level generic control values (inputs.get(...)) onto
        nodes by type/role - e.g. which CLIPTextEncode is positive vs negative
        (by title), or which node gets the 'checkpoint' control. This is Studio
        UX logic, independent of ComfyUI's own widget schema (already applied
        by workflow_to_api), so it stays as an explicit per-node-type table
        (_widget_inputs_for_node) rather than being schema-driven."""
        from comfy_studio import expand_subgraphs

        expanded = expand_subgraphs(workflow)
        nodes_by_id = {str(node.get('id')): node for node in expanded.get('nodes', [])}

        for node_id, prompt_node in prompt.items():
            if not isinstance(prompt_node, dict):
                continue
            node = nodes_by_id.get(node_id)
            if node is None:
                continue
            node_inputs = prompt_node.setdefault('inputs', {})
            routed = self._widget_inputs_for_node(prompt_node.get('class_type'), node, inputs)
            # Plain assignment, not setdefault: _widget_inputs_for_node only ever
            # returns a key when there's a genuine Studio-level override for it,
            # so it must win over the schema-derived raw-file default
            # workflow_to_api already put there.
            node_inputs.update(routed)

    def _finalize_workflow_prompt(
        self,
        prompt: Dict[str, Any],
        manifest: Dict[str, Any],
        inputs: Dict[str, Any]
    ) -> None:
        """Apply workflow-specific prompt fixes after normal conversion."""
        for node in prompt.values():
            class_type = node.get('class_type')
            node_inputs = node.setdefault('inputs', {})
            if class_type == 'LoadVideo':
                if 'file' not in node_inputs and node_inputs.get('video'):
                    node_inputs['file'] = node_inputs.get('video')
            elif class_type == 'SaveVideo':
                node_inputs.setdefault('filename_prefix', inputs.get('filename_prefix') or 'video/ai-suite')
                node_inputs.setdefault('format', 'auto')
                node_inputs.setdefault('codec', 'auto')
            elif class_type == 'SaveAudio':
                if inputs.get('filename_prefix'):
                    node_inputs['filename_prefix'] = inputs.get('filename_prefix')
                else:
                    node_inputs.setdefault('filename_prefix', 'audio/ai-suite')
            elif class_type == 'DiffRhythmRun':
                # edit is declared optional but has no Python-side default; the node errors without it.
                node_inputs.setdefault('edit', False)
            elif class_type == 'UpscaleModelLoader':
                node_inputs.setdefault('model_name', inputs.get('model_name') or 'RealESRGAN_x4plus.safetensors')

        if manifest.get('id') == 'video.wan21-vace-character-in-scene':
            # model_variant is a UI-only control (no node_id/input of its own in
            # the manifest) since one selection needs to swap two nodes to two
            # different, unrelated filenames at once - not something the generic
            # one-control-to-one-input mapping in _apply_manifest_controls can
            # express. '14' is enough to catch "14B"/"14b"/etc; anything else
            # (including unset) keeps the 1.3B pair already baked into the
            # workflow's own saved widgets_values.
            if str(inputs.get('model_variant') or '').strip().startswith('14'):
                if '113' in prompt:
                    prompt['113'].setdefault('inputs', {})['unet_name'] = 'wan2.1_vace_14B_fp16.safetensors'
                if '115' in prompt:
                    prompt['115'].setdefault('inputs', {})['lora_name'] = 'Wan21_CausVid_14B_T2V_lora_rank32.safetensors'

        if manifest.get('id') == 'editing.background-removal' and 'studio_save_background_removal' not in prompt:
            if '19_sg_16' in prompt:
                prompt['studio_save_background_removal'] = {
                    'class_type': 'SaveImage',
                    'inputs': {
                        'images': ['19_sg_16', 0],
                        'filename_prefix': inputs.get('filename_prefix') or 'ai-suite/background-removal',
                    },
                }
        if manifest.get('id') in ('three-d.multiview', 'three-d.scan-completion'):
            conditioning = prompt.get('65')
            if conditioning and conditioning.get('class_type') == 'Hunyuan3Dv2ConditioningMultiView':
                # The source UI graph has bypassed left/right view branches. The
                # bypass remap can connect CLIP_VISION directly into sockets that
                # require CLIP_VISION_OUTPUT, so only submit the exposed front/back
                # encoded views.
                conditioning.setdefault('inputs', {}).pop('left', None)
                conditioning.setdefault('inputs', {}).pop('right', None)
        if manifest.get('id') == 'studio.image-to-image-qwen-edit':
            if '102_sg_77' in prompt:
                prompt['102_sg_77'].setdefault('inputs', {}).setdefault('prompt', '')
            if '102_sg_89' in prompt:
                prompt['102_sg_89'].setdefault('inputs', {}).setdefault('strength_model', 1.0)
            if '102_sg_75' in prompt:
                prompt['102_sg_75'].setdefault('inputs', {}).setdefault('strength', 1.0)
        if manifest.get('id') == 'studio.extract-video-frame-blueprint' and '98_sg_3' in prompt:
            prompt['studio_save_extracted_frame'] = {
                'class_type': 'SaveImage',
                'inputs': {
                    'images': ['98_sg_3', 0],
                    'filename_prefix': inputs.get('filename_prefix') or 'ai-suite/extracted-frame',
                },
            }
        if manifest.get('id') == 'three-d.gaussian-splats':
            if '88_sg_95' in prompt:
                prompt['88_sg_95'].setdefault('inputs', {})['mask'] = ['99', 1]
            if '79' in prompt:
                prompt['79'].setdefault('inputs', {}).update({
                    'mode': 'orbit',
                    'mode.yaw': 35.0,
                    'mode.pitch': 30.0,
                    'mode.distance': 2.5,
                    'target_x': 0.0,
                    'target_y': 0.0,
                    'target_z': 0.0,
                    'roll': 0.0,
                    'fov': 35.0,
                    'zoom': 1.0,
                    'camera_type': 'perspective',
                })
            if '88_sg_97' in prompt:
                prompt['88_sg_97'].setdefault('inputs', {}).update({
                    'octree_level': 5,
                    'num_gaussians': int(inputs.get('preview_gaussians') or 16384),
                    'yaw': 90.0,
                    'pitch': 15.0,
                    'point_size': 2,
                })
            if '88_sg_2' in prompt:
                prompt['88_sg_2'].setdefault('inputs', {}).update({
                    'erode_radius': 1,
                    'size': int(inputs.get('preprocess_size') or 1024),
                })
            if '88_sg_55' in prompt:
                prompt['88_sg_55'].setdefault('inputs', {}).update({
                    'num_gaussians': int(inputs.get('num_gaussians') or 262144),
                    'seed': int(inputs.get('splat_seed') or inputs.get('seed') or 0),
                })
            if '75' in prompt:
                prompt['75'].setdefault('inputs', {}).update({
                    'width': int(inputs.get('render_width') or 1024),
                    'height': int(inputs.get('render_height') or 1024),
                    'frames': int(inputs.get('render_frames') or 75),
                    'splat_scale': 1.0,
                    'sharpen': 2.0,
                    'headlight_shading': 0.0,
                    'opacity_threshold': 0.0,
                    'render_style': 'color',
                    'background': '#848484',
                })
            if '42' in prompt:
                prompt['42'].setdefault('inputs', {}).update({
                    'format': 'auto',
                    'codec': 'auto',
                })

    def _prepare_workflow_inputs(
        self,
        manifest: Dict[str, Any],
        inputs: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Normalize workflow-specific inputs before prompt construction."""
        prepared = dict(inputs or {})
        workflow_id = manifest.get('id')
        if workflow_id == 'character.character-sheet':
            prepared = self._prepare_character_sheet_inputs(prepared)
        elif workflow_id == 'character.identity-consistency':
            prepared = self._prepare_identity_consistency_inputs(prepared)
        elif workflow_id in ('video.talking-head', 'video.lip-sync'):
            prepared = self._prepare_infinitetalk_inputs(prepared)
        elif workflow_id == 'weird.alternate-universe':
            prepared = self._prepare_alternate_universe_inputs(prepared)
        elif workflow_id == 'weird.corporate-nightmare':
            prepared = self._prepare_corporate_nightmare_inputs(prepared)
        return prepared

    def _prepare_alternate_universe_inputs(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Compose alternate-universe controls into the prompt text."""
        prepared = dict(inputs)
        subject = str(prepared.get('prompt') or 'a mysterious city').strip()
        universe_type = str(prepared.get('universe_type') or 'cyberpunk').replace('-', ' ')
        palette = str(prepared.get('color_palette') or 'neon-cyberpunk').replace('-', ' ')
        shift = prepared.get('reality_shift', 0.7)
        prepared['prompt'] = (
            f'{subject}, alternate {universe_type} universe, {palette} color palette, '
            f'reality shift intensity {shift}, surreal physics, vivid worldbuilding, coherent composition'
        )
        prepared.setdefault('negative_prompt', 'text, watermark, logo, low quality, blurry')
        return prepared

    def _prepare_corporate_nightmare_inputs(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Compose corporate-nightmare controls into the prompt text."""
        prepared = dict(inputs)
        subject = str(prepared.get('prompt') or 'an office presentation').strip()
        intensity = prepared.get('branding_intensity', 0.8)
        logo_count = prepared.get('logo_count', 5)
        font_style = str(prepared.get('font_style') or 'corporate-sans').replace('-', ' ')
        color_scheme = str(prepared.get('color_scheme') or 'corporate-blue').replace('-', ' ')
        prepared['prompt'] = (
            f'{subject}, corporate nightmare, dystopian branding satire, {color_scheme} palette, '
            f'{font_style} typography mood, excessive brand system with about {logo_count} logo-like marks, '
            f'branding intensity {intensity}, polished but unsettling office design'
        )
        prepared.setdefault('negative_prompt', 'text, watermark, unreadable typography, malformed letters, low quality, blurry')
        return prepared

    def _prepare_character_sheet_inputs(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Compose a user character description into an actual character sheet prompt."""
        prepared = dict(inputs)
        character = str(prepared.get('prompt') or '').strip()
        if not character:
            character = 'original character design'
        if character.lower().startswith('character model sheet, reference sheet,'):
            return prepared
        layout = str(prepared.get('view_configuration') or '3-view').strip().lower()
        layout_prompts = {
            '3-view': (
                'three full-body turnaround views in one image: front view, side profile view, '
                'and back view, aligned left to right in separate clean panels'
            ),
            '4-view': (
                'four full-body turnaround views in one image: front view, three-quarter view, '
                'side profile view, and back view, aligned left to right in separate clean panels'
            ),
            'character-design': (
                'professional character design reference sheet with full-body front and back views, '
                'detail callouts for outfit and accessories, consistent proportions and materials'
            ),
        }
        layout_prompt = layout_prompts.get(layout, layout_prompts['3-view'])
        prepared['prompt'] = (
            f'character model sheet, reference sheet, {layout_prompt}, same character repeated, '
            f'same face, same hairstyle, same outfit, consistent identity, orthographic studio lighting, '
            f'neutral plain background, animation production turnaround sheet, no text labels, {character}'
        )
        existing_negative = str(prepared.get('negative_prompt') or '').strip()
        sheet_negative = (
            'single portrait, single character only, close-up headshot, cropped body, different outfits, '
            'different people, inconsistent identity, random poses, action scene, background scene, text, '
            'labels, watermark, logo, blurry, low quality'
        )
        prepared['negative_prompt'] = f'{existing_negative}, {sheet_negative}' if existing_negative else sheet_negative
        prepared.setdefault('width', 1536)
        prepared.setdefault('height', 768)
        return prepared

    def _prepare_identity_consistency_inputs(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Compose a user description into a reference-preserving img2img prompt."""
        prepared = dict(inputs)
        for alias in ('identity_reference', 'reference_image', 'input_image', 'image', '78.image'):
            if not prepared.get('identity_image') and prepared.get(alias):
                prepared['identity_image'] = prepared[alias]

        mode = str(prepared.get('identity_mode') or 'balanced').strip().lower()
        if mode not in ('strict', 'balanced', 'creative'):
            mode = 'balanced'
        if 'edit_strength' not in prepared:
            if 'identity_strength' in prepared:
                prepared['edit_strength'] = prepared['identity_strength']
            elif 'denoise' in prepared:
                prepared['edit_strength'] = prepared['denoise']
            else:
                prepared['edit_strength'] = {
                    'strict': 0.16,
                    'balanced': 0.22,
                    'creative': 0.34,
                }[mode]
        else:
            strength = float(prepared['edit_strength'])
            prepared['edit_strength'] = min(strength, {
                'strict': 0.24,
                'balanced': 0.34,
                'creative': 0.55,
            }[mode])

        subject = str(
            prepared.get('prompt')
            or ''
        ).strip()
        if not subject:
            subject = 'make a polished portrait of the same person'
        if subject.lower().startswith('portrait of the same person from the reference image,'):
            return prepared

        mode_guidance = {
            'strict': (
                'preserve the exact facial structure, same eye shape, same nose, same mouth, same hairstyle, '
                'same age, same expression, same pose and framing'
            ),
            'balanced': (
                'preserve facial structure, eyes, nose, mouth, age, hairstyle, and recognizable character identity'
            ),
            'creative': (
                'keep the subject recognizable as the same person or character, preserve core facial features'
            ),
        }[mode]
        prepared['prompt'] = (
            'portrait of the same person from the reference image, '
            f'{mode_guidance}, consistent character identity, {subject}'
        )
        existing_negative = str(prepared.get('negative_prompt') or '').strip()
        identity_negative = (
            'different person, changed identity, different face, face morph, altered facial structure, '
            'changed hairstyle, changed age, distorted face, extra face, clone mismatch, low quality, '
            'blurry, text, watermark'
        )
        prepared['negative_prompt'] = f'{existing_negative}, {identity_negative}' if existing_negative else identity_negative
        return prepared

    def _prepare_infinitetalk_inputs(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        """Normalize single-speaker InfiniteTalk image/audio inputs."""
        prepared = dict(inputs)
        for alias in ('source_image', 'portrait_image', 'reference_image', 'input_image'):
            if not prepared.get('image') and prepared.get(alias):
                prepared['image'] = prepared[alias]
        for alias in ('source_audio', 'voice_audio', 'speech_audio', 'input_audio'):
            if not prepared.get('audio') and prepared.get(alias):
                prepared['audio'] = prepared[alias]
        frames = int(float(prepared.get('frames') or prepared.get('length') or 81))
        if frames < 5:
            frames = 5
        remainder = (frames - 1) % 4
        if remainder:
            frames += 4 - remainder
        prepared['frames'] = frames
        motion_frames = int(float(prepared.get('motion_frame_count') or 9))
        prepared['motion_frame_count'] = max(1, min(motion_frames, max(1, frames - 1)))
        if not str(prepared.get('prompt') or '').strip():
            prepared['prompt'] = (
                'A natural close portrait video of the subject speaking with clear lip movement, '
                'subtle head motion, stable identity, and steady camera framing.'
            )
        return prepared

    def _apply_manifest_controls(
        self,
        prompt: Dict[str, Any],
        manifest: Dict[str, Any],
        inputs: Dict[str, Any]
    ) -> None:
        """Apply manifest-declared node/input controls to an API prompt."""
        for control in manifest.get('inputs', []) or []:
            node_id = str(control.get('node_id') or '')
            input_name = control.get('input')
            if not node_id or not input_name or node_id not in prompt:
                continue

            raw_value = inputs.get(control.get('id'), control.get('default', ''))
            value = self._coerce_manifest_input(control, raw_value)
            if input_name in ('seed', 'noise_seed') and raw_value in (None, '', -1, '-1'):
                value = random.randint(0, 2**63 - 1)
            if input_name == 'filename_prefix' and not str(value or '').strip():
                value = f"ai-suite/{int(time.time())}"
            prompt[node_id].setdefault('inputs', {})[input_name] = value

    def _coerce_manifest_input(self, control: Dict[str, Any], value: Any) -> Any:
        input_type = control.get('type')
        if input_type == 'boolean':
            if isinstance(value, str):
                return value.lower() in ('1', 'true', 'yes', 'on')
            return bool(value)
        if input_type == 'int':
            return int(float(value)) if value not in ('', None) else 0
        if input_type == 'float':
            return float(value) if value not in ('', None) else 0.0
        return value

    def _widget_inputs_for_node(
        self,
        class_type: str,
        node: Dict[str, Any],
        inputs: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Studio-level generic control routing: map the flat 'inputs' values a
        workflow run was called with onto specific nodes by type/role (e.g.
        which CLIPTextEncode is positive vs negative, by title, based on
        node.get('title')/its saved default text). Only returns a key when
        there's an actual Studio-level override to apply for it - the caller
        (_apply_generic_input_routing) assigns it directly into the prompt, so
        it wins over the schema-derived raw-file default workflow_to_api
        already filled in. Widget name/order/default filling for every other
        input lives in comfy_studio.workflow_to_api instead, driven by
        ComfyUI's own live /object_info schema rather than a hand-maintained
        per-node-type table (which is what this function used to also do, and
        why most of its former branches are gone - they never referenced
        `inputs` at all, just guessed a widget order)."""
        widgets = list(node.get('widgets_values') or [])
        values: Dict[str, Any] = {}

        if class_type == 'CheckpointLoaderSimple':
            if inputs.get('checkpoint'):
                values['ckpt_name'] = self._normalize_checkpoint(str(inputs['checkpoint']))
        elif class_type == 'CLIPTextEncode':
            title = str(node.get('title') or '').lower()
            default_text = widgets[0] if widgets else ''
            is_negative = 'negative' in title or 'low quality' in str(default_text).lower()
            key = 'negative_prompt' if is_negative else 'prompt'
            if key in inputs:
                values['text'] = inputs[key]
        elif class_type == 'EmptyLatentImage':
            for name in ('width', 'height', 'batch_size'):
                if name in inputs:
                    values[name] = int(inputs[name])
        elif class_type == 'ImageScale':
            if inputs.get('upscale_method'):
                values['upscale_method'] = inputs['upscale_method']
            if 'width' in inputs:
                values['width'] = int(inputs['width'])
            if 'height' in inputs:
                values['height'] = int(inputs['height'])
            if inputs.get('crop'):
                values['crop'] = inputs['crop']
        elif class_type == 'ImageScaleBy':
            if inputs.get('upscale_method'):
                values['upscale_method'] = inputs['upscale_method']
            if 'scale_by' in inputs:
                values['scale_by'] = float(inputs['scale_by'])
        elif class_type == 'GrowMask':
            if 'mask_feather' in inputs:
                values['expand'] = int(inputs['mask_feather'])
        elif class_type == 'KSampler':
            if 'seed' in inputs:
                seed = inputs['seed']
                values['seed'] = random.randint(0, 2**63 - 1) if seed in (None, '', -1, '-1') else int(seed)
            if 'steps' in inputs:
                values['steps'] = int(inputs['steps'])
            if 'cfg' in inputs:
                values['cfg'] = float(inputs['cfg'])
            sampler = inputs.get('sampler_name') or inputs.get('sampler')
            if sampler:
                values['sampler_name'] = sampler
            if inputs.get('scheduler'):
                values['scheduler'] = inputs['scheduler']
            denoise = inputs.get('denoise', inputs.get('edit_strength'))
            if denoise is not None:
                values['denoise'] = float(denoise)
        elif class_type == 'KSamplerAdvanced':
            if 'seed' in inputs:
                seed = inputs['seed']
                values['noise_seed'] = random.randint(0, 2**63 - 1) if seed in (None, '', -1, '-1') else int(seed)
            if 'steps' in inputs:
                values['steps'] = int(inputs['steps'])
            if 'cfg' in inputs:
                values['cfg'] = float(inputs['cfg'])
            if inputs.get('sampler_name'):
                values['sampler_name'] = inputs['sampler_name']
            if inputs.get('scheduler'):
                values['scheduler'] = inputs['scheduler']
        elif class_type in ('SaveImage', 'SaveVideo', 'VHS_VideoCombine'):
            if inputs.get('filename_prefix'):
                values['filename_prefix'] = inputs['filename_prefix']
        elif class_type == 'RenderSplat':
            for name, key in (('width', 'render_width'), ('height', 'render_height'), ('frames', 'render_frames')):
                if key in inputs:
                    values[name] = int(inputs[key])
        elif class_type == 'TripoSplatPreprocessImage':
            if 'preprocess_size' in inputs:
                values['size'] = int(inputs['preprocess_size'])
        elif class_type == 'TripoSplatSamplingPreview':
            if 'preview_gaussians' in inputs:
                values['num_gaussians'] = int(inputs['preview_gaussians'])
        elif class_type == 'VAEDecodeTripoSplat':
            if 'num_gaussians' in inputs:
                values['num_gaussians'] = int(inputs['num_gaussians'])
            if 'splat_seed' in inputs:
                values['seed'] = int(inputs['splat_seed'])
        elif class_type == 'TextEncodeAceStepAudio1.5':
            if 'duration' in inputs:
                values['duration'] = float(inputs['duration'])

        return values

    def _normalize_checkpoint(self, checkpoint: str) -> str:
        aliases = {
            'flux': 'juggernaut-xl-v9.safetensors',
            'sdxl': 'sdxl.safetensors',
            'sd15': 'sdxl.safetensors',
            'sd3': 'sdxl.safetensors',
        }
        if checkpoint in aliases:
            return aliases[checkpoint]
        if not checkpoint.endswith(('.safetensors', '.ckpt', '.pt', '.pth')):
            return f"{checkpoint}.safetensors"
        return checkpoint

# Global instances
config_manager: Optional[ConfigManager] = None
registry_manager: Optional[RegistryManager] = None
model_manager: Optional[ModelManager] = None
hardware_manager: Optional[HardwareManager] = None
dependency_manager: Optional[DependencyManager] = None
job_queue: Optional[JobQueue] = None
workflow_manager: Optional[WorkflowManager] = None
progress_monitor: Optional[ComfyProgressMonitor] = None
comfy_health_monitor: Optional[ComfyHealthMonitor] = None
chat_store: Optional[Any] = None


SERVICE_COMMANDS = {
    'llama',
    'llama-restart',
    'llama-heretic',
    'llama-heretic-restart',
    'llama-heretic27',
    'llama-heretic27-restart',
    'llama-small',
    'qwen-sidecar',
    'qwen-sidecar-stop',
    'ollama',
    'ollama-stop',
    'ollama-restart',
    'chat-sidecar',
    'chat-ollama',
    'chat',
    'studio',
    'playwright',
    'planner',
    'planner-stop',
    'planner-setup',
    'orchestrator',
    'orchestrator-stop',
    'orchestrator-setup',
    'genesis',
    'genesis-stop',
    'openhands',
    'openhands-stop',
    'pipeline-dashboard',
    'pipeline-dashboard-stop',
    'hilbert',
    'hilbert-heretic',
    'hilbert-heretic27',
    'hilbert-small',
    'hilbert-ollama',
    'comfy',
    'stop',
    'status',
    'diag',
    'health',
    'monitor-start',
    'monitor-stop',
    'display-safe-on',
    'display-safe-off',
    'display-safe-toggle',
    'display-safe-status',
}


def run_service_command(command: str, timeout: int = 120) -> Tuple[int, str]:
    """Run a local AI switcher command from the suite root."""
    if command not in SERVICE_COMMANDS:
        return 2, f"Unknown service command: {command}"

    root = Path(__file__).resolve().parent
    switcher = root / "ai-switch"
    try:
        result = subprocess.run(
            [str(switcher), command],
            cwd=str(root),
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
        return 127, f"Missing switcher script: {switcher}"


def endpoint_models_url(chat_url: str) -> str:
    """Return the companion /models URL for an OpenAI-compatible chat URL."""
    url = chat_url.rstrip('/')
    if url.endswith('/chat/completions'):
        return url[: -len('/chat/completions')] + '/models'
    if url.endswith('/v1'):
        return f'{url}/models'
    return f'{url}/v1/models'


def check_llm_endpoint(endpoint: Dict[str, str]) -> Dict[str, Any]:
    """Probe a configured LLM endpoint without running an expensive completion."""
    result: Dict[str, Any] = {
        'name': endpoint.get('name', 'unknown'),
        'url': endpoint.get('url', ''),
        'model': endpoint.get('model', ''),
        'online': False,
        'status': 'unchecked',
        'models': [],
    }
    if not REQUESTS_AVAILABLE:
        result['status'] = 'requests unavailable'
        return result

    models_url = endpoint_models_url(result['url'])
    result['models_url'] = models_url
    try:
        response = requests.get(models_url, timeout=2.5)
        result['http_status'] = response.status_code
        if response.status_code == 200:
            result['online'] = True
            result['status'] = 'online'
            payload = response.json()
            models = payload.get('data') if isinstance(payload, dict) else []
            if isinstance(models, list):
                result['models'] = [
                    str(item.get('id') or item.get('name') or item)
                    for item in models[:20]
                ]
        else:
            result['status'] = f'HTTP {response.status_code}'
    except Exception as exc:
        result['status'] = str(exc)
    return result


def initialize_app() -> None:
    """Initialize the application components."""
    global config_manager, registry_manager, model_manager, hardware_manager, dependency_manager, job_queue, workflow_manager, progress_monitor, comfy_health_monitor, chat_store

    # Initialize configuration manager
    config_manager = ConfigManager()

    # Initialize registry manager
    registry_manager = RegistryManager()

    # Initialize model manager
    model_manager = ModelManager(config_manager)

    # Initialize hardware manager
    hardware_manager = HardwareManager(config_manager)

    # Initialize dependency manager
    dependency_manager = DependencyManager(config_manager, model_manager)

    # Initialize job queue
    job_queue = JobQueue(
        max_size=config_manager.get_setting('max_queue_size', 50)
    )

    # Initialize ComfyUI progress monitor (live sampling progress via websocket)
    progress_monitor = ComfyProgressMonitor()
    if WEBSOCKET_AVAILABLE:
        progress_monitor.start(config_manager.get_comfyui_config())

    # Initialize ComfyUI health watchdog (detects a wedged/unresponsive server)
    comfy_health_monitor = ComfyHealthMonitor()
    comfy_health_monitor.start(config_manager.get_comfyui_config())

    # Initialize workflow manager
    workflow_manager = WorkflowManager(
        config_manager=config_manager,
        registry_manager=registry_manager,
        dependency_manager=dependency_manager,
        hardware_manager=hardware_manager
    )

    if CHAT_AVAILABLE:
        runtime = _runtime_config()
        chat_data_dir = runtime.get('CHAT_DATA_DIR') or str(Path(__file__).resolve().parent / 'chat-data')
        chat_store = ChatStore(chat_data_dir)


# Create Flask app
app = Flask(
    __name__,
    static_folder='launcher/frontend',
    template_folder='launcher/frontend'
)


@app.route('/')
def index() -> str:
    """Render the main dashboard."""
    if not workflow_manager:
        return "Application not initialized. Run launcher with --init first."

    workflows = workflow_manager.get_workflows()
    categories = set(w['category'] for w in workflows)

    return render_template(
        'index.html',
        workflows=workflows,
        categories=sorted(categories),
        version=__version__,
        request_host=request.host.split(':')[0]
    )


@app.route('/vendor/<path:subpath>')
def vendor_file(subpath: str):
    """Serve Studio vendor assets such as Three.js modules."""
    vendor_dir = (Path(__file__).resolve().parent / 'studio_static' / 'vendor').resolve()
    target = (vendor_dir / subpath).resolve()
    if vendor_dir not in target.parents and target != vendor_dir:
        return jsonify({'error': 'Invalid vendor path'}), 400
    if not target.exists() or not target.is_file():
        return jsonify({'error': 'Vendor asset not found'}), 404
    return send_from_directory(target.parent, target.name)


@app.route('/api/workflows')
def api_workflows() -> jsonify:
    """Get all workflows with optional filtering."""
    category = request.args.get('category')
    search = request.args.get('search')

    workflows = workflow_manager.get_workflows(category=category, search=search)
    return jsonify({'workflows': workflows, 'total': len(workflows)})


@app.route('/api/workflows/<workflow_id>')
def api_workflow_details(workflow_id: str) -> jsonify:
    """Get workflow details by ID."""
    workflow_data = workflow_manager.get_workflow_by_id(workflow_id)

    if not workflow_data:
        return jsonify({'error': 'Workflow not found'}), 404

    manifest = workflow_data.get('manifest', {})
    inputs = workflow_manager.get_input_fields(workflow_id)

    return jsonify({
        'id': workflow_id,
        'name': manifest.get('name', workflow_id),
        'description': manifest.get('description', ''),
        'category': workflow_manager._workflow_category(manifest, workflow_id),
        'media_type': workflow_manager._infer_workflow_media_type(manifest, workflow_id),
        'runnable': workflow_manager._workflow_is_runnable(workflow_data),
        'missing_nodes': workflow_manager._missing_comfy_nodes(workflow_data),
        'version': manifest.get('version', '1.0.0'),
        'status': manifest.get('status', 'unknown'),
        'inputs': inputs,
        'presets': workflow_manager.get_presets(workflow_id),
        'models': manifest.get('models', {}),
        'custom_nodes': manifest.get('custom_nodes', {}),
        'hardware': workflow_manager._workflow_hardware(manifest),
        'speed': workflow_manager._workflow_speed_tier(manifest, workflow_id)
    })


@app.route('/api/workflows/<workflow_id>/dependencies')
def api_workflow_dependencies(workflow_id: str) -> jsonify:
    """Get workflow dependencies."""
    success, errors, warnings = workflow_manager.check_workflow_dependencies(workflow_id)

    return jsonify({
        'workflow_id': workflow_id,
        'dependencies_satisfied': success,
        'errors': errors,
        'warnings': warnings
    })


@app.route('/api/workflows/<workflow_id>/move', methods=['POST'])
def api_move_workflow(workflow_id: str) -> jsonify:
    """Move a pack to a different category (creating it if "name" is provided) and reload the Studio in place."""
    if not workflow_manager or not config_manager:
        return jsonify({'error': 'Application not initialized'}), 500

    workflow_data = workflow_manager.workflows.get(workflow_id)
    if not workflow_data:
        return jsonify({'error': 'Workflow not found'}), 404

    body = request.get_json(silent=True) or {}
    target_category = (body.get('category') or '').strip()
    if not target_category:
        return jsonify({'error': 'Missing "category" in request body'}), 400
    if not re.match(r'^[a-z0-9][a-z0-9-]*$', target_category):
        return jsonify({'error': 'Category id must be lowercase letters, numbers, and hyphens only'}), 400

    new_category_name = (body.get('name') or '').strip()
    new_category_description = (body.get('description') or '').strip()

    manifest = workflow_data.get('manifest', {})
    current_category = manifest.get('category', '')

    if target_category == current_category:
        return jsonify({'ok': True, 'workflow_id': workflow_id, 'category': current_category, 'message': 'Already in this category'})

    packs_dir = Path(config_manager.get_path('packs'))
    categories = pack_mover.find_category_manifests(packs_dir)
    created_category = False

    if target_category not in categories:
        if not new_category_name:
            return jsonify({
                'error': f'Category "{target_category}" doesn\'t exist yet. Pass "name" (and optionally '
                         f'"description") in the request body to create it.'
            }), 400
        try:
            new_manifest = pack_mover.create_category(
                packs_dir, target_category, new_category_name, new_category_description or new_category_name
            )
        except Exception as e:
            return jsonify({'error': f'Failed to create category: {e}'}), 500
        categories[target_category] = new_manifest
        created_category = True

    try:
        workflow_dir = Path(workflow_data['workflow_dir'])
        dst_dir = packs_dir / target_category / workflow_dir.name
        use_git = pack_mover.git_available(packs_dir)
        pack_mover.move_dir(workflow_dir, dst_dir, use_git)
        pack_mover.update_category_field(dst_dir / 'manifest.yaml', target_category)

        old_category_manifest = categories.get(current_category)
        if old_category_manifest and old_category_manifest.exists():
            pack_mover.remove_workflow_from_pack_manifest(old_category_manifest, workflow_id)
        pack_mover.add_workflow_to_pack_manifest(categories[target_category], workflow_id)
    except Exception as e:
        return jsonify({'error': f'Move failed: {e}'}), 500

    workflow_manager.reload()

    try:
        registry_output = Path(config_manager.get_path('registry')) / 'registry.json'
        generate_registry(packs_dir, None, registry_output)
    except Exception as e:
        print(f"Warning: registry.json rebuild after move failed: {e}")

    return jsonify({
        'ok': True, 'workflow_id': workflow_id, 'from': current_category, 'to': target_category,
        'created_category': created_category
    })


@app.route('/api/workflows/<workflow_id>', methods=['DELETE'])
def api_delete_workflow(workflow_id: str) -> jsonify:
    """Delete a pack entirely."""
    if not workflow_manager or not config_manager:
        return jsonify({'error': 'Application not initialized'}), 500

    workflow_data = workflow_manager.workflows.get(workflow_id)
    if not workflow_data:
        return jsonify({'error': 'Workflow not found'}), 404

    manifest = workflow_data.get('manifest', {})
    category = manifest.get('category', '')
    packs_dir = Path(config_manager.get_path('packs'))

    try:
        workflow_dir = Path(workflow_data['workflow_dir'])
        categories = pack_mover.find_category_manifests(packs_dir)
        category_manifest = categories.get(category)
        if category_manifest and category_manifest.exists():
            pack_mover.remove_workflow_from_pack_manifest(category_manifest, workflow_id)
        use_git = pack_mover.git_available(packs_dir)
        pack_mover.remove_dir(workflow_dir, use_git)
    except Exception as e:
        return jsonify({'error': f'Delete failed: {e}'}), 500

    workflow_manager.reload()

    try:
        registry_output = Path(config_manager.get_path('registry')) / 'registry.json'
        generate_registry(packs_dir, None, registry_output)
    except Exception as e:
        print(f"Warning: registry.json rebuild after delete failed: {e}")

    return jsonify({'ok': True, 'workflow_id': workflow_id, 'category': category})


@app.route('/api/categories/<category_id>', methods=['DELETE'])
def api_delete_category(category_id: str) -> jsonify:
    """Delete a category, but only if it has no packs left in it."""
    if not workflow_manager or not config_manager:
        return jsonify({'error': 'Application not initialized'}), 500

    packs_dir = Path(config_manager.get_path('packs'))
    categories = pack_mover.find_category_manifests(packs_dir)

    if category_id not in categories:
        return jsonify({'error': f'Category not found: {category_id}'}), 404

    category_dir = categories[category_id].parent
    remaining = [d.name for d in category_dir.iterdir() if d.is_dir()]
    if remaining:
        return jsonify({
            'error': f'Category "{category_id}" still has packs: {", ".join(remaining)}. '
                     f'Move or delete them first.'
        }), 400

    try:
        manifest_path = categories[category_id]
        use_git = pack_mover.git_available(packs_dir)
        if use_git:
            result = subprocess.run(
                ['git', 'rm', '-f', '-q', str(manifest_path)],
                cwd=str(packs_dir.parent), capture_output=True, text=True, timeout=30
            )
            if result.returncode != 0:
                manifest_path.unlink()
        else:
            manifest_path.unlink()
        try:
            category_dir.rmdir()
        except OSError:
            pass
    except Exception as e:
        return jsonify({'error': f'Delete failed: {e}'}), 500

    workflow_manager.reload()

    try:
        registry_output = Path(config_manager.get_path('registry')) / 'registry.json'
        generate_registry(packs_dir, None, registry_output)
    except Exception as e:
        print(f"Warning: registry.json rebuild after category delete failed: {e}")

    return jsonify({'ok': True, 'category': category_id})


_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE)


@app.route('/api/workflow-builder/analyze', methods=['POST'])
def api_analyze_workflow_builder() -> jsonify:
    """Take a raw uploaded ComfyUI workflow.json and return the block-builder palette:
    candidate input controls, auto-detected model dependencies, and any node types this
    ComfyUI install doesn't recognize."""
    if not workflow_manager:
        return jsonify({'error': 'Application not initialized'}), 500

    body = request.get_json(silent=True) or {}
    workflow = body.get('workflow')
    if not isinstance(workflow, dict) or 'nodes' not in workflow:
        return jsonify({'error': 'Missing or invalid "workflow" (expected a ComfyUI UI-format export with a "nodes" array)'}), 400

    try:
        import comfy_studio
    except Exception as e:
        return jsonify({'error': f'Could not load workflow analysis module: {e}'}), 500

    try:
        controls = comfy_studio.workflow_controls(None, workflow)
        models = comfy_studio.model_requirements(workflow)
    except Exception as e:
        return jsonify({'error': f'Failed to analyze workflow: {e}'}), 400

    node_types = {n.get('type') for n in workflow.get('nodes', []) if n.get('type')}
    for subgraph in (workflow.get('definitions') or {}).get('subgraphs', []) or []:
        node_types.update(n.get('type') for n in subgraph.get('nodes', []) if n.get('type'))
    # subgraph instance nodes are addressed by a UUID, not a real class_type - exclude those
    node_types = {t for t in node_types if not _UUID_RE.match(t)}

    object_info = workflow_manager._get_comfy_object_info() or {}
    missing_nodes = sorted(t for t in node_types if t not in object_info)

    return jsonify({'controls': controls, 'models': models, 'missing_nodes': missing_nodes})


@app.route('/api/workflows', methods=['POST'])
def api_create_workflow() -> jsonify:
    """Create a new pack from block-builder output: a raw workflow.json plus the
    inputs/models the user picked from the analyze palette."""
    if not workflow_manager or not config_manager:
        return jsonify({'error': 'Application not initialized'}), 500

    body = request.get_json(silent=True) or {}
    category = (body.get('category') or '').strip()
    pack_id_slug = (body.get('pack_id') or '').strip()
    name = (body.get('name') or '').strip()
    description = (body.get('description') or '').strip()
    status = (body.get('status') or 'experimental').strip()
    media_type = (body.get('media_type') or 'image').strip()
    workflow = body.get('workflow')
    inputs = body.get('inputs') or []
    models = body.get('models') or []

    if not category or not pack_id_slug or not name or not isinstance(workflow, dict):
        return jsonify({'error': '"category", "pack_id", "name", and "workflow" are required'}), 400
    if not re.match(r'^[a-z0-9][a-z0-9-]*$', category):
        return jsonify({'error': 'category id must be lowercase letters, numbers, and hyphens only'}), 400
    if not re.match(r'^[a-z0-9][a-z0-9_-]*$', pack_id_slug):
        return jsonify({'error': 'pack_id must be lowercase letters, numbers, hyphens, and underscores only'}), 400
    if status not in ('experimental', 'stable', 'deprecated'):
        return jsonify({'error': 'status must be experimental, stable, or deprecated'}), 400

    packs_dir = Path(config_manager.get_path('packs'))
    categories = pack_mover.find_category_manifests(packs_dir)
    created_category = False

    if category not in categories:
        new_category_name = (body.get('category_name') or '').strip()
        if not new_category_name:
            return jsonify({
                'error': f'Category "{category}" doesn\'t exist yet. Pass "category_name" in the request body to create it.'
            }), 400
        try:
            new_manifest = pack_mover.create_category(
                packs_dir, category, new_category_name,
                (body.get('category_description') or '').strip() or new_category_name
            )
        except Exception as e:
            return jsonify({'error': f'Failed to create category: {e}'}), 500
        categories[category] = new_manifest
        created_category = True

    workflow_id = f"{category}.{pack_id_slug}"
    if workflow_id in workflow_manager.workflows:
        return jsonify({'error': f'Workflow id already exists: {workflow_id}'}), 400

    pack_dir = packs_dir / category / pack_id_slug
    if pack_dir.exists():
        return jsonify({'error': f'A pack already exists at packs/{category}/{pack_id_slug}'}), 400

    manifest = {
        'id': workflow_id,
        'name': name,
        'version': '1.0.0',
        'category': category,
        'description': description,
        'status': status,
        'media_type': media_type,
        'entrypoints': {'ui': 'workflow.json'},
        'inputs': inputs,
        'outputs': body.get('outputs') or [],
        'models': {'required': models, 'optional': []},
        'custom_nodes': {'required': ['comfyui'], 'optional': []},
    }

    try:
        pack_dir.mkdir(parents=True)
        (pack_dir / 'workflow.json').write_text(json.dumps(workflow, indent=2), encoding='utf-8')
        (pack_dir / 'manifest.yaml').write_text(
            yaml.dump(manifest, sort_keys=False, allow_unicode=True), encoding='utf-8'
        )
        pack_mover.add_workflow_to_pack_manifest(categories[category], workflow_id)
    except Exception as e:
        return jsonify({'error': f'Failed to create pack: {e}'}), 500

    workflow_manager.reload()

    try:
        registry_output = Path(config_manager.get_path('registry')) / 'registry.json'
        generate_registry(packs_dir, None, registry_output)
    except Exception as e:
        print(f"Warning: registry.json rebuild after create failed: {e}")

    return jsonify({'ok': True, 'workflow_id': workflow_id, 'category': category, 'created_category': created_category})


@app.route('/api/workflows/<workflow_id>/presets', methods=['POST'])
def api_save_workflow_preset(workflow_id: str) -> jsonify:
    """Save the current Studio workbench form values as a new named preset."""
    if not workflow_manager:
        return jsonify({'error': 'Workflow manager not initialized'}), 500

    data = request.get_json(silent=True) or {}
    try:
        preset = workflow_manager.save_preset(workflow_id, data.get('name', ''), data.get('values') or {})
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    return jsonify({'preset': preset, 'presets': workflow_manager.get_presets(workflow_id)})


@app.route('/api/workflows/<workflow_id>/run', methods=['POST'])
def api_run_workflow(workflow_id: str) -> jsonify:
    """Run a workflow.

    Pass `hold_for_slot: true` in the JSON body to let this job sit in the
    launcher's local queue instead of being submitted to ComfyUI right away,
    if an earlier job is still running there below the release threshold
    (see _release_queued_jobs). Internal multi-stage pipelines that need a
    prompt_id back immediately should omit this flag to keep today's
    submit-right-away behavior.
    """
    if not workflow_manager:
        return jsonify({'error': 'Workflow manager not initialized'}), 500

    data = request.get_json() or {}
    inputs = data.get('inputs', {})
    hold_for_slot = bool(data.get('hold_for_slot'))

    try:
        job_id = job_queue.add_job(workflow_id=workflow_id, inputs=inputs)
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    _reconcile_running_jobs()
    if hold_for_slot:
        _release_queued_jobs()
    else:
        _dispatch_job(job_id, workflow_id, inputs)

    job = job_queue.get_job(job_id) or {}
    status = job.get('status', 'queued')
    response = {
        'job_id': job_id,
        'status': status,
        'workflow_id': workflow_id,
        'result': job.get('result')
    }
    if status == 'failed':
        response['error'] = job.get('error')
    return jsonify(response), 400 if status == 'failed' else 200


def _dispatch_job(job_id: str, workflow_id: str, inputs: Dict[str, Any]) -> None:
    """Hand a job to ComfyUI (or run it synchronously for non-ComfyUI
    workflows) and record the outcome on the job queue."""
    job_queue.start_job(job_id)
    success, result = workflow_manager.run_workflow(workflow_id=workflow_id, inputs=inputs)

    if success and result.get('prompt_id'):
        # ComfyUI has only ACCEPTED the prompt into its queue here, not
        # finished rendering it. Leave the job "running" (set by start_job
        # above) with the prompt_id attached; _reconcile_running_jobs()
        # flips it to "completed" once ComfyUI actually finishes, the next
        # time /api/jobs or /api/jobs/<id> is polled.
        job_queue.update_job(job_id, progress=10, result=result)
    elif success:
        # Non-ComfyUI workflows (e.g. LLM orchestration) return their real
        # result synchronously, so "completed" is accurate immediately.
        job_queue.update_job(job_id, status='completed', progress=100, result=result)
    else:
        job_queue.update_job(
            job_id, status='failed', progress=0, result=None,
            error=result.get('error', 'Workflow failed')
        )


def _release_queued_jobs() -> None:
    """Dispatch the next locally queued job to ComfyUI once no in-flight job
    is still below the configured release threshold.

    Without this, queuing several jobs would hand them all to ComfyUI's own
    queue at once. Instead each waits its turn in the launcher until the
    running job's sampling progress is nearly done, so a not-yet-submitted
    job can still be reordered or cancelled from the Studio queue view right
    up until the moment it's released.
    """
    if not job_queue or not workflow_manager:
        return
    threshold = config_manager.get_setting('queue_release_progress', 90) if config_manager else 90

    while True:
        blocking = any(
            (job.get('result') or {}).get('prompt_id') and (job.get('progress') or 0) < threshold
            for job in job_queue.get_running()
        )
        if blocking:
            return
        queued = job_queue.get_queue()
        if not queued:
            return
        next_job = queued[0]
        _dispatch_job(next_job['job_id'], next_job['workflow_id'], next_job['inputs'])


def _reconcile_running_jobs() -> None:
    """Check ComfyUI directly for jobs we only know were queued, and flip them
    to completed/failed once they've actually finished.

    api_run_workflow() returns as soon as ComfyUI *accepts* a prompt into its
    queue, not when it's actually done - without this, a job would sit
    labeled "running" (or, before this fix existed, incorrectly "completed")
    indefinitely regardless of real progress.
    """
    if not job_queue:
        return
    from ai_manager import load_config
    from comfy_studio import progress as comfy_progress

    # If ComfyUI itself has been unreachable for a while, don't bother
    # polling per-job (each call would just eat its own timeout) - mark
    # every in-flight job stalled at once so it shows up as retryable
    # instead of sitting labeled "running" forever with no explanation.
    # This is what would have surfaced this morning's wedged-ComfyUI
    # incident in the UI instead of the job silently looking stuck.
    if comfy_health_monitor and comfy_health_monitor.down_seconds() >= COMFY_STALE_AFTER_SECONDS:
        health = comfy_health_monitor.snapshot()
        for job in job_queue.get_running():
            if (job.get('result') or {}).get('prompt_id'):
                job_queue.update_job(
                    job['job_id'], status='stalled', progress=job.get('progress') or 0,
                    error=f"ComfyUI stopped responding (unreachable since {health.get('down_since')}). "
                          "The render may have finished on disk even though tracking lost it - check "
                          "the outputs list, or use Retry to resubmit.",
                )
        return

    config = load_config()
    progress_by_state = {'waiting': 10, 'queued': 15, 'running': 60, 'history': 80}
    for job in job_queue.get_running():
        result = job.get('result') or {}
        prompt_id = result.get('prompt_id')
        if not prompt_id:
            continue
        try:
            payload = comfy_progress(config, prompt_id)
        except Exception:
            continue
        state = payload.get('state')
        if state == 'cancelled':
            job_queue.update_job(job['job_id'], status='cancelled', progress=0)
            if progress_monitor:
                progress_monitor.clear(prompt_id)
            continue
        if state == 'error':
            job_queue.update_job(
                job['job_id'], status='failed', progress=job.get('progress') or 0,
                error=payload.get('error') or f"ComfyUI reported an error ({payload.get('status', 'error')}).",
            )
            if progress_monitor:
                progress_monitor.clear(prompt_id)
            continue
        if not payload.get('completed'):
            # Prefer the live per-step sampling percent from ComfyUI's
            # websocket feed over the coarse REST state, when we have one -
            # that's what actually lets the 90% release gate mean something.
            live_percent = progress_monitor.percent_for(prompt_id) if progress_monitor else None
            fallback = progress_by_state.get(state, job.get('progress') or 10)
            progress_value = max(fallback, live_percent) if live_percent is not None else fallback
            job_queue.update_job(job['job_id'], progress=progress_value)
            continue
        outputs = [_rewrite_media_url(dict(o)) for o in (payload.get('outputs') or [])]
        new_result = dict(result)
        new_result['outputs'] = outputs
        if not outputs:
            new_result['message'] = f"Finished ({payload.get('status', 'done')}), but no matching output file was found."
        job_queue.update_job(job['job_id'], status='completed', progress=100, result=new_result)
        if progress_monitor:
            progress_monitor.clear(prompt_id)


@app.route('/api/jobs')
def api_jobs() -> jsonify:
    """Get job queue status."""
    try:
        limit = max(1, min(int(request.args.get('limit', 50)), 200))
    except ValueError:
        limit = 50
    _reconcile_running_jobs()
    _release_queued_jobs()
    completed = job_queue.get_completed(limit=limit)
    for job in completed:
        _enrich_job_outputs(job)
    return jsonify({
        'queued': job_queue.get_queue(),
        'running': job_queue.get_running(),
        'completed': completed,
        'comfy_health': comfy_health_monitor.snapshot() if comfy_health_monitor else None
    })


@app.route('/api/jobs/<job_id>')
def api_job_status(job_id: str) -> jsonify:
    """Get job status by ID."""
    _reconcile_running_jobs()
    _release_queued_jobs()
    job = job_queue.get_job(job_id)

    if not job:
        return jsonify({'error': 'Job not found'}), 404

    _enrich_job_outputs(job)
    return jsonify(job)


@app.route('/api/jobs/<job_id>/move', methods=['POST'])
def api_move_queued_job(job_id: str) -> jsonify:
    """Move a queued job within the launcher queue."""
    if not job_queue:
        return jsonify({'error': 'Job queue not initialized'}), 500

    data = request.get_json(silent=True) or {}
    action = data.get('action', 'up')
    try:
        position = job_queue.reorder_queued_job(job_id, action)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    if position is None:
        job = job_queue.get_job(job_id)
        if job:
            return jsonify({'error': f"Only queued jobs can be moved. This job is {job.get('status', 'not queued')}."}), 409
        return jsonify({'error': 'Job not found'}), 404

    return jsonify({
        'job_id': job_id,
        'position': position,
        'queued': job_queue.get_queue()
    })


@app.route('/api/jobs/<job_id>/cancel', methods=['POST'])
def api_cancel_job(job_id: str) -> jsonify:
    """Cancel a queued or running job."""
    if not job_queue:
        return jsonify({'error': 'Job queue not initialized'}), 500

    job = job_queue.get_job(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    status = job.get('status')

    if status == 'queued':
        job_queue.cancel_queued_job(job_id)
        return jsonify({'job_id': job_id, 'cancelled': True, 'queued': job_queue.get_queue()})

    if status == 'running':
        prompt_id = (job.get('result') or {}).get('prompt_id')
        if prompt_id:
            from ai_manager import load_config
            from comfy_studio import cancel_prompt
            try:
                cancel_prompt(load_config(), prompt_id)
            except Exception as exc:
                return jsonify({'error': f'Could not cancel ComfyUI job: {exc}'}), 502
            if progress_monitor:
                progress_monitor.clear(prompt_id)
        job_queue.update_job(job_id, status='cancelled', progress=0)
        return jsonify({'job_id': job_id, 'cancelled': True})

    return jsonify({'error': f"Only queued or running jobs can be cancelled. This job is {status}."}), 409


@app.route('/api/jobs/<job_id>/retry', methods=['POST'])
def api_retry_job(job_id: str) -> jsonify:
    """Resubmit a failed/stalled/cancelled job's original workflow_id + inputs
    as a brand new job.

    Jobs already carry everything needed to rebuild the exact ComfyUI prompt
    graph (workflow_manager.run_workflow rebuilds it from these two fields),
    so retrying doesn't need its own separate storage - it just re-runs
    add_job/_dispatch_job with the same inputs under a new job_id.
    """
    if not job_queue or not workflow_manager:
        return jsonify({'error': 'Job queue not initialized'}), 500

    job = job_queue.get_job(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    if job.get('status') not in ('failed', 'stalled', 'cancelled'):
        return jsonify({'error': f"Only failed, stalled, or cancelled jobs can be retried. This job is {job.get('status')}."}), 409

    try:
        new_job_id = job_queue.add_job(workflow_id=job['workflow_id'], inputs=job.get('inputs') or {})
    except ValueError as e:
        return jsonify({'error': str(e)}), 400

    _dispatch_job(new_job_id, job['workflow_id'], job.get('inputs') or {})
    new_job = job_queue.get_job(new_job_id) or {}
    return jsonify({
        'job_id': new_job_id,
        'retried_from': job_id,
        'status': new_job.get('status', 'queued'),
        'workflow_id': job['workflow_id'],
    })


@app.route('/api/outputs/<path:subpath>', methods=['GET', 'DELETE'])
def api_output_file(subpath: str):
    """Serve or delete a ComfyUI output file through Studio."""
    if not config_manager:
        return jsonify({'error': 'Application not initialized'}), 500

    comfyui_dir = os.environ.get('COMFYUI_DIR') or '/home/hilbert/ai-suite/repos/ComfyUI'
    output_dir = (Path(comfyui_dir) / 'output').resolve()
    target = (output_dir / subpath).resolve()
    if output_dir not in target.parents and target != output_dir:
        return jsonify({'error': 'Invalid output path'}), 400
    if request.method == 'DELETE':
        # Idempotent: a gallery entry whose underlying file is already gone
        # (moved, cleaned up outside Studio, or never landed where expected)
        # should still be removable - the goal state is "file not present",
        # which is already true, not a 404 the UI can never get past.
        if target.exists() and target.is_file():
            target.unlink()
        return jsonify({'deleted': subpath})
    if not target.exists() or not target.is_file():
        return jsonify({'error': 'Output not found'}), 404
    return send_from_directory(target.parent, target.name)


@app.route('/api/input/<path:subpath>', methods=['GET', 'DELETE'])
def api_input_file(subpath: str):
    """Serve or delete a ComfyUI input file through Studio."""
    if not config_manager:
        return jsonify({'error': 'Application not initialized'}), 500

    comfyui_dir = os.environ.get('COMFYUI_DIR') or '/home/hilbert/ai-suite/repos/ComfyUI'
    input_dir = (Path(comfyui_dir) / 'input').resolve()
    target = (input_dir / subpath).resolve()
    if input_dir not in target.parents and target != input_dir:
        return jsonify({'error': 'Invalid input path'}), 400
    if request.method == 'DELETE':
        # Idempotent for the same reason as /api/outputs's DELETE branch above.
        if target.exists() and target.is_file():
            target.unlink()
        return jsonify({'deleted': subpath})
    if not target.exists() or not target.is_file():
        return jsonify({'error': 'Input not found'}), 404
    return send_from_directory(target.parent, target.name)


@app.route('/api/outputs')
def api_outputs_index() -> jsonify:
    """List recent ComfyUI output files for the Studio preview rail."""
    if not config_manager:
        return jsonify({'error': 'Application not initialized'}), 500

    try:
        limit = max(1, min(int(request.args.get('limit', 24)), 500))
    except ValueError:
        limit = 24

    comfyui_dir = os.environ.get('COMFYUI_DIR') or '/home/hilbert/ai-suite/repos/ComfyUI'
    output_dir = (Path(comfyui_dir) / 'output').resolve()
    if not output_dir.exists():
        return jsonify({'outputs': []})

    media_exts = {
        '.png': 'image',
        '.jpg': 'image',
        '.jpeg': 'image',
        '.webp': 'image',
        '.gif': 'image',
        '.mp4': 'video',
        '.webm': 'video',
        '.mov': 'video',
        '.glb': 'model',
        '.gltf': 'model',
        '.obj': 'model',
        '.fbx': 'model',
        '.ply': 'model',
        '.stl': 'model',
        '.3mf': 'model',
        '.dae': 'model',
        '.wav': 'audio',
        '.mp3': 'audio',
        '.flac': 'audio',
        '.ogg': 'audio',
        '.m4a': 'audio',
        '.aac': 'audio',
        '.aiff': 'audio',
        '.aif': 'audio',
    }
    files = []
    for path in output_dir.rglob('*'):
        if not path.is_file():
            continue
        media_type = media_exts.get(path.suffix.lower())
        if not media_type:
            continue
        relative = path.relative_to(output_dir).as_posix()
        files.append({
            'filename': path.name,
            'subfolder': path.parent.relative_to(output_dir).as_posix() if path.parent != output_dir else '',
            'type': 'output',
            'media_type': media_type,
            # Quote each path segment - an unescaped literal "%" in a filename
            # (e.g. from the pre-fix %date: token bug) is otherwise indistinguishable
            # from real percent-encoding once this round-trips through a browser
            # fetch() and Werkzeug's automatic path decoding: "%da" from "%date"
            # decodes as a valid-looking encoded byte, silently corrupting the
            # path so GET/DELETE requests can never find the real file again.
            'url': f"/api/outputs/{urllib.parse.quote(relative, safe='/')}",
            'modified_at': datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
        })

    files.sort(key=lambda item: item['modified_at'], reverse=True)
    return jsonify({'outputs': files[:limit]})


@app.route('/api/inputs')
def api_inputs_index() -> jsonify:
    """List reusable ComfyUI input files stored for Studio workflows."""
    if not config_manager:
        return jsonify({'error': 'Application not initialized'}), 500

    try:
        limit = max(1, min(int(request.args.get('limit', 200)), 500))
    except ValueError:
        limit = 200

    comfyui_dir = os.environ.get('COMFYUI_DIR') or '/home/hilbert/ai-suite/repos/ComfyUI'
    input_dir = (Path(comfyui_dir) / 'input').resolve()
    if not input_dir.exists():
        return jsonify({'inputs': []})

    media_exts = {
        '.png': 'image',
        '.jpg': 'image',
        '.jpeg': 'image',
        '.webp': 'image',
        '.gif': 'image',
        '.bmp': 'image',
        '.mp4': 'video',
        '.webm': 'video',
        '.mov': 'video',
        '.mkv': 'video',
        '.wav': 'audio',
        '.mp3': 'audio',
        '.flac': 'audio',
        '.ogg': 'audio',
        '.m4a': 'audio',
        '.aac': 'audio',
        '.aiff': 'audio',
        '.aif': 'audio',
        '.glb': 'model',
        '.gltf': 'model',
        '.obj': 'model',
        '.fbx': 'model',
        '.ply': 'model',
        '.stl': 'model',
        '.3mf': 'model',
    }
    files = []
    for path in input_dir.rglob('*'):
        if not path.is_file():
            continue
        media_type = media_exts.get(path.suffix.lower())
        if not media_type:
            continue
        relative = path.relative_to(input_dir).as_posix()
        files.append({
            'name': relative,
            'filename': path.name,
            'subfolder': path.parent.relative_to(input_dir).as_posix() if path.parent != input_dir else '',
            'type': 'input',
            'media_type': media_type,
            # See the matching comment in api_outputs_index - unescaped '%' in
            # a filename breaks the GET/DELETE round-trip through Werkzeug.
            'url': f"/api/input/{urllib.parse.quote(relative, safe='/')}",
            'modified_at': datetime.fromtimestamp(path.stat().st_mtime).isoformat(),
        })

    files.sort(key=lambda item: item['modified_at'], reverse=True)
    return jsonify({'inputs': files[:limit]})


@app.route('/api/uploads', methods=['POST'])
def api_upload_file() -> jsonify:
    """Upload a source media file into ComfyUI's input directory."""
    if not config_manager:
        return jsonify({'error': 'Application not initialized'}), 500
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    uploaded = request.files['file']
    if not uploaded.filename:
        return jsonify({'error': 'Uploaded file has no filename'}), 400

    comfyui_dir = os.environ.get('COMFYUI_DIR') or '/home/hilbert/ai-suite/repos/ComfyUI'
    input_dir = (Path(comfyui_dir) / 'input' / 'studio_uploads').resolve()
    input_dir.mkdir(parents=True, exist_ok=True)

    safe_name = secure_filename(uploaded.filename) or f"upload-{int(time.time())}"
    target = input_dir / safe_name
    suffix = target.suffix
    stem = target.stem
    counter = 1
    while target.exists():
        target = input_dir / f"{stem}-{counter}{suffix}"
        counter += 1

    uploaded.save(target)
    relative = f"studio_uploads/{target.name}"
    return jsonify({
        'name': relative,
        'filename': target.name,
        'url': f"/api/input/{relative}",
    })


@app.route('/api/comfy-progress/<prompt_id>')
def api_comfy_progress(prompt_id: str) -> jsonify:
    """Poll a ComfyUI prompt directly, with correct audio/image/video output typing.

    /api/jobs/<id> only enriches outputs from the "images"/"videos" history keys
    (see _enrich_job_outputs), so it never surfaces audio outputs and can
    mislabel SaveVideo output as an image. This reuses comfy_studio.progress(),
    which handles both correctly, for callers (like the music-video pipeline)
    that need to know precisely when a specific prompt has finished.
    """
    from ai_manager import load_config
    from comfy_studio import progress as comfy_progress

    payload = comfy_progress(load_config(), prompt_id)
    for output in payload.get('outputs') or []:
        _rewrite_media_url(output)
    return jsonify(payload)


@app.route('/api/comfy/models')
def api_comfy_models() -> jsonify:
    """List available checkpoint/LoRA/VAE/CLIP model filenames from ComfyUI, for populating model-picker dropdowns."""
    from ai_manager import load_config
    from comfy_studio import available_model_options, comfy_available

    config = load_config()
    if not comfy_available(config):
        return jsonify({'error': 'ComfyUI is not running'}), 503
    return jsonify(available_model_options(config))


@app.route('/api/comfy-free', methods=['POST'])
def api_comfy_free() -> jsonify:
    """Ask ComfyUI to unload models and free memory between heavy staged jobs."""
    from ai_manager import load_config
    from comfy_studio import comfy_free

    try:
        comfy_free(load_config())
        return jsonify({'freed': True})
    except Exception as exc:
        return jsonify({'freed': False, 'error': str(exc)}), 502


def _rewrite_media_url(output: Dict[str, Any]) -> Dict[str, Any]:
    """comfy_studio's queue/progress/mux/stitch functions build "/media/..."
    URLs for its own now-archived StudioHandler route. launcher.py serves
    output files under /api/outputs/ instead, so rewrite in place."""
    subfolder = output.get('subfolder') or ''
    relative = f"{subfolder}/{output['filename']}" if subfolder else output['filename']
    output['url'] = f"/api/outputs/{relative}"
    return output


@app.route('/media/<path:subpath>')
def api_chat_media_file(subpath: str):
    """Serve ComfyUI output links emitted by the integrated chat helper."""
    comfyui_dir = os.environ.get('COMFYUI_DIR') or _runtime_config().get('COMFYUI_DIR') or '/home/hilbert/ai-suite/repos/ComfyUI'
    output_dir = (Path(comfyui_dir) / 'output').resolve()
    target = (output_dir / subpath).resolve()
    if output_dir not in target.parents and target != output_dir:
        return jsonify({'error': 'Invalid media path'}), 400
    if not target.exists() or not target.is_file():
        return jsonify({'error': 'Media not found'}), 404
    return send_from_directory(target.parent, target.name)


@app.route('/api/mux-music-video', methods=['POST'])
def api_mux_music_video() -> jsonify:
    """Combine a generated clip and song into one music video file."""
    from comfy_studio import mux_music_video

    body = request.get_json() or {}
    try:
        output = mux_music_video(body.get('video'), body.get('audio'), title=body.get('title'))
        return jsonify({'output': _rewrite_media_url(output)})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.route('/api/burn-in-lyrics', methods=['POST'])
def api_burn_in_lyrics() -> jsonify:
    """Burn synced lyric captions into a generated video.

    `sections` must carry the ACTUAL rendered timing (start/end seconds) for
    each song section, not the pre-generation beat-grid plan - see
    comfy_studio.burn_in_lyrics for why that distinction matters.
    """
    from comfy_studio import burn_in_lyrics

    body = request.get_json() or {}
    try:
        output = burn_in_lyrics(body.get('video'), body.get('sections') or [], title=body.get('title'))
        return jsonify({'output': _rewrite_media_url(output)})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.route('/api/stitch-videos', methods=['POST'])
def api_stitch_videos() -> jsonify:
    """Concatenate several generated video segments into one clip."""
    from comfy_studio import stitch_videos

    body = request.get_json() or {}
    try:
        output = stitch_videos(body.get('outputs', []), body.get('workflow_id', 'sequence'))
        return jsonify({'output': _rewrite_media_url(output)})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


STORYBOARDS_DIR = Path(__file__).resolve().parent / 'storyboards'
STORYBOARDS_DIR.mkdir(parents=True, exist_ok=True)


def _storyboard_path(storyboard_id: str) -> Optional[Path]:
    safe_id = re.sub(r'[^a-zA-Z0-9_-]', '', storyboard_id or '')
    if not safe_id:
        return None
    return STORYBOARDS_DIR / f'{safe_id}.json'


@app.route('/api/storyboards')
def api_list_storyboards() -> jsonify:
    """List saved storyboards (persisted shot sequences you can generate video from later)."""
    items = []
    for path in STORYBOARDS_DIR.glob('*.json'):
        try:
            data = json.loads(path.read_text())
        except Exception:
            continue
        shots = data.get('shots') or []
        thumbnail_url = next((s['image']['url'] for s in shots if s.get('image')), None)
        items.append({
            'id': data.get('id'),
            'title': data.get('title') or 'Untitled',
            'shot_count': len(shots),
            'shots_with_images': sum(1 for s in shots if s.get('image')),
            'has_video': bool(data.get('video')),
            'created_at': data.get('created_at'),
            'updated_at': data.get('updated_at'),
            'thumbnail_url': thumbnail_url,
        })
    items.sort(key=lambda item: item.get('updated_at') or '', reverse=True)
    return jsonify({'storyboards': items})


@app.route('/api/storyboards', methods=['POST'])
def api_create_storyboard() -> jsonify:
    """Create a new, empty (or seeded) storyboard."""
    body = request.get_json() or {}
    storyboard_id = uuid.uuid4().hex[:12]
    now = datetime.utcnow().isoformat()
    descriptions = [d for d in (body.get('shot_descriptions') or []) if str(d).strip()]
    data = {
        'id': storyboard_id,
        'title': (body.get('title') or 'Untitled Storyboard').strip(),
        'created_at': now,
        'updated_at': now,
        'shots': [{'description': d, 'steering': '', 'image': None} for d in descriptions] or [{'description': '', 'steering': '', 'image': None}],
        'video': None,
    }
    _storyboard_path(storyboard_id).write_text(json.dumps(data, indent=2))
    return jsonify(data)


@app.route('/api/storyboards/<storyboard_id>')
def api_get_storyboard(storyboard_id: str) -> jsonify:
    path = _storyboard_path(storyboard_id)
    if not path or not path.exists():
        return jsonify({'error': 'Storyboard not found'}), 404
    return jsonify(json.loads(path.read_text()))


@app.route('/api/storyboards/<storyboard_id>', methods=['PUT'])
def api_update_storyboard(storyboard_id: str) -> jsonify:
    """Save the full storyboard (title, shots incl. descriptions/images, video).

    The client owns the in-memory storyboard object and PUTs the whole thing
    back after each change (a shot's image finishes generating, a description
    is edited, the video is produced) - simple and fine at this data scale.
    """
    path = _storyboard_path(storyboard_id)
    if not path or not path.exists():
        return jsonify({'error': 'Storyboard not found'}), 404
    body = request.get_json() or {}
    data = json.loads(path.read_text())
    if 'title' in body:
        data['title'] = (body.get('title') or data.get('title') or 'Untitled Storyboard').strip()
    if 'shots' in body:
        data['shots'] = body['shots']
    if 'video' in body:
        data['video'] = body['video']
    data['updated_at'] = datetime.utcnow().isoformat()
    path.write_text(json.dumps(data, indent=2))
    return jsonify(data)


@app.route('/api/storyboards/<storyboard_id>', methods=['DELETE'])
def api_delete_storyboard(storyboard_id: str) -> jsonify:
    path = _storyboard_path(storyboard_id)
    if path and path.exists():
        path.unlink()
    return jsonify({'deleted': storyboard_id})


CINEMATICS_DIR = Path(__file__).resolve().parent / 'cinematics'
CINEMATICS_DIR.mkdir(parents=True, exist_ok=True)


def _cinematic_path(cinematic_id: str) -> Optional[Path]:
    safe_id = re.sub(r'[^a-zA-Z0-9_-]', '', cinematic_id or '')
    if not safe_id:
        return None
    return CINEMATICS_DIR / f'{safe_id}.json'


def _empty_cinematic_shot() -> Dict[str, Any]:
    return {
        'id': uuid.uuid4().hex[:8],
        'description': '',
        'framing': 'wide',
        'camera_movement': 'static',
        'lens_mm': None,
        'duration_s': None,
        'steering': '',
        'image': None,
    }


def _empty_cinematic_scene() -> Dict[str, Any]:
    return {
        'id': uuid.uuid4().hex[:8],
        'heading': '',
        'action': '',
        'shots': [_empty_cinematic_shot()],
        'video': None,
    }


@app.route('/api/cinematics')
def api_list_cinematics() -> jsonify:
    """List saved cinematic sequences (scene-based storyboards with camera direction)."""
    items = []
    for path in CINEMATICS_DIR.glob('*.json'):
        try:
            data = json.loads(path.read_text())
        except Exception:
            continue
        scenes = data.get('scenes') or []
        shots = [s for sc in scenes for s in (sc.get('shots') or [])]
        thumbnail_url = next((s['image']['url'] for s in shots if s.get('image')), None)
        items.append({
            'id': data.get('id'),
            'title': data.get('title') or 'Untitled',
            'scene_count': len(scenes),
            'shot_count': len(shots),
            'shots_with_images': sum(1 for s in shots if s.get('image')),
            'has_video': bool(data.get('video')),
            'created_at': data.get('created_at'),
            'updated_at': data.get('updated_at'),
            'thumbnail_url': thumbnail_url,
        })
    items.sort(key=lambda item: item.get('updated_at') or '', reverse=True)
    return jsonify({'cinematics': items})


@app.route('/api/cinematics', methods=['POST'])
def api_create_cinematic() -> jsonify:
    """Create a new cinematic sequence, seeded with one empty scene containing one empty shot."""
    body = request.get_json() or {}
    cinematic_id = uuid.uuid4().hex[:12]
    now = datetime.utcnow().isoformat()
    data = {
        'id': cinematic_id,
        'title': (body.get('title') or 'Untitled Sequence').strip(),
        'created_at': now,
        'updated_at': now,
        'scenes': [_empty_cinematic_scene()],
        'video': None,
    }
    _cinematic_path(cinematic_id).write_text(json.dumps(data, indent=2))
    return jsonify(data)


@app.route('/api/cinematics/<cinematic_id>')
def api_get_cinematic(cinematic_id: str) -> jsonify:
    path = _cinematic_path(cinematic_id)
    if not path or not path.exists():
        return jsonify({'error': 'Cinematic sequence not found'}), 404
    return jsonify(json.loads(path.read_text()))


@app.route('/api/cinematics/<cinematic_id>', methods=['PUT'])
def api_update_cinematic(cinematic_id: str) -> jsonify:
    """Save the full cinematic sequence (title, scenes incl. shots/images, per-scene and sequence video).

    The client owns the in-memory cinematic object and PUTs the whole thing
    back after each change, same pattern as the storyboard save.
    """
    path = _cinematic_path(cinematic_id)
    if not path or not path.exists():
        return jsonify({'error': 'Cinematic sequence not found'}), 404
    body = request.get_json() or {}
    data = json.loads(path.read_text())
    if 'title' in body:
        data['title'] = (body.get('title') or data.get('title') or 'Untitled Sequence').strip()
    if 'scenes' in body:
        data['scenes'] = body['scenes']
    if 'video' in body:
        data['video'] = body['video']
    data['updated_at'] = datetime.utcnow().isoformat()
    path.write_text(json.dumps(data, indent=2))
    return jsonify(data)


@app.route('/api/cinematics/<cinematic_id>', methods=['DELETE'])
def api_delete_cinematic(cinematic_id: str) -> jsonify:
    path = _cinematic_path(cinematic_id)
    if path and path.exists():
        path.unlink()
    return jsonify({'deleted': cinematic_id})


SONGS_DIR = Path(__file__).resolve().parent / 'songs'
SONGS_DIR.mkdir(parents=True, exist_ok=True)


def _song_path(song_id: str) -> Optional[Path]:
    safe_id = re.sub(r'[^a-zA-Z0-9_-]', '', song_id or '')
    if not safe_id:
        return None
    return SONGS_DIR / f'{safe_id}.json'


@app.route('/api/songs')
def api_list_songs() -> jsonify:
    """List saved songs (persisted Composer bins + timeline arrangements)."""
    items = []
    for path in SONGS_DIR.glob('*.json'):
        try:
            data = json.loads(path.read_text())
        except Exception:
            continue
        clips = data.get('clips') or []
        timeline_length = max((c.get('start', 0) + c.get('duration', 0) for c in clips), default=0)
        items.append({
            'id': data.get('id'),
            'name': data.get('name') or 'Untitled Song',
            'clip_count': len(clips),
            'timeline_length': round(timeline_length, 2),
            'created_at': data.get('created_at'),
            'updated_at': data.get('updated_at'),
        })
    items.sort(key=lambda item: item.get('updated_at') or '', reverse=True)
    return jsonify({'songs': items})


@app.route('/api/songs', methods=['POST'])
def api_create_song() -> jsonify:
    """Create a new song, optionally seeded with the current Composer project settings."""
    body = request.get_json() or {}
    song_id = uuid.uuid4().hex[:12]
    now = datetime.utcnow().isoformat()
    data = {
        'id': song_id,
        'name': (body.get('name') or 'Untitled Song').strip(),
        'created_at': now,
        'updated_at': now,
        'project': body.get('project') or {},
        'bin': [],
        'clips': [],
    }
    _song_path(song_id).write_text(json.dumps(data, indent=2))
    return jsonify(data)


@app.route('/api/songs/<song_id>')
def api_get_song(song_id: str) -> jsonify:
    path = _song_path(song_id)
    if not path or not path.exists():
        return jsonify({'error': 'Song not found'}), 404
    return jsonify(json.loads(path.read_text()))


@app.route('/api/songs/<song_id>', methods=['PUT'])
def api_update_song(song_id: str) -> jsonify:
    """Save the full song (name, project settings, generated bin, timeline clips).

    Mirrors the storyboard save pattern: the client owns the in-memory
    composerState and PUTs the whole thing back after each change.
    """
    path = _song_path(song_id)
    if not path or not path.exists():
        return jsonify({'error': 'Song not found'}), 404
    body = request.get_json() or {}
    data = json.loads(path.read_text())
    if 'name' in body:
        data['name'] = (body.get('name') or data.get('name') or 'Untitled Song').strip()
    if 'project' in body:
        data['project'] = body['project']
    if 'bin' in body:
        data['bin'] = body['bin']
    if 'clips' in body:
        data['clips'] = body['clips']
    data['updated_at'] = datetime.utcnow().isoformat()
    path.write_text(json.dumps(data, indent=2))
    return jsonify(data)


@app.route('/api/songs/<song_id>', methods=['DELETE'])
def api_delete_song(song_id: str) -> jsonify:
    path = _song_path(song_id)
    if path and path.exists():
        path.unlink()
    return jsonify({'deleted': song_id})


def _enrich_job_outputs(job: Dict[str, Any]) -> None:
    """Attach ComfyUI output files to a queued Studio job when available."""
    result = job.get('result') or {}
    prompt_id = result.get('prompt_id')
    if not prompt_id or result.get('outputs') or not config_manager or not REQUESTS_AVAILABLE:
        return

    comfyui_config = config_manager.get_comfyui_config()
    try:
        response = requests.get(
            f"http://{comfyui_config['host']}:{comfyui_config['port']}/history/{prompt_id}",
            timeout=5,
        )
        if response.status_code != 200:
            return
        history = response.json().get(prompt_id, {})
    except Exception:
        return

    output_files = []
    for output in (history.get('outputs') or {}).values():
        for item in output.get('images', []) + output.get('videos', []):
            if item.get('type', 'output') != 'output':
                continue
            filename = item.get('filename')
            if not filename:
                continue
            subfolder = item.get('subfolder') or ''
            relative = f"{subfolder}/{filename}" if subfolder else filename
            output_files.append({
                'filename': filename,
                'subfolder': subfolder,
                'type': item.get('type', 'output'),
                'url': f"/api/outputs/{relative}",
            })

    if output_files:
        result['outputs'] = output_files
        job['result'] = result


@app.route('/api/health')
def api_health() -> jsonify:
    """Health check endpoint."""
    return jsonify({
        'status': 'ok',
        'version': __version__,
        'comfyui': config_manager.get_comfyui_config() if config_manager else {}
    })


@app.route('/api/system/stats')
def api_system_stats() -> jsonify:
    """Live CPU/RAM/GPU readout for the Runtime tab."""
    return jsonify(system_resource_stats())


@app.route('/api/services')
def api_services() -> jsonify:
    """Get local runtime service status from the migrated switcher."""
    code, output = run_service_command('status', timeout=20)
    return jsonify({
        'ok': code == 0,
        'command': 'status',
        'returncode': code,
        'output': output
    }), 200 if code == 0 else 500


@app.route('/api/services/<command>', methods=['POST'])
def api_service_command(command: str) -> jsonify:
    """Run a local runtime service command from the migrated switcher."""
    timeout = int((request.get_json(silent=True) or {}).get('timeout', 120))
    code, output = run_service_command(command, timeout=timeout)
    return jsonify({
        'ok': code == 0,
        'command': command,
        'returncode': code,
        'output': output
    }), 200 if code == 0 else 400


def _chat_unavailable_response():
    if not CHAT_AVAILABLE:
        return jsonify({'error': f'Chat module is unavailable: {CHAT_IMPORT_ERROR}'}), 500
    if chat_store is None:
        return jsonify({'error': 'Chat store is not initialized'}), 500
    return None


def _connect_host(host: Any) -> str:
    host = str(host or '127.0.0.1')
    return '127.0.0.1' if host in ('0.0.0.0', '::') else host


def _chat_runtime() -> Dict[str, str]:
    runtime = _runtime_config()
    return {
        'host': _connect_host(runtime.get('LLAMA_HOST', '127.0.0.1')),
        'port': str(runtime.get('LLAMA_PORT', '39001')),
        'model': str(runtime.get('LLAMA_ALIAS') or 'local-llama'),
    }


def _chat_llama_url(path: str) -> str:
    runtime = _chat_runtime()
    return f"http://{runtime['host']}:{runtime['port']}{path}"


def _chat_endpoint_candidates(model: str = '') -> List[Dict[str, str]]:
    runtime = _runtime_config()
    if workflow_manager:
        return workflow_manager._llm_endpoint_candidates(runtime, model)

    def connect_host(host: Any) -> str:
        host = str(host or '127.0.0.1')
        return '127.0.0.1' if host in ('0.0.0.0', '::') else host

    return [
        {
            'name': 'llama',
            'url': f"http://{connect_host(runtime.get('LLAMA_HOST', '127.0.0.1'))}:{runtime.get('LLAMA_PORT', '39001')}/v1/chat/completions",
            'model': str(model or runtime.get('LLAMA_ALIAS') or 'local-llama'),
        },
        {
            'name': 'ollama',
            'url': f"http://{connect_host(runtime.get('OLLAMA_HOST', '127.0.0.1'))}:{runtime.get('OLLAMA_PORT', '11434')}/v1/chat/completions",
            'model': str(model or runtime.get('OLLAMA_MODEL') or 'qwen3:0.6b'),
        },
    ]


def _endpoint_available_models(endpoint: Dict[str, str], timeout: float = 3.0) -> List[str]:
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


def _select_chat_endpoint(model: Optional[str] = None) -> Optional[Dict[str, str]]:
    requested = str(model or '').strip()
    first_online = None
    for endpoint in _chat_endpoint_candidates(requested):
        models = [item for item in _endpoint_available_models(endpoint) if item]
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


def _chat_model_online() -> bool:
    return _select_chat_endpoint() is not None


def _chat_available_models() -> List[str]:
    seen = set()
    models = []
    for endpoint in _chat_endpoint_candidates():
        for model in _endpoint_available_models(endpoint):
            if model and model not in seen:
                seen.add(model)
                models.append(model)
    return models


def _chat_completion(messages: List[Dict[str, str]], model: Optional[str] = None) -> str:
    endpoint = _select_chat_endpoint(model)
    if not endpoint:
        raise RuntimeError('No local chat endpoint is online. Start Coding LLM, Sidecar, or Ollama.')
    body = json.dumps({
        'model': model or endpoint['model'],
        'messages': messages,
        'temperature': 0.6,
        'top_p': 0.9,
        'max_tokens': 2048,
    }).encode('utf-8')
    llama_request = urllib.request.Request(
        endpoint['url'],
        data=body,
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer sk-local'},
        method='POST',
    )
    try:
        with urllib.request.urlopen(llama_request, timeout=600) as response:
            payload = json.loads(response.read())
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode('utf-8', 'replace')
        raise RuntimeError(f"{endpoint['name']} returned HTTP {exc.code}: {detail}") from exc
    return payload['choices'][0]['message']['content']


class _FlaskChatAdapter:
    """Tiny adapter for Hilbert Chat helpers that expect a request handler."""

    def __init__(self, host: str):
        self.headers = {'Host': host}


def _chat_respond(history_messages: List[Dict[str, str]], content: str, model: Optional[str] = None) -> str:
    if looks_like_image_request(content):
        return generate_image_with_comfy(_FlaskChatAdapter(request.host), content, model)

    if looks_like_search_request(content):
        query = extract_search_query(content)
        results = web_search(query)
        search_context = format_search_context(query, results)
        tool_message = {
            'role': 'system',
            'content': (
                "You have web search results for the user's request below. "
                "Answer using the results where relevant and include source URLs.\n\n"
                f"{search_context}"
            ),
        }
        messages = history_messages + [tool_message, {'role': 'user', 'content': content}]
        return _chat_completion(messages, model)

    messages = history_messages + [{'role': 'user', 'content': content}]
    return _chat_completion(messages, model)


@app.route('/api/chat/health')
def api_chat_health() -> jsonify:
    unavailable = _chat_unavailable_response()
    if unavailable:
        return unavailable
    runtime = _chat_runtime()
    endpoint = _select_chat_endpoint()
    return jsonify({
        'ok': endpoint is not None,
        'model': endpoint['model'] if endpoint else runtime['model'],
        'llama': endpoint['url'] if endpoint else f"http://{runtime['host']}:{runtime['port']}",
        'endpoint': endpoint['name'] if endpoint else '',
        'url': endpoint['url'] if endpoint else '',
        'standalone_command': 'chat',
    })


@app.route('/api/chat/sessions')
def api_chat_sessions() -> jsonify:
    unavailable = _chat_unavailable_response()
    if unavailable:
        return unavailable
    try:
        user = request.args.get('user', 'Derek')
        return jsonify({'users': CHAT_USERS, 'sessions': chat_store.list_sessions(user)})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 400


@app.route('/api/chat/models')
def api_chat_models() -> jsonify:
    unavailable = _chat_unavailable_response()
    if unavailable:
        return unavailable
    models = [model for model in _chat_available_models() if model]
    runtime = _runtime_config()
    default_model = _chat_runtime()['model']
    ollama_model = str(runtime.get('OLLAMA_MODEL') or '').strip()
    if default_model not in models and ollama_model in models:
        default_model = ollama_model
    elif default_model not in models and models:
        default_model = models[0]
    if default_model and default_model not in models:
        models.insert(0, default_model)
    return jsonify({'models': models, 'default_model': default_model})


@app.route('/api/chat/session')
def api_chat_session() -> jsonify:
    unavailable = _chat_unavailable_response()
    if unavailable:
        return unavailable
    try:
        user = request.args.get('user', 'Derek')
        session_id = request.args.get('id', '')
        return jsonify({'session': chat_store.get_session(user, session_id)})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 400


@app.route('/api/chat/session', methods=['POST'])
def api_chat_create_session() -> jsonify:
    unavailable = _chat_unavailable_response()
    if unavailable:
        return unavailable
    try:
        payload = request.get_json(silent=True) or {}
        session = chat_store.create_session(payload.get('user', 'Derek'), payload.get('title', 'New Chat'))
        return jsonify({'session': session})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 400


@app.route('/api/chat/session/rename', methods=['POST'])
def api_chat_rename_session() -> jsonify:
    unavailable = _chat_unavailable_response()
    if unavailable:
        return unavailable
    try:
        payload = request.get_json(silent=True) or {}
        session = chat_store.rename_session(payload.get('user', 'Derek'), payload.get('id', ''), payload.get('title', 'New Chat'))
        return jsonify({'session': session})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 400


@app.route('/api/chat/session/delete', methods=['POST'])
def api_chat_delete_session() -> jsonify:
    unavailable = _chat_unavailable_response()
    if unavailable:
        return unavailable
    try:
        payload = request.get_json(silent=True) or {}
        chat_store.delete_session(payload.get('user', 'Derek'), payload.get('id', ''))
        return jsonify({'ok': True})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 400


@app.route('/api/chat/message', methods=['POST'])
def api_chat_message() -> jsonify:
    unavailable = _chat_unavailable_response()
    if unavailable:
        return unavailable
    try:
        payload = request.get_json(silent=True) or {}
        user = payload.get('user', 'Derek')
        session_id = payload.get('session_id', '')
        model = payload.get('model') or _chat_runtime()['model']
        content = str(payload.get('content') or '').strip()
        if not content:
            return jsonify({'error': 'content is required'}), 400
        session = chat_store.get_session(user, session_id)
        assistant_text = _chat_respond(session.get('messages') or [], content, model)
        updated = chat_store.append_exchange(user, session_id, content, assistant_text)
        return jsonify({'assistant': {'role': 'assistant', 'content': assistant_text}, 'session': updated})
    except Exception as exc:
        return jsonify({'error': str(exc)}), 502


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


def _runtime_config() -> Dict[str, str]:
    try:
        from ai_manager import load_config
        return load_config()
    except Exception:
        return {}


def _set_config_env_values(updates: Dict[str, str]) -> None:
    try:
        from ai_manager import CONFIG
    except Exception:
        CONFIG = Path('config.env')

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
    pid_path = Path('.pids/llama.pid')
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


@app.route('/api/llm-endpoints')
def api_llm_endpoints() -> jsonify:
    """List configured OpenAI-compatible LLM endpoints in runtime order."""
    if not workflow_manager:
        return jsonify({'error': 'Application not initialized'}), 500

    try:
        from ai_manager import load_config
        runtime_config = load_config()
    except Exception:
        runtime_config = {}

    endpoints = workflow_manager._llm_endpoint_candidates(runtime_config, '')
    checks = [check_llm_endpoint(endpoint) for endpoint in endpoints]
    return jsonify({
        'endpoints': checks,
        'configured_network': bool(str(runtime_config.get('LLM_ENDPOINTS') or '').strip()),
    })


# CLI Commands
def list_workflows(args: argparse.Namespace) -> None:
    """List all workflows."""
    if not workflow_manager:
        print("Error: Workflow manager not initialized")
        return

    workflows = workflow_manager.get_workflows()

    if args.category:
        workflows = [w for w in workflows if w['category'] == args.category]

    if not workflows:
        print("No workflows found.")
        return

    print(f"\n{'ID':<40} {'Name':<30} {'Category':<20} {'Status':<10}")
    print("-" * 100)

    for workflow in workflows:
        print(
            f"{workflow['id']:<40} "
            f"{workflow['name']:<30} "
            f"{workflow['category']:<20} "
            f"{workflow['status']:<10}"
        )

    print(f"\nTotal: {len(workflows)} workflows")


def show_workflow(args: argparse.Namespace) -> None:
    """Show workflow details."""
    if not workflow_manager:
        print("Error: Workflow manager not initialized")
        return

    workflow_data = workflow_manager.get_workflow_by_id(args.workflow_id)

    if not workflow_data:
        print(f"Error: Workflow '{args.workflow_id}' not found")
        return

    manifest = workflow_data.get('manifest', {})

    print(f"\n{manifest.get('name', args.workflow_id)}")
    print("=" * 60)
    print(f"ID: {args.workflow_id}")
    print(f"Version: {manifest.get('version', 'N/A')}")
    print(f"Category: {manifest.get('category', 'N/A')}")
    print(f"Status: {manifest.get('status', 'N/A')}")
    print(f"\nDescription:\n{manifest.get('description', 'N/A')}\n")

    # Hardware requirements
    hardware = manifest.get('hardware', {})
    print("Hardware Requirements:")
    print(f"  Minimum VRAM: {hardware.get('minimum_vram_gb', 'N/A')} GB")
    print(f"  Recommended VRAM: {hardware.get('recommended_vram_gb', 'N/A')} GB")
    print(f"  Supports Low VRAM: {hardware.get('supports_low_vram', 'N/A')}")
    print(f"  Supports CPU Offload: {hardware.get('supports_cpu_offload', 'N/A')}\n")

    # Models
    models = manifest.get('models', {})
    if models.get('required'):
        print("Required Models:")
        for model in models['required']:
            print(f"  - {model.get('name', 'N/A')} ({model.get('type', 'N/A')})")

    if models.get('optional'):
        print("\nOptional Models:")
        for model in models['optional']:
            print(f"  - {model.get('name', 'N/A')} ({model.get('type', 'N/A')})")

    # Custom nodes
    nodes = manifest.get('custom_nodes', {})
    if nodes.get('required'):
        print("\nRequired Custom Nodes:")
        for node in nodes['required']:
            print(f"  - {node}")

    # Input fields
    inputs = manifest.get('inputs', [])
    if inputs:
        print("\nInput Fields:")
        for inp in inputs:
            required = " (required)" if inp.get('required', False) else ""
            default = f" (default: {inp.get('default', 'N/A')})" if 'default' in inp else ""
            print(f"  - {inp.get('id', 'N/A')}: {inp.get('type', 'N/A')}{required}{default}")

    print()


def run_workflow(args: argparse.Namespace) -> None:
    """Run a workflow."""
    if not job_queue or not workflow_manager:
        print("Error: Application not initialized")
        return

    try:
        inputs = {}
        if args.inputs:
            # Parse key=value pairs
            for pair in args.inputs:
                if '=' in pair:
                    key, value = pair.split('=', 1)
                    inputs[key] = value

        job_id = job_queue.add_job(
            workflow_id=args.workflow_id,
            inputs=inputs
        )
        job_queue.start_job(job_id)
        success, result = workflow_manager.run_workflow(args.workflow_id, inputs)
        job_queue.update_job(
            job_id,
            status='completed' if success else 'failed',
            progress=100,
            result=result if success else None,
            error=None if success else result.get('error', 'Workflow failed')
        )

        print(f"Workflow '{args.workflow_id}' {'completed' if success else 'failed'}.")
        print(f"Job ID: {job_id}")
        print(f"Status: {'completed' if success else 'failed'}")
        print(f"Result: {json.dumps(result, indent=2)}")
        if not success:
            raise SystemExit(1)

        # Monitor job if requested
        if args.monitor:
            print("\nMonitoring job...")
            while True:
                job = job_queue.get_job(job_id)
                if not job:
                    print("Job not found")
                    break

                status = job.get('status', 'unknown')
                progress = job.get('progress', 0)

                print(f"\rJob status: {status} ({progress}%)", end='', flush=True)

                if status in ['completed', 'failed', 'cancelled']:
                    print()
                    if job.get('error'):
                        print(f"Error: {job['error']}")
                    if job.get('result'):
                        print(f"Result: {job['result']}")
                    break

                time.sleep(1)

    except Exception as e:
        print(f"Error running workflow: {e}")


def show_jobs(args: argparse.Namespace) -> None:
    """Show job queue."""
    if not job_queue:
        print("Error: Job queue not initialized")
        return

    print("\nJob Queue Status")
    print("=" * 60)

    queued = job_queue.get_queue()
    if queued:
        print(f"\nQueued ({len(queued)} jobs):")
        for job in queued:
            print(f"  [{job['job_id']}] {job['workflow_id']} - {job['status']}")

    running = job_queue.get_running()
    if running:
        print(f"\nRunning ({len(running)} jobs):")
        for job in running:
            progress = job.get('progress', 0)
            print(f"  [{job['job_id']}] {job['workflow_id']} - {job['status']} ({progress}%)")

    completed = job_queue.get_completed()
    if completed:
        print(f"\nCompleted ({len(completed)} jobs):")
        for job in completed:
            completed_at = job.get('completed_at', 'N/A')
            print(f"  [{job['job_id']}] {job['workflow_id']} - {job['status']} ({completed_at})")

    print()


def show_config(args: argparse.Namespace) -> None:
    """Show configuration."""
    if not config_manager:
        print("Error: Configuration not loaded")
        return

    print("\nAI Suite Configuration")
    print("=" * 60)

    print("\nSuite Information:")
    suite = config_manager.config.get('suite', {})
    print(f"  Name: {suite.get('name', 'N/A')}")
    print(f"  Version: {suite.get('version', 'N/A')}")
    print(f"  Description: {suite.get('description', 'N/A')}")

    print("\nPaths:")
    paths = config_manager.config.get('paths', {})
    for key, value in paths.items():
        print(f"  {key}: {value}")

    print("\nSettings:")
    settings = config_manager.config.get('settings', {})
    for key, value in settings.items():
        print(f"  {key}: {value}")

    print("\nComfyUI Connection:")
    comfyui = config_manager.get_comfyui_config()
    print(f"  Host: {comfyui['host']}")
    print(f"  Port: {comfyui['port']}")
    print(f"  Timeout: {comfyui['timeout']}s")

    print("\nLauncher:")
    launcher = config_manager.get_launcher_config()
    print(f"  Host: {launcher['host']}")
    print(f"  Port: {launcher['port']}")

    print()


def show_categories(args: argparse.Namespace) -> None:
    """Show available categories."""
    if not workflow_manager:
        print("Error: Workflow manager not initialized")
        return

    workflows = workflow_manager.get_workflows()
    categories = {}

    for workflow in workflows:
        category = workflow['category']
        if category not in categories:
            categories[category] = []
        categories[category].append(workflow)

    print("\nAvailable Categories")
    print("=" * 60)

    for category in sorted(categories.keys()):
        workflows_in_category = categories[category]
        print(f"\n{category} ({len(workflows_in_category)} workflows):")
        for workflow in workflows_in_category[:5]:
            print(f"  - {workflow['name']}")

        if len(workflows_in_category) > 5:
            print(f"  ... and {len(workflows_in_category) - 5} more")

    print()


def service_command(args: argparse.Namespace) -> None:
    """Run a migrated local AI switcher command."""
    code, output = run_service_command(args.service_command, timeout=args.timeout)
    if output:
        print(output.rstrip())
    if code != 0:
        raise SystemExit(code)


def main() -> None:
    """Main entry point."""
    global config_manager, registry_manager, model_manager, hardware_manager, dependency_manager, job_queue, workflow_manager

    # Create argument parser
    parser = argparse.ArgumentParser(
        description='AI Suite Launcher - Workflow Management System',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  %(prog)s                    # Start web server
  %(prog)s --host 0.0.0.0 --port 8000
  %(prog)s list               # List all workflows
  %(prog)s list --category character
  %(prog)s show character.character-sheet
  %(prog)s run character.character-sheet prompt="a cat" width=512 height=512
  %(prog)s jobs               # Show job queue
  %(prog)s config             # Show configuration
        '''
    )

    # Global options
    parser.add_argument(
        '--host', '-H',
        default='127.0.0.1',
        help='Host to bind to (default: 127.0.0.1)'
    )
    parser.add_argument(
        '--port', '-p',
        type=int,
        default=39000,
        help='Port to bind to (default: 39000)'
    )
    parser.add_argument(
        '--debug', '-d',
        action='store_true',
        help='Enable debug mode'
    )
    parser.add_argument(
        '--init-only',
        action='store_true',
        help='Initialize application and exit'
    )

    # Subparsers for commands
    subparsers = parser.add_subparsers(dest='command', help='Available commands')

    # List command
    list_parser = subparsers.add_parser('list', help='List workflows')
    list_parser.add_argument(
        '--category', '-c',
        help='Filter by category'
    )

    # Show command
    show_parser = subparsers.add_parser('show', help='Show workflow details')
    show_parser.add_argument(
        'workflow_id',
        help='Workflow ID to show'
    )

    # Run command
    run_parser = subparsers.add_parser('run', help='Run a workflow')
    run_parser.add_argument(
        'workflow_id',
        help='Workflow ID to run'
    )
    run_parser.add_argument(
        'inputs',
        nargs='*',
        help='Input parameters as key=value pairs'
    )
    run_parser.add_argument(
        '--monitor', '-m',
        action='store_true',
        help='Monitor job progress'
    )

    # Jobs command
    subparsers.add_parser('jobs', help='Show job queue')

    # Config command
    subparsers.add_parser('config', help='Show configuration')

    # Categories command
    subparsers.add_parser('categories', help='Show available categories')

    # Service/switcher command
    service_parser = subparsers.add_parser('service', help='Control migrated local AI runtime services')
    service_parser.add_argument(
        'service_command',
        choices=sorted(SERVICE_COMMANDS),
        help='Switcher command to run'
    )
    service_parser.add_argument(
        '--timeout',
        type=int,
        default=120,
        help='Command timeout in seconds'
    )

    # Version command
    subparsers.add_parser('version', help='Show version')

    # Handle version first (before parsing)
    if len(sys.argv) > 1 and sys.argv[1] in ['-v', '--version', 'version']:
        print(f"AI Suite Launcher v{__version__}")
        return

    # Parse arguments
    args = parser.parse_args()

    # Initialize application
    try:
        initialize_app()
    except Exception as e:
        print(f"Error initializing application: {e}")
        sys.exit(1)

    # Handle init-only mode
    if args.init_only:
        print("Application initialized successfully.")
        return

    # Handle commands
    if args.command == 'list':
        list_workflows(args)
    elif args.command == 'show':
        show_workflow(args)
    elif args.command == 'run':
        run_workflow(args)
    elif args.command == 'jobs':
        show_jobs(args)
    elif args.command == 'config':
        show_config(args)
    elif args.command == 'categories':
        show_categories(args)
    elif args.command == 'service':
        service_command(args)
    elif args.command is None:
        # Start web server
        print(f"Starting AI Suite Launcher v{__version__}")
        print(f"Host: {args.host}:{args.port}")
        print(f"Debug: {'enabled' if args.debug else 'disabled'}")

        # Start Flask app
        app.run(
            host=args.host,
            port=args.port,
            debug=args.debug,
            threaded=True
        )
    else:
        parser.print_help()


if __name__ == '__main__':
    main()
