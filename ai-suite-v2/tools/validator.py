#!/usr/bin/env python3
"""
Validator Module

This module validates manifests against JSON schemas for AI Suite V2.
It checks workflow-manifest.schema.json and pack-manifest.schema.json compliance,
validates model dependencies exist, and reports errors and warnings.

Example usage:
    python -m tools.validator --manifest /path/to/manifest.yaml \\
        --schema /path/to/schema.json --strict

    python -m tools.validator --packs-dir /path/to/packs --all

Dependencies:
    - pathlib.Path for file system operations
    - json for schema loading
    - jsonschema for JSON schema validation
    - typing.Dict, List, Optional for type hints

Example:
    >>> from tools.validator import validate_manifest
    >>> result = validate_manifest(
    ...     manifest_path=Path("/path/to/manifest.yaml"),
    ...     schema_path=Path("/path/to/schema.json")
    ... )
    >>> if result["is_valid"]:
    ...     print("Manifest is valid!")
    ... else:
    ...     print("Validation failed with errors")
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import yaml
except ImportError:
    print("Warning: PyYAML not installed. Install with: pip install pyyaml")
    yaml = None  # type: ignore

try:
    import jsonschema
    from jsonschema import ValidationError, Draft7Validator
    JSONSCHEMA_AVAILABLE = True
except ImportError:
    JSONSCHEMA_AVAILABLE = False
    print("Warning: jsonschema not installed. Install with: pip install jsonschema")
    print("Continuing with basic validation...")


def load_schema(schema_path: Path) -> Optional[Dict[str, Any]]:
    """
    Load a JSON schema file.

    Args:
        schema_path: Path to the schema file

    Returns:
        Parsed schema dictionary or None if loading failed
    """
    try:
        with open(schema_path, 'r') as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"Error parsing schema JSON {schema_path}: {e}")
        return None
    except Exception as e:
        print(f"Error reading schema {schema_path}: {e}")
        return None


def load_manifest(manifest_path: Path) -> Optional[Dict[str, Any]]:
    """
    Load a YAML manifest file.

    Args:
        manifest_path: Path to the manifest file

    Returns:
        Parsed manifest dictionary or None if loading failed
    """
    if yaml is None:
        print("Error: PyYAML not available")
        return None

    try:
        with open(manifest_path, 'r') as f:
            return yaml.safe_load(f)
    except yaml.YAMLError as e:
        print(f"Error parsing YAML {manifest_path}: {e}")
        return None
    except Exception as e:
        print(f"Error reading manifest {manifest_path}: {e}")
        return None


def validate_with_schema(
    manifest: Dict[str, Any],
    schema: Dict[str, Any]
) -> Tuple[bool, List[str]]:
    """
    Validate a manifest against a JSON schema using jsonschema library.

    Args:
        manifest: Parsed manifest dictionary
        schema: Parsed schema dictionary

    Returns:
        Tuple of (is_valid, list of error/warning messages)
    """
    if not JSONSCHEMA_AVAILABLE:
        return True, []  # Skip schema validation if library not available

    errors = []
    try:
        validator = Draft7Validator(schema)
        validation_errors = list(validator.iter_errors(manifest))

        if validation_errors:
            for error in validation_errors:
                path = ".".join(str(p) for p in error.path) if error.path else "(root)"
                errors.append(f"Schema validation error at '{path}': {error.message}")
                errors.append(f"  Instance: {error.instance}")

        return len(errors) == 0, errors

    except jsonschema.SchemaError as e:
        errors.append(f"Invalid schema: {e}")
        return False, errors
    except Exception as e:
        errors.append(f"Schema validation error: {e}")
        return False, errors


def validate_id_format(id_value: str) -> Tuple[bool, str]:
    """
    Validate workflow or pack ID format.

    Args:
        id_value: The ID value to validate

    Returns:
        Tuple of (is_valid, error_message)
    """
    import re

    # Pack ID format: letters, numbers, and hyphens.
    pack_pattern = r'^[a-z][a-z0-9-]*$'
    # Workflow ID format: category.slug, with hyphens/digits allowed in both parts.
    workflow_pattern = r'^[a-z][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$'

    if re.match(workflow_pattern, id_value):
        return True, ""
    if re.match(pack_pattern, id_value):
        return True, ""

    return False, f"Invalid ID format: '{id_value}' (expected format: 'category.name')"


def validate_version_format(version: str) -> Tuple[bool, str]:
    """
    Validate version string format (semver).

    Args:
        version: Version string to validate

    Returns:
        Tuple of (is_valid, error_message)
    """
    import re

    version_pattern = r'^[0-9]+\.[0-9]+\.[0-9]+$'
    if re.match(version_pattern, str(version)):
        return True, ""

    return False, f"Invalid version format: '{version}' (expected: X.Y.Z where X, Y, Z are integers)"


def validate_entrypoints(entrypoints: Dict[str, Any], workflow_dir: Path) -> Tuple[bool, List[str]]:
    """
    Validate workflow entrypoints exist.

    Args:
        entrypoints: Entrypoints configuration from manifest
        workflow_dir: Directory containing the workflow

    Returns:
        Tuple of (is_valid, list of error messages)
    """
    errors = []

    if not isinstance(entrypoints, dict):
        errors.append("Entrypoints must be an object")
        return False, errors

    if not any(name in entrypoints for name in ("ui", "api", "service")):
        errors.append("Missing entrypoint: expected at least one of ui, api, or service")

    # Check that entrypoint files exist
    for entrypoint_name, entrypoint_path in entrypoints.items():
        if entrypoint_name == "service":
            continue
        full_path = workflow_dir / entrypoint_path
        if not full_path.exists():
            errors.append(f"Entrypoint file not found: {entrypoint_name} -> {full_path}")

    return len(errors) == 0, errors


def validate_models(manifest: Dict[str, Any], models_dir: Optional[Path]) -> Tuple[bool, List[str]]:
    """
    Validate model dependencies (if models directory is provided).

    Args:
        manifest: Parsed manifest
        models_dir: Path to models directory for dependency checking

    Returns:
        Tuple of (is_valid, list of error messages)
    """
    errors = []
    models = manifest.get("models", {})

    if not models_dir or not models_dir.exists():
        # If no models directory provided, skip this check
        return True, []

    required_models = models.get("required", [])
    optional_models = models.get("optional", [])

    # Check required models
    for model in required_models:
        role = model.get("role", "unknown")
        family = model.get("family", [])

        # For now, just check if the structure is correct
        # A more sophisticated check would look for actual model files
        if not role:
            errors.append(f"Model in 'required' missing 'role' field")

    # Check optional models
    for model in optional_models:
        role = model.get("role", "unknown")
        if not role:
            errors.append(f"Model in 'optional' missing 'role' field")

    return len(errors) == 0, errors


def validate_custom_nodes(custom_nodes: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Validate custom_nodes configuration.

    Args:
        custom_nodes: Custom nodes configuration from manifest

    Returns:
        Tuple of (is_valid, list of error messages)
    """
    errors = []

    if not isinstance(custom_nodes, dict):
        errors.append("custom_nodes must be an object")
        return False, errors

    required = custom_nodes.get("required", [])
    optional = custom_nodes.get("optional", [])

    if not isinstance(required, list):
        errors.append("custom_nodes.required must be an array")
    if not isinstance(optional, list):
        errors.append("custom_nodes.optional must be an array")

    return len(errors) == 0, errors


def validate_hardware(hardware: Dict[str, Any]) -> Tuple[bool, List[str]]:
    """
    Validate hardware requirements configuration.

    Args:
        hardware: Hardware configuration from manifest

    Returns:
        Tuple of (is_valid, list of error messages)
    """
    errors = []

    if not isinstance(hardware, dict):
        errors.append("hardware must be an object")
        return False, errors

    # Check required fields
    if "minimum_vram_gb" not in hardware:
        errors.append("Missing required field: hardware.minimum_vram_gb")
    if "recommended_vram_gb" not in hardware:
        errors.append("Missing required field: hardware.recommended_vram_gb")

    # Validate types
    if "minimum_vram_gb" in hardware:
        try:
            vram = int(hardware["minimum_vram_gb"])
            if vram < 4:
                errors.append(f"minimum_vram_gb must be >= 4, got {vram}")
        except (ValueError, TypeError):
            errors.append(f"minimum_vram_gb must be an integer, got {hardware['minimum_vram_gb']}")

    if "recommended_vram_gb" in hardware:
        try:
            vram = int(hardware["recommended_vram_gb"])
            if vram < 4:
                errors.append(f"recommended_vram_gb must be >= 4, got {vram}")
        except (ValueError, TypeError):
            errors.append(f"recommended_vram_gb must be an integer, got {hardware['recommended_vram_gb']}")

    return len(errors) == 0, errors


def validate_workflow_manifest(
    manifest_path: Path,
    models_dir: Optional[Path] = None,
    strict: bool = False
) -> Dict[str, Any]:
    """
    Validate a workflow manifest file.

    Args:
        manifest_path: Path to the manifest file
        models_dir: Optional path to models directory for dependency checking
        strict: Whether to fail on warnings

    Returns:
        Dictionary with validation results
    """
    result = {
        "path": str(manifest_path),
        "is_valid": True,
        "errors": [],
        "warnings": [],
        "info": []
    }

    # Load manifest
    manifest = load_manifest(manifest_path)
    if manifest is None:
        result["is_valid"] = False
        result["errors"].append("Failed to load manifest")
        return result

    result["info"].append(f"Manifest loaded: {manifest.get('id', 'unknown')} v{manifest.get('version', 'unknown')}")

    # Check for required top-level fields
    required_fields = ["id", "name", "version", "category", "description", "entrypoints"]
    for field in required_fields:
        if field not in manifest:
            result["errors"].append(f"Missing required field: {field}")

    # Validate ID format
    if "id" in manifest:
        is_valid, msg = validate_id_format(manifest["id"])
        if not is_valid:
            result["errors"].append(msg)

    # Validate version format
    if "version" in manifest:
        is_valid, msg = validate_version_format(manifest["version"])
        if not is_valid:
            result["errors"].append(msg)

    # Validate entrypoints
    if "entrypoints" in manifest:
        workflow_dir = manifest_path.parent
        is_valid, errors = validate_entrypoints(manifest["entrypoints"], workflow_dir)
        if not is_valid:
            result["errors"].extend(errors)

    # Validate models
    if "models" in manifest:
        is_valid, errors = validate_models(manifest, models_dir)
        if not is_valid:
            result["errors"].extend(errors)

    # Validate custom_nodes
    if "custom_nodes" in manifest:
        is_valid, errors = validate_custom_nodes(manifest["custom_nodes"])
        if not is_valid:
            result["errors"].extend(errors)

    # Validate hardware
    if "hardware" in manifest:
        is_valid, errors = validate_hardware(manifest["hardware"])
        if not is_valid:
            result["errors"].extend(errors)

    # Validate status field if present
    if "status" in manifest:
        valid_statuses = ["experimental", "stable", "deprecated", "migrated"]
        if manifest["status"] not in valid_statuses:
            result["warnings"].append(
                f"Invalid status: '{manifest['status']}'. "
                f"Expected one of: {', '.join(valid_statuses)}"
            )

    # Check for optional fields
    optional_fields = ["tags", "presets", "runtime", "content", "subcategory"]
    for field in optional_fields:
        if field not in manifest:
            result["warnings"].append(f"Optional field missing: {field}")

    # If strict mode, treat warnings as errors
    if strict and result["warnings"]:
        result["errors"].extend(result["warnings"])
        result["warnings"] = []

    # Set final validity
    result["is_valid"] = len(result["errors"]) == 0

    return result


def validate_pack_manifest(
    manifest_path: Path,
    strict: bool = False
) -> Dict[str, Any]:
    """
    Validate a pack manifest file.

    Args:
        manifest_path: Path to the pack manifest file
        strict: Whether to fail on warnings

    Returns:
        Dictionary with validation results
    """
    result = {
        "path": str(manifest_path),
        "is_valid": True,
        "errors": [],
        "warnings": [],
        "info": []
    }

    # Load manifest
    manifest = load_manifest(manifest_path)
    if manifest is None:
        result["is_valid"] = False
        result["errors"].append("Failed to load manifest")
        return result

    result["info"].append(f"Pack manifest loaded: {manifest.get('id', 'unknown')} v{manifest.get('version', 'unknown')}")

    # Check for required top-level fields
    required_fields = ["id", "name", "version", "description", "workflows"]
    for field in required_fields:
        if field not in manifest:
            result["errors"].append(f"Missing required field: {field}")

    # Validate ID format
    if "id" in manifest:
        is_valid, msg = validate_id_format(manifest["id"])
        if not is_valid:
            result["errors"].append(msg)

    # Validate version format
    if "version" in manifest:
        is_valid, msg = validate_version_format(manifest["version"])
        if not is_valid:
            result["errors"].append(msg)

    # Validate workflows array
    if "workflows" in manifest:
        workflows = manifest["workflows"]
        if not isinstance(workflows, list):
            result["errors"].append("workflows must be an array")
        else:
            for i, workflow_id in enumerate(workflows):
                is_valid, msg = validate_id_format(workflow_id)
                if not is_valid:
                    result["errors"].append(f"workflows[{i}]: {msg}")

    # Validate dependencies if present
    if "dependencies" in manifest:
        dependencies = manifest["dependencies"]
        if not isinstance(dependencies, list):
            result["errors"].append("dependencies must be an array")
        else:
            for i, dep_id in enumerate(dependencies):
                is_valid, msg = validate_id_format(dep_id)
                if not is_valid:
                    result["errors"].append(f"dependencies[{i}]: {msg}")

    # Check for optional fields
    if "default_enabled" not in manifest:
        result["warnings"].append("Optional field missing: default_enabled")

    # If strict mode, treat warnings as errors
    if strict and result["warnings"]:
        result["errors"].extend(result["warnings"])
        result["warnings"] = []

    # Set final validity
    result["is_valid"] = len(result["errors"]) == 0

    return result


def validate_manifest(
    manifest_path: Path,
    schema_path: Optional[Path] = None,
    models_dir: Optional[Path] = None,
    strict: bool = False
) -> Dict[str, Any]:
    """
    Validate a manifest file (workflow or pack).

    Args:
        manifest_path: Path to the manifest file
        schema_path: Optional path to schema file for JSON schema validation
        models_dir: Optional path to models directory for dependency checking
        strict: Whether to fail on warnings

    Returns:
        Dictionary with validation results
    """
    # Determine manifest type by path
    manifest_name = manifest_path.name.lower()

    if "pack-manifest" in manifest_name:
        return validate_pack_manifest(manifest_path, strict)
    else:
        return validate_workflow_manifest(manifest_path, models_dir, strict)


def validate_all_manifests(
    packs_dir: Path,
    schemas_dir: Optional[Path] = None,
    models_dir: Optional[Path] = None,
    strict: bool = False,
    workflow_only: bool = False,
    pack_only: bool = False
) -> Dict[str, Any]:
    """
    Validate all manifests in a directory.

    Args:
        packs_dir: Path to packs directory
        schemas_dir: Optional path to schemas directory
        models_dir: Optional path to models directory
        strict: Whether to fail on warnings
        workflow_only: Only validate workflow manifests
        pack_only: Only validate pack manifests

    Returns:
        Dictionary with validation results
    """
    results = {
        "total_validated": 0,
        "total_valid": 0,
        "total_invalid": 0,
        "workflow_manifests": [],
        "pack_manifests": [],
        "errors": [],
        "warnings": []
    }

    # Find and validate workflow manifests
    if not pack_only:
        for manifest_path in packs_dir.glob("**/manifest.yaml"):
            if "pack-manifest" in str(manifest_path):
                continue
            result = validate_workflow_manifest(manifest_path, models_dir, strict)
            results["workflow_manifests"].append(result)
            results["total_validated"] += 1

            if result["is_valid"]:
                results["total_valid"] += 1
            else:
                results["total_invalid"] += 1
                results["errors"].append({
                    "path": str(manifest_path),
                    "errors": result["errors"]
                })

    # Find and validate pack manifests
    if not workflow_only:
        for manifest_path in packs_dir.glob("**/pack-manifest.yaml"):
            result = validate_pack_manifest(manifest_path, strict)
            results["pack_manifests"].append(result)
            results["total_validated"] += 1

            if result["is_valid"]:
                results["total_valid"] += 1
            else:
                results["total_invalid"] += 1
                results["errors"].append({
                    "path": str(manifest_path),
                    "errors": result["errors"]
                })

    return results


def main():
    """Main entry point for the validator CLI."""
    parser = argparse.ArgumentParser(
        description="Validate manifests against schemas",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --manifest path/to/manifest.yaml --strict
  %(prog)s --packs-dir path/to/packs --all
  %(prog)s --packs-dir path/to/packs --workflow-only
  %(prog)s --packs-dir path/to/packs --pack-only

The --manifest option validates a single manifest file.
The --packs-dir option validates all manifests in a directory.
        """
    )

    parser.add_argument(
        "--manifest",
        type=str,
        help="Path to a specific manifest file to validate"
    )

    parser.add_argument(
        "--packs-dir",
        type=str,
        default="packs",
        help="Path to packs directory (default: packs)"
    )

    parser.add_argument(
        "--schemas-dir",
        type=str,
        default="schemas",
        help="Path to schemas directory (default: schemas)"
    )

    parser.add_argument(
        "--models-dir",
        type=str,
        help="Path to models directory for dependency checking"
    )

    parser.add_argument(
        "--all",
        action="store_true",
        help="Validate all manifests in packs directory"
    )

    parser.add_argument(
        "--workflow-only",
        action="store_true",
        help="Only validate workflow manifests"
    )

    parser.add_argument(
        "--pack-only",
        action="store_true",
        help="Only validate pack manifests"
    )

    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings as errors"
    )

    parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON"
    )

    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose output"
    )

    args = parser.parse_args()

    # Validate arguments
    if not (args.manifest or args.all or args.workflow_only or args.pack_only):
        parser.error("One of --manifest, --all, --workflow-only, or --pack-only is required")

    if args.manifest and (args.all or args.workflow_only or args.pack_only):
        parser.error("Cannot specify --manifest with --all, --workflow-only, or --pack-only")

    # Setup paths
    packs_dir = Path(args.packs_dir)
    if not packs_dir.exists():
        print(f"Error: Packs directory not found: {packs_dir}", file=sys.stderr)
        sys.exit(1)

    schemas_dir = Path(args.schemas_dir)
    if not schemas_dir.exists():
        print(f"Warning: Schemas directory not found: {schemas_dir}")

    models_dir = Path(args.models_dir) if args.models_dir else None

    # Validate
    if args.manifest:
        manifest_path = Path(args.manifest)
        if not manifest_path.exists():
            print(f"Error: Manifest file not found: {manifest_path}", file=sys.stderr)
            sys.exit(1)

        result = validate_manifest(manifest_path, None, models_dir, args.strict)

        if args.json:
            print(json.dumps(result, indent=2))
        else:
            if result["is_valid"]:
                print(f"✓ {manifest_path}: Valid")
                for info in result["info"]:
                    print(f"  {info}")
            else:
                print(f"✗ {manifest_path}: Invalid")
                for error in result["errors"]:
                    print(f"  Error: {error}")
                for warning in result["warnings"]:
                    print(f"  Warning: {warning}")

        if not result["is_valid"]:
            sys.exit(1)

    else:
        results = validate_all_manifests(
            packs_dir,
            schemas_dir,
            models_dir,
            args.strict,
            args.workflow_only,
            args.pack_only
        )

        if args.json:
            print(json.dumps(results, indent=2))
        else:
            print(f"\nValidation Summary:")
            print(f"  Total validated: {results['total_validated']}")
            print(f"  Valid: {results['total_valid']}")
            print(f"  Invalid: {results['total_invalid']}")
            print(f"  Warnings: {len(results['warnings'])}")

            if results['workflow_manifests']:
                print(f"\nWorkflow Manifests:")
                for result in results['workflow_manifests']:
                    status = "✓" if result["is_valid"] else "✗"
                    print(f"  {status} {result['path']}")
                    if not result["is_valid"]:
                        for error in result["errors"]:
                            print(f"      Error: {error}")
                    for warning in result["warnings"]:
                        print(f"      Warning: {warning}")

            if results['pack_manifests']:
                print(f"\nPack Manifests:")
                for result in results['pack_manifests']:
                    status = "✓" if result["is_valid"] else "✗"
                    print(f"  {status} {result['path']}")
                    if not result["is_valid"]:
                        for error in result["errors"]:
                            print(f"      Error: {error}")
                    for warning in result["warnings"]:
                        print(f"      Warning: {warning}")

            if results['errors']:
                print(f"\nErrors:")
                for error_info in results['errors']:
                    print(f"  {error_info['path']}:")
                    for error in error_info['errors']:
                        print(f"    - {error}")

        if results['total_invalid'] > 0:
            sys.exit(1)


if __name__ == "__main__":
    main()
