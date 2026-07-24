"""
AI Suite Tools Package

This package provides build tools for managing AI workflow manifests in the
AI Suite repository. It includes utilities for registry generation,
workflow compilation, validation, and documentation.

Modules:
    - registry_generator: Generate registry JSON from pack manifests
    - workflow_compiler: Compile workflow packs for distribution
    - validator: Validate manifests against schemas
    - documentation_generator: Generate documentation from manifests

Usage:
    # As a module
    from tools import registry_generator
    registry = registry_generator.generate_registry("/path/to/packs")

    # As a CLI tool
    python -m tools registry --packs-dir packs --output registry.json
"""

__version__ = "1.0.0"

__all__ = [
    "registry_generator",
    "workflow_compiler",
    "validator",
    "documentation_generator"
]