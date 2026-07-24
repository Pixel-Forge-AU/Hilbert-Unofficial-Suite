#!/usr/bin/env python3
"""
Registry Generator Module

This module generates a comprehensive registry JSON file from pack manifests
in the AI Suite V2 repository. It scans the packs directory, extracts workflow
definitions, and creates a structured registry for workflow discovery and
distribution.

Example usage:
    python -m tools.registry_generator --packs-dir /path/to/packs \\
        --output /path/to/registry.json --category character

    python -m tools.registry_generator --packs-dir /path/to/packs \\
        --output /path/to/registry.json --filter-by "core-generation,character"

Attributes:
    registry_path (str): Default path for the generated registry file
    category_filter (List[str], optional): List of categories to include

Dependencies:
    - pathlib.Path for file system operations
    - json for JSON serialization
    - typing.Dict, List, Optional for type hints
    - yaml (PyYAML) for YAML parsing

Example:
    >>> from tools.registry_generator import generate_registry
    >>> registry = generate_registry("/path/to/packs", ["character"])
    >>> print(f"Generated registry with {len(registry['workflows'])} workflows")
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
    print("Attempting to continue without YAML support...")
    yaml = None  # type: ignore


def find_pack_manifests(packs_dir: Path) -> List[Path]:
    """
    Find all pack-manifest.yaml files in the packs directory.

    Args:
        packs_dir: Path to the packs directory

    Returns:
        List of paths to pack manifest files
    """
    return list(packs_dir.glob("**/pack-manifest.yaml"))


def find_workflow_manifests(packs_dir: Path) -> List[Path]:
    """
    Find all workflow manifest files in the packs directory.

    Args:
        packs_dir: Path to the packs directory

    Returns:
        List of paths to workflow manifest files (manifest.yaml in subdirectories)
    """
    manifests = []
    for manifest_path in packs_dir.glob("**/manifest.yaml"):
        # Skip pack manifests (which are directly in category directories)
        if manifest_path.parent.name == "pack-manifest.yaml":
            continue
        # Check if this is a workflow manifest (not a pack manifest)
        try:
            with open(manifest_path, 'r') as f:
                content = yaml.safe_load(f) if yaml else None
                if content and 'id' in content and '.' in content.get('id', ''):
                    # Workflow manifests have IDs like 'character.character-sheet'
                    # Pack manifests have IDs like 'character'
                    manifests.append(manifest_path)
        except Exception:
            continue
    return manifests


def load_yaml_file(file_path: Path) -> Optional[Dict[str, Any]]:
    """
    Load and parse a YAML file.

    Args:
        file_path: Path to the YAML file

    Returns:
        Parsed YAML content as dictionary, or None if parsing failed
    """
    if yaml is None:
        print(f"Error: PyYAML not available, cannot read {file_path}")
        return None

    try:
        with open(file_path, 'r') as f:
            return yaml.safe_load(f)
    except yaml.YAMLError as e:
        print(f"Error parsing YAML file {file_path}: {e}")
        return None
    except Exception as e:
        print(f"Error reading file {file_path}: {e}")
        return None


def extract_workflow_info(workflow_path: Path, packs_dir: Path) -> Optional[Dict[str, Any]]:
    """
    Extract workflow information from a manifest file.

    Args:
        workflow_path: Path to the workflow manifest
        packs_dir: Base packs directory path

    Returns:
        Dictionary containing extracted workflow information
    """
    manifest = load_yaml_file(workflow_path)
    if manifest is None:
        return None

    # Calculate relative path from packs directory
    try:
        relative_path = workflow_path.relative_to(packs_dir)
    except ValueError:
        relative_path = workflow_path

    workflow_info = {
        "id": manifest.get("id", ""),
        "name": manifest.get("name", ""),
        "version": manifest.get("version", "0.0.0"),
        "category": manifest.get("category", ""),
        "subcategory": manifest.get("subcategory", ""),
        "description": manifest.get("description", ""),
        "status": manifest.get("status", "stable"),
        "entrypoints": manifest.get("entrypoints", {}),
        "inputs": manifest.get("inputs", []),
        "outputs": manifest.get("outputs", []),
        "models": manifest.get("models", {}),
        "custom_nodes": manifest.get("custom_nodes", {}),
        "hardware": manifest.get("hardware", {}),
        "runtime": manifest.get("runtime", {}),
        "content": manifest.get("content", {}),
        "tags": manifest.get("tags", []),
        "presets": manifest.get("presets", []),
        "relative_path": str(relative_path),
        "manifest_path": str(workflow_path)
    }

    return workflow_info


def extract_pack_info(pack_path: Path, packs_dir: Path) -> Optional[Dict[str, Any]]:
    """
    Extract pack information from a pack manifest file.

    Args:
        pack_path: Path to the pack manifest
        packs_dir: Base packs directory path

    Returns:
        Dictionary containing extracted pack information
    """
    manifest = load_yaml_file(pack_path)
    if manifest is None:
        return None

    # Calculate relative path from packs directory
    try:
        relative_path = pack_path.relative_to(packs_dir)
    except ValueError:
        relative_path = pack_path

    pack_info = {
        "id": manifest.get("id", ""),
        "name": manifest.get("name", ""),
        "version": manifest.get("version", "0.0.0"),
        "description": manifest.get("description", ""),
        "workflows": manifest.get("workflows", []),
        "default_enabled": manifest.get("default_enabled", True),
        "dependencies": manifest.get("dependencies", []),
        "relative_path": str(relative_path),
        "manifest_path": str(pack_path)
    }

    return pack_info


def generate_registry(
    packs_dir: Path,
    categories: Optional[List[str]] = None,
    output_path: Optional[Path] = None
) -> Dict[str, Any]:
    """
    Generate a comprehensive registry from pack manifests.

    Args:
        packs_dir: Path to the packs directory
        categories: Optional list of categories to include
        output_path: Optional path to write registry JSON

    Returns:
        Dictionary containing the generated registry
    """
    registry = {
        "version": "1.0.0",
        "generated_at": "",
        "total_packs": 0,
        "total_workflows": 0,
        "categories": [],
        "packs": [],
        "workflows": []
    }

    import datetime
    registry["generated_at"] = datetime.datetime.utcnow().isoformat() + "Z"

    # Find all pack manifests
    pack_manifests = find_pack_manifests(packs_dir)
    pack_info_list = []

    for pack_path in pack_manifests:
        pack_info = extract_pack_info(pack_path, packs_dir)
        if pack_info:
            # Filter by category if specified
            if categories is None or pack_info["id"] in categories:
                pack_info_list.append(pack_info)
                # Find workflows in this pack
                pack_dir = pack_path.parent
                for manifest_path in pack_dir.glob("*/manifest.yaml"):
                    if manifest_path.parent.name != "pack-manifest.yaml":
                        workflow_info = extract_workflow_info(manifest_path, packs_dir)
                        if workflow_info:
                            registry["workflows"].append(workflow_info)

    registry["packs"] = pack_info_list
    registry["total_packs"] = len(pack_info_list)
    registry["total_workflows"] = len(registry["workflows"])

    # Extract unique categories
    category_set = set()
    for pack in pack_info_list:
        category_set.add(pack["id"])
    registry["categories"] = sorted(list(category_set))

    # Write output if specified
    if output_path:
        try:
            output_path.parent.mkdir(parents=True, exist_ok=True)
            with open(output_path, 'w') as f:
                json.dump(registry, f, indent=2)
            print(f"Registry written to: {output_path}")
        except Exception as e:
            print(f"Error writing registry to {output_path}: {e}")

    return registry


def main():
    """Main entry point for the registry generator CLI."""
    parser = argparse.ArgumentParser(
        description="Generate registry JSON from pack manifests",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --packs-dir /path/to/packs --output registry.json
  %(prog)s --packs-dir /path/to/packs --output registry.json --category character
  %(prog)s --packs-dir /path/to/packs --output registry.json --filter-by "core-generation,character"

Categories can be specified using --category or --filter-by options.
Multiple categories can be specified with comma-separated values.
        """
    )

    parser.add_argument(
        "--packs-dir",
        type=str,
        default="packs",
        help="Path to the packs directory (default: packs)"
    )

    parser.add_argument(
        "--output",
        type=str,
        default="registry.json",
        help="Output path for registry JSON (default: registry.json)"
    )

    parser.add_argument(
        "--category",
        type=str,
        action="append",
        help="Category to include in registry (can be specified multiple times)"
    )

    parser.add_argument(
        "--filter-by",
        type=str,
        help="Comma-separated list of categories to include"
    )

    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose output"
    )

    args = parser.parse_args()

    # Parse categories from arguments
    categories: Optional[List[str]] = None
    if args.filter_by:
        categories = [c.strip() for c in args.filter_by.split(",")]
    if args.category:
        if categories is None:
            categories = []
        categories.extend([c.strip() for c in args.category])

    # Validate packs directory
    packs_dir = Path(args.packs_dir)
    if not packs_dir.exists():
        print(f"Error: Packs directory not found: {packs_dir}", file=sys.stderr)
        sys.exit(1)

    if not packs_dir.is_dir():
        print(f"Error: Packs path is not a directory: {packs_dir}", file=sys.stderr)
        sys.exit(1)

    # Validate output path
    output_path = Path(args.output)
    if output_path.is_dir():
        print(f"Error: Output path is a directory, not a file: {output_path}", file=sys.stderr)
        sys.exit(1)

    # Generate registry
    if args.verbose:
        print(f"Scanning packs directory: {packs_dir}")
        if categories:
            print(f"Filtering categories: {', '.join(categories)}")

    try:
        registry = generate_registry(packs_dir, categories, output_path)

        if args.verbose:
            print(f"Generated registry:")
            print(f"  Total packs: {registry['total_packs']}")
            print(f"  Total workflows: {registry['total_workflows']}")
            print(f"  Categories: {', '.join(registry['categories'])}")

    except Exception as e:
        print(f"Error generating registry: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()