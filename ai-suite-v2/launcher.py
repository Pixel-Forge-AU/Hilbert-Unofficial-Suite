#!/usr/bin/env python3
"""
AI Suite V2 Launcher

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
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import yaml
from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

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

__version__ = "2.0.0"
__author__ = "AI Suite V2 Team"


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
                        'name': 'AI Suite V2',
                        'version': '2.0.0',
                        'description': 'Modular ComfyUI workflow platform'
                    },
                    'paths': {
                        'workflows': './workflows',
                        'packs': './packs',
                        'shared': './shared',
                        'presets': './presets',
                        'legacy_workflows': './legacy-workflows',
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
                        'comfyui_port': 8188,
                        'comfyui_timeout': 300,
                        'launcher_host': '127.0.0.1',
                        'launcher_port': 8000,
                        'enable_batch_processing': True,
                        'enable_dependency_check': True,
                        'enable_quality_control': True,
                        'enable_workflow_registry': True,
                        'enable_preset_system': True,
                        'max_queue_size': 50,
                        'max_history_size': 100,
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
                'name': 'AI Suite V2',
                'version': '2.0.0',
                'description': 'Modular ComfyUI workflow platform'
            },
            'paths': {
                'workflows': './workflows',
                'packs': './packs',
                'shared': './shared',
                'presets': './presets',
                'legacy_workflows': './legacy-workflows',
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
                'comfyui_port': 8188,
                'comfyui_timeout': 300,
                'launcher_host': '127.0.0.1',
                'launcher_port': 8000,
                'enable_batch_processing': True,
                'enable_dependency_check': True,
                'enable_quality_control': True,
                'enable_workflow_registry': True,
                'enable_preset_system': True,
                'max_queue_size': 50,
                'max_history_size': 100,
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
            'port': settings.get('comfyui_port', 8188),
            'timeout': settings.get('comfyui_timeout', 300)
        }

    def get_launcher_config(self) -> Dict[str, Any]:
        """Get launcher configuration."""
        settings = self.config.get('settings', {})
        return {
            'host': settings.get('launcher_host', '127.0.0.1'),
            'port': settings.get('launcher_port', 8000)
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


class JobQueue:
    """Manages the workflow job queue."""

    def __init__(self, max_size: int = 50):
        """Initialize job queue."""
        self.max_size = max_size
        self.queued_jobs: Dict[str, Dict[str, Any]] = {}
        self.running_jobs: Dict[str, Dict[str, Any]] = {}
        self.completed_jobs: Dict[str, Dict[str, Any]] = {}
        self.lock = threading.Lock()
        self._cleanup_completed()

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

            if status in ['completed', 'failed', 'cancelled']:
                job['completed_at'] = datetime.now().isoformat()
                self.completed_jobs[job_id] = job
                del self.running_jobs[job_id]

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
            return count


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
        self._comfy_node_types_cache: Optional[set] = None
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
                'hardware': self._workflow_hardware(manifest)
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

        if manifest.get('source', {}).get('suite') == 'v1':
            try:
                from comfy_studio import workflow_to_api
                prompt = workflow_to_api(workflow) if 'nodes' in workflow else workflow
                node_types = [
                    node.get('class_type')
                    for node in prompt.values()
                    if isinstance(node, dict)
                ]
            except Exception:
                node_types = []
        elif 'nodes' in workflow:
            node_types = [node.get('type') for node in workflow.get('nodes', [])]
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

    def _available_comfy_node_types(self) -> Optional[set]:
        if self._comfy_node_types_cache is not None:
            return self._comfy_node_types_cache
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
            self._comfy_node_types_cache = set(response.json().keys())
            return self._comfy_node_types_cache
        except Exception:
            return None

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
            if preset_names:
                for name in preset_names:
                    for candidate in (presets_dir / f'{name}.yaml', presets_dir / f'{name}.yml'):
                        if candidate.exists():
                            preset_paths.append(candidate)
                            break
            else:
                preset_paths = sorted(list(presets_dir.glob('*.yaml')) + list(presets_dir.glob('*.yml')))

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
                    json={'prompt': prompt, 'client_id': str(uuid.uuid4())},
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
            'url': chat_url(f"http://{connect_host(runtime_config.get('QWEN_SIDECAR_HOST', '127.0.0.1'))}:{runtime_config.get('QWEN_SIDECAR_PORT', '8081')}"),
            'model': str(sidecar_model),
        })
        main_model = requested_model or runtime_config.get('LLAMA_ALIAS') or 'local-llama'
        candidates.append({
            'name': 'llama',
            'url': chat_url(f"http://{connect_host(runtime_config.get('LLAMA_HOST', '127.0.0.1'))}:{runtime_config.get('LLAMA_PORT', '8080')}"),
            'model': str(main_model),
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
        if manifest.get('source', {}).get('suite') == 'v1' and workflow:
            from comfy_studio import workflow_to_api

            prompt = workflow_to_api(workflow) if 'nodes' in workflow else workflow
            self._apply_manifest_controls(prompt, manifest, inputs)
            self._finalize_workflow_prompt(prompt, manifest, inputs)
            return prompt

        if workflow and 'nodes' not in workflow:
            prompt = copy.deepcopy(workflow)
            self._apply_manifest_controls(prompt, manifest, inputs)
            self._finalize_workflow_prompt(prompt, manifest, inputs)
            return prompt

        if not workflow or 'nodes' not in workflow:
            raise ValueError('Workflow JSON is missing or unsupported')

        prompt: Dict[str, Any] = {}
        link_map: Dict[Tuple[int, int], List[Any]] = {}
        link_id_map: Dict[int, List[Any]] = {}

        for node in workflow.get('nodes', []):
            for slot, output_def in enumerate(node.get('outputs', []) or []):
                for link_id in output_def.get('links') or []:
                    if link_id is not None:
                        link_id_map[int(link_id)] = [str(node.get('id')), int(slot)]

        for link in workflow.get('links', []):
            if isinstance(link, list) and len(link) >= 5:
                link_id, origin_id, origin_slot, target_id, target_slot = link[:5]
                if not isinstance(target_id, int):
                    continue
                link_value = [str(origin_id), int(origin_slot)]
                link_map[(int(target_id), int(target_slot))] = link_value
                link_id_map[int(link_id)] = link_value

        for node in workflow.get('nodes', []):
            node_id = str(node.get('id'))
            class_type = node.get('type')
            node_inputs: Dict[str, Any] = {}

            for index, input_def in enumerate(node.get('inputs', []) or []):
                link_value = link_map.get((int(node['id']), index))
                if link_value is None and input_def.get('link') is not None:
                    link_value = link_id_map.get(int(input_def['link']))
                if link_value is not None:
                    node_inputs[input_def.get('name')] = link_value

            node_inputs.update(self._widget_inputs_for_node(class_type, node, inputs))
            prompt[node_id] = {
                'class_type': class_type,
                'inputs': node_inputs,
            }

        self._apply_manifest_controls(prompt, manifest, inputs)
        self._finalize_workflow_prompt(prompt, manifest, inputs)
        return prompt

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
            elif class_type == 'UpscaleModelLoader':
                node_inputs.setdefault('model_name', inputs.get('model_name') or 'RealESRGAN_x4plus.safetensors')

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
        widgets = list(node.get('widgets_values') or [])
        values: Dict[str, Any] = {}

        if class_type == 'CheckpointLoaderSimple':
            checkpoint = inputs.get('checkpoint') or (widgets[0] if widgets else 'sdxl.safetensors')
            values['ckpt_name'] = self._normalize_checkpoint(str(checkpoint))
        elif class_type == 'CLIPTextEncode':
            title = str(node.get('title') or '').lower()
            default_text = widgets[0] if widgets else ''
            if 'negative' in title or 'low quality' in str(default_text).lower():
                values['text'] = inputs.get('negative_prompt', default_text)
            else:
                values['text'] = inputs.get('prompt', default_text)
        elif class_type == 'EmptyLatentImage':
            values['width'] = int(inputs.get('width', widgets[0] if len(widgets) > 0 else 512))
            values['height'] = int(inputs.get('height', widgets[1] if len(widgets) > 1 else 512))
            values['batch_size'] = int(inputs.get('batch_size', widgets[2] if len(widgets) > 2 else 1))
        elif class_type == 'ImageScale':
            if widgets and isinstance(widgets[0], (int, float)):
                default_width = widgets[0] if len(widgets) > 0 else 512
                default_height = widgets[1] if len(widgets) > 1 else 512
                default_method = widgets[2] if len(widgets) > 2 else 'lanczos'
                default_crop = widgets[3] if len(widgets) > 3 else 'center'
            else:
                default_method = widgets[0] if len(widgets) > 0 else 'lanczos'
                default_width = widgets[1] if len(widgets) > 1 else 512
                default_height = widgets[2] if len(widgets) > 2 else 512
                default_crop = widgets[3] if len(widgets) > 3 else 'center'
            if isinstance(default_crop, bool):
                default_crop = 'center' if default_crop else 'disabled'
            values['upscale_method'] = inputs.get('upscale_method', default_method)
            values['width'] = int(inputs.get('width', default_width))
            values['height'] = int(inputs.get('height', default_height))
            values['crop'] = inputs.get('crop', default_crop)
        elif class_type == 'KSampler':
            seed = int(inputs.get('seed', widgets[0] if len(widgets) > 0 else -1))
            if seed < 0:
                seed = random.randint(0, 2**63 - 1)
            values.update({
                'seed': seed,
                'steps': int(inputs.get('steps', widgets[2] if len(widgets) > 2 else 20)),
                'cfg': float(inputs.get('cfg', widgets[3] if len(widgets) > 3 else 7.0)),
                'sampler_name': inputs.get('sampler_name') or inputs.get('sampler') or (widgets[4] if len(widgets) > 4 else 'euler'),
                'scheduler': inputs.get('scheduler') or (widgets[5] if len(widgets) > 5 else 'simple'),
                'denoise': float(inputs.get('denoise', inputs.get('edit_strength', widgets[6] if len(widgets) > 6 else 1.0))),
            })
        elif class_type == 'SaveImage':
            prefix = widgets[0] if widgets else 'AI-Suite'
            values['filename_prefix'] = inputs.get('filename_prefix') or prefix or f"ai-suite/{int(time.time())}"
        elif class_type == 'SaveVideo':
            values['filename_prefix'] = inputs.get('filename_prefix') or (widgets[0] if len(widgets) > 0 else 'video/ComfyUI')
            values['format'] = widgets[1] if len(widgets) > 1 else 'auto'
            values['codec'] = widgets[2] if len(widgets) > 2 else 'auto'
        elif class_type == 'CreateCameraInfo':
            values.update({
                'mode': widgets[0] if len(widgets) > 0 else 'orbit',
                'yaw': float(widgets[1] if len(widgets) > 1 else 35.0),
                'pitch': float(widgets[2] if len(widgets) > 2 else 30.0),
                'distance': float(widgets[3] if len(widgets) > 3 else 2.5),
                'target_x': float(widgets[4] if len(widgets) > 4 else 0.0),
                'target_y': float(widgets[5] if len(widgets) > 5 else 0.0),
                'target_z': float(widgets[6] if len(widgets) > 6 else 0.0),
                'roll': float(widgets[7] if len(widgets) > 7 else 0.0),
                'fov': float(widgets[8] if len(widgets) > 8 else 35.0),
                'zoom': float(widgets[9] if len(widgets) > 9 else 1.0),
                'camera_type': widgets[10] if len(widgets) > 10 else 'perspective',
            })
        elif class_type == 'RenderSplat':
            values.update({
                'width': int(inputs.get('render_width', widgets[0] if len(widgets) > 0 else 1024)),
                'height': int(inputs.get('render_height', widgets[1] if len(widgets) > 1 else 1024)),
                'frames': int(inputs.get('render_frames', widgets[2] if len(widgets) > 2 else 1)),
                'splat_scale': float(widgets[3] if len(widgets) > 3 else 1.0),
                'sharpen': float(widgets[4] if len(widgets) > 4 else 2.0),
                'headlight_shading': float(widgets[5] if len(widgets) > 5 else 0.0),
                'opacity_threshold': float(widgets[6] if len(widgets) > 6 else 0.0),
                'render_style': widgets[7] if len(widgets) > 7 else 'color',
                'background': widgets[8] if len(widgets) > 8 else '#000000',
            })
        elif class_type == 'TripoSplatPreprocessImage':
            values['erode_radius'] = int(widgets[0] if len(widgets) > 0 else 1)
            values['size'] = int(inputs.get('preprocess_size', widgets[1] if len(widgets) > 1 else 1024))
        elif class_type == 'TripoSplatSamplingPreview':
            values.update({
                'octree_level': int(widgets[0] if len(widgets) > 0 else 5),
                'num_gaussians': int(inputs.get('preview_gaussians', widgets[1] if len(widgets) > 1 else 16384)),
                'yaw': float(widgets[2] if len(widgets) > 2 else 90.0),
                'pitch': float(widgets[3] if len(widgets) > 3 else 15.0),
                'point_size': int(widgets[4] if len(widgets) > 4 else 3),
            })
        elif class_type == 'VAEDecodeTripoSplat':
            values['num_gaussians'] = int(inputs.get('num_gaussians', widgets[0] if len(widgets) > 0 else 262144))
            values['seed'] = int(inputs.get('splat_seed', widgets[1] if len(widgets) > 1 else 0))

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


SERVICE_COMMANDS = {
    'llama',
    'llama-heretic',
    'llama-small',
    'qwen-sidecar',
    'qwen-sidecar-stop',
    'chat-sidecar',
    'chat',
    'studio',
    'playwright',
    'hilbert',
    'hilbert-heretic',
    'hilbert-small',
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
    global config_manager, registry_manager, model_manager, hardware_manager, dependency_manager, job_queue, workflow_manager

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

    # Initialize workflow manager
    workflow_manager = WorkflowManager(
        config_manager=config_manager,
        registry_manager=registry_manager,
        dependency_manager=dependency_manager,
        hardware_manager=hardware_manager
    )


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
        version=__version__
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
        'hardware': workflow_manager._workflow_hardware(manifest)
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


@app.route('/api/workflows/<workflow_id>/run', methods=['POST'])
def api_run_workflow(workflow_id: str) -> jsonify:
    """Run a workflow."""
    if not workflow_manager:
        return jsonify({'error': 'Workflow manager not initialized'}), 500

    data = request.get_json() or {}

    try:
        job_id = job_queue.add_job(
            workflow_id=workflow_id,
            inputs=data.get('inputs', {})
        )
        job_queue.start_job(job_id)
        success, result = workflow_manager.run_workflow(
            workflow_id=workflow_id,
            inputs=data.get('inputs', {})
        )
        job_queue.update_job(
            job_id,
            status='completed' if success else 'failed',
            progress=100,
            result=result if success else None,
            error=None if success else result.get('error', 'Workflow failed')
        )

        return jsonify({
            'job_id': job_id,
            'status': 'completed' if success else 'failed',
            'workflow_id': workflow_id,
            'result': result
        }), 200 if success else 400

    except ValueError as e:
        return jsonify({'error': str(e)}), 400


@app.route('/api/jobs')
def api_jobs() -> jsonify:
    """Get job queue status."""
    try:
        limit = max(1, min(int(request.args.get('limit', 50)), 200))
    except ValueError:
        limit = 50
    completed = job_queue.get_completed(limit=limit)
    for job in completed:
        _enrich_job_outputs(job)
    return jsonify({
        'queued': job_queue.get_queue(),
        'running': job_queue.get_running(),
        'completed': completed
    })


@app.route('/api/jobs/<job_id>')
def api_job_status(job_id: str) -> jsonify:
    """Get job status by ID."""
    job = job_queue.get_job(job_id)

    if not job:
        return jsonify({'error': 'Job not found'}), 404

    _enrich_job_outputs(job)
    return jsonify(job)


@app.route('/api/outputs/<path:subpath>')
def api_output_file(subpath: str):
    """Serve a ComfyUI output file through Studio."""
    if not config_manager:
        return jsonify({'error': 'Application not initialized'}), 500

    comfyui_dir = os.environ.get('COMFYUI_DIR') or str(Path(__file__).resolve().parent / 'repos/ComfyUI')
    output_dir = (Path(comfyui_dir) / 'output').resolve()
    target = (output_dir / subpath).resolve()
    if output_dir not in target.parents and target != output_dir:
        return jsonify({'error': 'Invalid output path'}), 400
    if not target.exists() or not target.is_file():
        return jsonify({'error': 'Output not found'}), 404
    return send_from_directory(target.parent, target.name)


@app.route('/api/input/<path:subpath>')
def api_input_file(subpath: str):
    """Serve a ComfyUI input file through Studio."""
    if not config_manager:
        return jsonify({'error': 'Application not initialized'}), 500

    comfyui_dir = os.environ.get('COMFYUI_DIR') or str(Path(__file__).resolve().parent / 'repos/ComfyUI')
    input_dir = (Path(comfyui_dir) / 'input').resolve()
    target = (input_dir / subpath).resolve()
    if input_dir not in target.parents and target != input_dir:
        return jsonify({'error': 'Invalid input path'}), 400
    if not target.exists() or not target.is_file():
        return jsonify({'error': 'Input not found'}), 404
    return send_from_directory(target.parent, target.name)


@app.route('/api/outputs')
def api_outputs_index() -> jsonify:
    """List recent ComfyUI output files for the Studio preview rail."""
    if not config_manager:
        return jsonify({'error': 'Application not initialized'}), 500

    try:
        limit = max(1, min(int(request.args.get('limit', 24)), 100))
    except ValueError:
        limit = 24

    comfyui_dir = os.environ.get('COMFYUI_DIR') or str(Path(__file__).resolve().parent / 'repos/ComfyUI')
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
            'url': f"/api/outputs/{relative}",
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

    comfyui_dir = os.environ.get('COMFYUI_DIR') or str(Path(__file__).resolve().parent / 'repos/ComfyUI')
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
            'url': f"/api/input/{relative}",
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

    comfyui_dir = os.environ.get('COMFYUI_DIR') or str(Path(__file__).resolve().parent / 'repos/ComfyUI')
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

    print("\nAI Suite V2 Configuration")
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
        description='AI Suite V2 Launcher - Workflow Management System',
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
        default=8000,
        help='Port to bind to (default: 8000)'
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
        print(f"AI Suite V2 Launcher v{__version__}")
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
        print(f"Starting AI Suite V2 Launcher v{__version__}")
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
