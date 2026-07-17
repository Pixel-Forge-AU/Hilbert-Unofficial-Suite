#!/usr/bin/env python3
"""
Workflow Compiler Module

This module compiles workflow packs for distribution by validating manifests,
packaging workflows with dependencies, creating installable .aiworkflow files,
and generating checksums for validation.

Example usage:
    python -m tools.workflow_compiler --packs-dir /path/to/packs \\
        --output-dir /path/to/output --format all

    python -m tools.workflow_compiler --workflow character.character-sheet \\
        --output-dir /path/to/output

Dependencies:
    - pathlib.Path for file system operations
    - hashlib for checksum generation
    - zipfile for creating archives
    - json for manifest serialization
    - typing.Dict, List, Optional for type hints

Example:
    >>> from tools.workflow_compiler import compile_workflow_pack
    >>> result = compile_workflow_pack(
    ...     workflow_id="character.character-sheet",
    ...     packs_dir=Path("/path/to/packs"),
    ...     output_dir=Path("/path/to/output")
    ... )
    >>> print(f"Compiled workflow: {result['workflow_id']}")
"""

import argparse
import hashlib
import json
import sys
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import yaml
except ImportError:
    print("Warning: PyYAML not installed. Install with: pip install pyyaml")
    yaml = None  # type: ignore


def calculate_file_checksum(file_path: Path, algorithm: str = "sha256") -> str:
    """
    Calculate the checksum of a file.

    Args:
        file_path: Path to the file
        algorithm: Hash algorithm to use (sha256, sha512, md5)

    Returns:
        Hexadecimal checksum string
    """
    hash_func = hashlib.new(algorithm)
    try:
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                hash_func.update(chunk)
        return hash_func.hexdigest()
    except Exception as e:
        print(f"Error calculating checksum for {file_path}: {e}")
        return ""


def validate_workflow_manifest(manifest_path: Path) -> Tuple[bool, List[str]]:
    """
    Validate a workflow manifest file.

    Args:
        manifest_path: Path to the workflow manifest

    Returns:
        Tuple of (is_valid, list of error/warning messages)
    """
    errors = []
    warnings = []

    if yaml is None:
        errors.append("PyYAML not available for manifest parsing")
        return False, errors

    try:
        with open(manifest_path, 'r') as f:
            manifest = yaml.safe_load(f)
    except yaml.YAMLError as e:
        errors.append(f"YAML parsing error in {manifest_path}: {e}")
        return False, errors
    except Exception as e:
        errors.append(f"Error reading manifest {manifest_path}: {e}")
        return False, errors

    # Required fields validation
    required_fields = ["id", "name", "version", "category", "description", "entrypoints"]
    for field in required_fields:
        if field not in manifest:
            errors.append(f"Missing required field: {field}")

    # Validate ID format
    if "id" in manifest:
        import re
        id_pattern = r'^[a-z]+\.[a-z-]+$'
        if not re.match(id_pattern, str(manifest.get("id", ""))):
            errors.append(f"Invalid workflow ID format: {manifest.get('id')}")

    # Validate version format
    if "version" in manifest:
        import re
        version_pattern = r'^[0-9]+\.[0-9]+\.[0-9]+$'
        if not re.match(version_pattern, str(manifest.get("version", ""))):
            errors.append(f"Invalid version format: {manifest.get('version')}")

    # Validate entrypoints
    if "entrypoints" in manifest:
        entrypoints = manifest.get("entrypoints", {})
        if "ui" not in entrypoints:
            errors.append("Missing required entrypoint: ui")
        if "api" not in entrypoints:
            errors.append("Missing required entrypoint: api")

    # Validate hardware requirements
    if "hardware" in manifest:
        hardware = manifest.get("hardware", {})
        if "minimum_vram_gb" not in hardware:
            errors.append("Missing required hardware field: minimum_vram_gb")
        if "recommended_vram_gb" not in hardware:
            errors.append("Missing required hardware field: recommended_vram_gb")

    # Check for optional fields and generate warnings
    optional_fields = ["tags", "presets", "runtime", "content"]
    for field in optional_fields:
        if field not in manifest:
            warnings.append(f"Optional field missing: {field}")

    is_valid = len(errors) == 0
    return is_valid, errors + warnings


def package_workflow(
    workflow_id: str,
    packs_dir: Path,
    output_dir: Path,
    include_dependencies: bool = True,
    include_presets: bool = True
) -> Optional[Dict[str, Any]]:
    """
    Package a workflow into an .aiworkflow archive.

    Args:
        workflow_id: ID of the workflow to package
        packs_dir: Path to the packs directory
        output_dir: Path to output directory
        include_dependencies: Whether to include model dependencies
        include_presets: Whether to include preset files

    Returns:
        Dictionary with packaging results or None if failed
    """
    # Find the workflow manifest
    workflow_path = None
    for manifest_path in packs_dir.glob("**/manifest.yaml"):
        if yaml is None:
            continue
        try:
            with open(manifest_path, 'r') as f:
                manifest = yaml.safe_load(f)
            if manifest and manifest.get("id") == workflow_id:
                workflow_path = manifest_path
                break
        except Exception:
            continue

    if workflow_path is None:
        print(f"Error: Workflow not found: {workflow_id}")
        return None

    # Validate the manifest
    is_valid, messages = validate_workflow_manifest(workflow_path)
    if not is_valid:
        print(f"Error: Invalid workflow manifest for {workflow_id}")
        for msg in messages:
            print(f"  {msg}")
        return None

    # Get workflow directory
    workflow_dir = workflow_path.parent

    # Create output structure
    output_subdir = output_dir / "workflows" / workflow_id
    output_subdir.mkdir(parents=True, exist_ok=True)

    # Create archive
    archive_path = output_subdir / f"{workflow_id}.aiworkflow"

    # Collect files to include
    files_to_include = []

    # Always include workflow JSON files
    entrypoints = {
        "ui": workflow_dir / "workflow.json",
        "api": workflow_dir / "workflow-api.json"
    }

    for name, entrypoint in entrypoints.items():
        if entrypoint.exists():
            files_to_include.append((str(entrypoint.relative_to(workflow_dir)), str(entrypoint)))

    # Include preset files if requested
    if include_presets:
        presets_dir = workflow_dir / "presets"
        if presets_dir.exists():
            for preset_file in presets_dir.glob("*.yaml"):
                files_to_include.append((f"presets/{preset_file.name}", str(preset_file)))

    # Include tests if present
    tests_dir = workflow_dir / "tests"
    if tests_dir.exists():
        for test_file in tests_dir.glob("*"):
            files_to_include.append((f"tests/{test_file.name}", str(test_file)))

    # Package workflow
    try:
        with zipfile.ZipFile(archive_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # Add manifest (load as YAML, then save as JSON)
            if yaml is None:
                errors.append("PyYAML required for packaging")
                return None
            with open(workflow_path, 'r') as f:
                manifest_data = json.dumps(yaml.safe_load(f), indent=2)
            zip_file.writestr("manifest.json", manifest_data)

            # Add workflow files
            for archive_name, real_path in files_to_include:
                zip_file.write(real_path, archive_name)

            # Generate checksums
            checksums = {}
            for archive_name, real_path in files_to_include:
                checksums[archive_name] = calculate_file_checksum(Path(real_path))

            zip_file.writestr("checksums.json", json.dumps(checksums, indent=2))

        # Create package info
        package_info = {
            "workflow_id": workflow_id,
            "version": "",
            "packaged_at": datetime.utcnow().isoformat() + "Z",
            "files": [name for name, _ in files_to_include],
            "checksums": checksums,
            "archive_path": str(archive_path),
            "archive_size": archive_path.stat().st_size
        }

        # Read version from manifest
        if yaml:
            with open(workflow_path, 'r') as f:
                manifest = yaml.safe_load(f)
                package_info["version"] = manifest.get("version", "unknown")

        # Save package info
        info_path = output_subdir / "package-info.json"
        with open(info_path, 'w') as f:
            json.dump(package_info, f, indent=2)

        return package_info

    except Exception as e:
        print(f"Error packaging workflow {workflow_id}: {e}")
        return None


def package_pack(
    pack_id: str,
    packs_dir: Path,
    output_dir: Path,
    include_dependencies: bool = True,
    include_presets: bool = True
) -> Optional[Dict[str, Any]]:
    """
    Package an entire pack of workflows.

    Args:
        pack_id: ID of the pack to package
        packs_dir: Path to the packs directory
        output_dir: Path to output directory
        include_dependencies: Whether to include model dependencies
        include_presets: Whether to include preset files

    Returns:
        Dictionary with packaging results or None if failed
    """
    # Find the pack manifest
    pack_manifest_path = packs_dir / pack_id / "pack-manifest.yaml"
    if not pack_manifest_path.exists():
        print(f"Error: Pack not found: {pack_id}")
        return None

    if yaml is None:
        print("Error: PyYAML not available")
        return None

    # Load pack manifest
    try:
        with open(pack_manifest_path, 'r') as f:
            pack_manifest = yaml.safe_load(f)
    except Exception as e:
        print(f"Error reading pack manifest: {e}")
        return None

    # Create pack output structure
    pack_output_dir = output_dir / "packs" / pack_id
    pack_output_dir.mkdir(parents=True, exist_ok=True)

    # Package each workflow in the pack
    workflows = pack_manifest.get("workflows", [])
    workflow_results = []

    for workflow_id in workflows:
        result = package_workflow(
            workflow_id=workflow_id,
            packs_dir=packs_dir,
            output_dir=output_dir,
            include_dependencies=include_dependencies,
            include_presets=include_presets
        )
        if result:
            workflow_results.append(result)

    # Generate pack-level checksums
    all_checksums = {}
    for result in workflow_results:
        all_checksums.update(result.get("checksums", {}))

    # Create pack archive
    pack_archive_path = pack_output_dir / f"{pack_id}.aipack"

    try:
        with zipfile.ZipFile(pack_archive_path, 'w', zipfile.ZIP_DEFLATED) as zip_file:
            # Add pack manifest
            zip_file.write(pack_manifest_path, "pack-manifest.yaml")

            # Add workflow archives
            for result in workflow_results:
                archive_path = result.get("archive_path", "")
                if archive_path and Path(archive_path).exists():
                    relative_path = Path(archive_path).relative_to(output_dir)
                    zip_file.write(archive_path, str(relative_path))

            # Add checksums
            zip_file.writestr("checksums.json", json.dumps(all_checksums, indent=2))

        # Create pack info
        pack_info = {
            "pack_id": pack_id,
            "version": pack_manifest.get("version", "unknown"),
            "name": pack_manifest.get("name", ""),
            "description": pack_manifest.get("description", ""),
            "workflows": workflows,
            "workflow_count": len(workflow_results),
            "packaged_at": datetime.utcnow().isoformat() + "Z",
            "archive_path": str(pack_archive_path),
            "archive_size": pack_archive_path.stat().st_size
        }

        # Save pack info
        info_path = pack_output_dir / "package-info.json"
        with open(info_path, 'w') as f:
            json.dump(pack_info, f, indent=2)

        return pack_info

    except Exception as e:
        print(f"Error packaging pack {pack_id}: {e}")
        return None


def compile_workflow_pack(
    workflow_id: Optional[str] = None,
    pack_id: Optional[str] = None,
    packs_dir: Path = Path("packs"),
    output_dir: Path = Path("dist"),
    include_dependencies: bool = True,
    include_presets: bool = True
) -> Dict[str, Any]:
    """
    Compile a workflow pack for distribution.

    Args:
        workflow_id: ID of specific workflow to compile
        pack_id: ID of pack to compile (includes all workflows)
        packs_dir: Path to packs directory
        output_dir: Path to output directory
        include_dependencies: Whether to include dependencies
        include_presets: Whether to include presets

    Returns:
        Dictionary with compilation results
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    results = {
        "success": False,
        "workflow_id": workflow_id,
        "pack_id": pack_id,
        "packaged_workflows": [],
        "errors": []
    }

    try:
        if workflow_id:
            result = package_workflow(
                workflow_id=workflow_id,
                packs_dir=packs_dir,
                output_dir=output_dir,
                include_dependencies=include_dependencies,
                include_presets=include_presets
            )
            if result:
                results["success"] = True
                results["packaged_workflows"].append(result)
            else:
                results["errors"].append(f"Failed to package workflow: {workflow_id}")

        elif pack_id:
            result = package_pack(
                pack_id=pack_id,
                packs_dir=packs_dir,
                output_dir=output_dir,
                include_dependencies=include_dependencies,
                include_presets=include_presets
            )
            if result:
                results["success"] = True
                results["packaged_workflows"].append(result)
            else:
                results["errors"].append(f"Failed to package pack: {pack_id}")

        else:
            # Compile all packs
            pack_manifests = list(packs_dir.glob("**/pack-manifest.yaml"))
            for pack_manifest_path in pack_manifests:
                if yaml is None:
                    continue
                try:
                    with open(pack_manifest_path, 'r') as f:
                        manifest = yaml.safe_load(f)
                    if manifest:
                        result = package_pack(
                            pack_id=manifest.get("id", ""),
                            packs_dir=packs_dir,
                            output_dir=output_dir,
                            include_dependencies=include_dependencies,
                            include_presets=include_presets
                        )
                        if result:
                            results["success"] = True
                            results["packaged_workflows"].append(result)
                except Exception as e:
                    results["errors"].append(f"Error processing pack: {e}")

    except Exception as e:
        results["errors"].append(f"Compilation error: {e}")

    return results


def main():
    """Main entry point for the workflow compiler CLI."""
    parser = argparse.ArgumentParser(
        description="Compile workflow packs for distribution",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --workflow character.character-sheet --output-dir dist/
  %(prog)s --pack character --output-dir dist/
  %(prog)s --all --output-dir dist/

The --workflow option packages a single workflow.
The --pack option packages an entire pack of workflows.
The --all option packages all available packs.
        """
    )

    parser.add_argument(
        "--workflow",
        type=str,
        help="Workflow ID to compile (e.g., character.character-sheet)"
    )

    parser.add_argument(
        "--pack",
        type=str,
        help="Pack ID to compile (e.g., character)"
    )

    parser.add_argument(
        "--all",
        action="store_true",
        help="Compile all packs"
    )

    parser.add_argument(
        "--output-dir",
        type=str,
        default="dist",
        help="Output directory for compiled packages (default: dist)"
    )

    parser.add_argument(
        "--packs-dir",
        type=str,
        default="packs",
        help="Path to packs directory (default: packs)"
    )

    parser.add_argument(
        "--include-deps",
        action="store_true",
        help="Include model dependencies in package"
    )

    parser.add_argument(
        "--include-presets",
        action="store_true",
        default=True,
        help="Include preset files (default: True)"
    )

    parser.add_argument(
        "--no-presets",
        action="store_true",
        help="Exclude preset files"
    )

    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose output"
    )

    args = parser.parse_args()

    # Validate arguments
    if not (args.workflow or args.pack or args.all):
        parser.error("One of --workflow, --pack, or --all is required")

    if args.workflow and args.pack:
        parser.error("Cannot specify both --workflow and --pack")

    # Setup paths
    packs_dir = Path(args.packs_dir)
    if not packs_dir.exists():
        print(f"Error: Packs directory not found: {packs_dir}", file=sys.stderr)
        sys.exit(1)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.verbose:
        print(f"Compiling workflows from: {packs_dir}")
        print(f"Output directory: {output_dir}")

    # Compile
    results = compile_workflow_pack(
        workflow_id=args.workflow,
        pack_id=args.pack if not args.all else None,
        packs_dir=packs_dir,
        output_dir=output_dir,
        include_dependencies=args.include_deps,
        include_presets=not args.no_presets
    )

    if args.verbose:
        if results["success"]:
            print(f"\nSuccessfully compiled {len(results['packaged_workflows'])} workflow(s)")
            for workflow in results["packaged_workflows"]:
                print(f"  - {workflow.get('workflow_id', workflow.get('pack_id'))}")
                print(f"    Archive: {workflow.get('archive_path', 'N/A')}")
                print(f"    Size: {workflow.get('archive_size', 0)} bytes")
        else:
            print("\nCompilation failed:")
            for error in results["errors"]:
                print(f"  - {error}")

    if not results["success"]:
        sys.exit(1)


if __name__ == "__main__":
    main()