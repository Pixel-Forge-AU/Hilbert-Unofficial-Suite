#!/usr/bin/env python3
"""
Documentation Generator Module

This module generates comprehensive documentation from workflow and pack manifests
for the AI Suite repository. It creates README.md files, workflow catalogs,
and configuration examples.

Example usage:
    python -m tools.documentation_generator --packs-dir /path/to/packs \\
        --output-dir /path/to/docs --format markdown

    python -m tools.documentation_generator --workflow character.character-sheet \\
        --output-dir /path/to/docs

Dependencies:
    - pathlib.Path for file system operations
    - json for data serialization
    - typing.Dict, List, Optional for type hints
    - datetime for timestamps

Example:
    >>> from tools.documentation_generator import generate_workflow_docs
    >>> docs = generate_workflow_docs(
    ...     workflow_id="character.character-sheet",
    ...     packs_dir=Path("/path/to/packs")
    ... )
    >>> print(docs["readme"])
"""

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import yaml
except ImportError:
    print("Warning: PyYAML not installed. Install with: pip install pyyaml")
    yaml = None  # type: ignore


def load_workflow_manifest(workflow_id: str, packs_dir: Path) -> Optional[Dict[str, Any]]:
    """
    Load a workflow manifest by ID.

    Args:
        workflow_id: ID of the workflow to load
        packs_dir: Path to the packs directory

    Returns:
        Parsed manifest dictionary or None if not found
    """
    if yaml is None:
        print("Error: PyYAML not available")
        return None

    for manifest_path in packs_dir.glob("**/manifest.yaml"):
        try:
            with open(manifest_path, 'r') as f:
                manifest = yaml.safe_load(f)
            if manifest and manifest.get("id") == workflow_id:
                return manifest
        except Exception:
            continue
    return None


def load_pack_manifest(pack_id: str, packs_dir: Path) -> Optional[Dict[str, Any]]:
    """
    Load a pack manifest by ID.

    Args:
        pack_id: ID of the pack to load
        packs_dir: Path to the packs directory

    Returns:
        Parsed manifest dictionary or None if not found
    """
    if yaml is None:
        print("Error: PyYAML not available")
        return None

    pack_manifest_path = packs_dir / pack_id / "pack-manifest.yaml"
    if not pack_manifest_path.exists():
        return None

    try:
        with open(pack_manifest_path, 'r') as f:
            return yaml.safe_load(f)
    except Exception:
        return None


def format_yaml(data: Dict[str, Any], indent: int = 0) -> str:
    """
    Format a dictionary as YAML for documentation.

    Args:
        data: Dictionary to format
        indent: Number of spaces to indent

    Returns:
        Formatted YAML string
    """
    lines = []
    prefix = "  " * indent

    for key, value in data.items():
        if isinstance(value, dict):
            lines.append(f"{prefix}- {key}:")
            lines.append(format_yaml(value, indent + 1))
        elif isinstance(value, list):
            lines.append(f"{prefix}- {key}:")
            if len(value) == 0:
                lines.append(f"{prefix}  []")
            else:
                for item in value:
                    if isinstance(item, dict):
                        lines.append(f"{prefix}  - {key}:")
                        lines.append(format_yaml(item, indent + 2))
                    else:
                        lines.append(f"{prefix}  - {item}")
        else:
            lines.append(f"{prefix}- {key}: {value}")

    return "\n".join(lines)


def generate_workflow_readme(
    workflow_id: str,
    packs_dir: Path,
    output_format: str = "markdown"
) -> Dict[str, Any]:
    """
    Generate documentation for a single workflow.

    Args:
        workflow_id: ID of the workflow
        packs_dir: Path to the packs directory
        output_format: Output format ("markdown", "html", "json")

    Returns:
        Dictionary with generated documentation
    """
    manifest = load_workflow_manifest(workflow_id, packs_dir)
    if manifest is None:
        return {
            "success": False,
            "error": f"Workflow not found: {workflow_id}"
        }

    readme = []

    # Header
    readme.append(f"# {manifest.get('name', workflow_id)}")
    readme.append("")
    readme.append(f"**ID:** `{workflow_id}`")
    readme.append(f"**Version:** {manifest.get('version', 'unknown')}")
    readme.append(f"**Status:** {manifest.get('status', 'stable')}")
    readme.append(f"**Category:** {manifest.get('category', 'unknown')}")
    if "subcategory" in manifest:
        readme.append(f"**Subcategory:** {manifest.get('subcategory')}")
    readme.append("")

    # Description
    readme.append("## Description")
    readme.append("")
    readme.append(manifest.get('description', 'No description available.'))
    readme.append("")

    # Tags
    tags = manifest.get('tags', [])
    if tags:
        readme.append("## Tags")
        readme.append("")
        readme.append(", ".join(f"`{tag}`" for tag in tags))
        readme.append("")

    # Configuration Examples
    readme.append("## Configuration")
    readme.append("")
    readme.append("### Input Parameters")
    readme.append("")
    inputs = manifest.get('inputs', [])
    if inputs:
        readme.append("| Parameter | Type | Required | Default | Description |")
        readme.append("|-----------|------|----------|---------|-------------|")
        for input_param in inputs:
            param_id = input_param.get('id', 'unknown')
            param_type = input_param.get('type', 'unknown')
            required = "✓" if input_param.get('required', True) else "✗"
            default = input_param.get('default', 'N/A')
            desc = input_param.get('description', '')

            # Handle multiline descriptions
            desc = desc.replace('\n', ' ').replace('|', '-')

            readme.append(f"| `{param_id}` | {param_type} | {required} | {default} | {desc} |")

    readme.append("")

    # Outputs
    readme.append("### Outputs")
    readme.append("")
    outputs = manifest.get('outputs', [])
    if outputs:
        readme.append("| Output | Type | Description |")
        readme.append("|--------|------|-------------|")
        for output in outputs:
            out_id = output.get('id', 'unknown')
            out_type = output.get('type', 'unknown')
            desc = output.get('description', '')
            readme.append(f"| `{out_id}` | {out_type} | {desc} |")

    readme.append("")

    # Models
    readme.append("### Models")
    readme.append("")
    models = manifest.get('models', {})
    required_models = models.get('required', [])
    optional_models = models.get('optional', [])

    if required_models:
        readme.append("**Required:**")
        readme.append("")
        for model in required_models:
            role = model.get('role', 'unknown')
            family = model.get('family', [])
            if family:
                readme.append(f"- `{role}`: {', '.join(family)}")
            else:
                readme.append(f"- `{role}`")

    if optional_models:
        readme.append("")
        readme.append("**Optional:**")
        readme.append("")
        for model in optional_models:
            role = model.get('role', 'unknown')
            suggested = model.get('suggested', [])
            if suggested:
                readme.append(f"- `{role}`: {', '.join(suggested)}")
            else:
                readme.append(f"- `{role}`")

    readme.append("")

    # Custom Nodes
    readme.append("### Custom Nodes")
    readme.append("")
    custom_nodes = manifest.get('custom_nodes', {})
    required_nodes = custom_nodes.get('required', [])
    optional_nodes = custom_nodes.get('optional', [])

    if required_nodes:
        readme.append("**Required:**")
        readme.append("")
        for node in required_nodes:
            readme.append(f"- `{node}`")

    if optional_nodes:
        readme.append("")
        readme.append("**Optional:**")
        readme.append("")
        for node in optional_nodes:
            readme.append(f"- `{node}`")

    readme.append("")

    # Hardware Requirements
    readme.append("## Hardware Requirements")
    readme.append("")
    hardware = manifest.get('hardware', {})
    readme.append(f"- **Minimum VRAM:** {hardware.get('minimum_vram_gb', 'N/A')} GB")
    readme.append(f"- **Recommended VRAM:** {hardware.get('recommended_vram_gb', 'N/A')} GB")
    readme.append(f"- **Low VRAM Support:** {'✓' if hardware.get('supports_low_vram', False) else '✗'}")
    readme.append(f"- **CPU Offload Support:** {'✓' if hardware.get('supports_cpu_offload', False) else '✗'}")
    readme.append("")

    # Runtime
    readme.append("## Runtime")
    readme.append("")
    runtime = manifest.get('runtime', {})
    readme.append(f"- **Complexity Class:** {runtime.get('class', 'N/A')}")
    readme.append(f"- **Batch Supported:** {'✓' if runtime.get('batch_supported', False) else '✗'}")
    readme.append("")

    # Content
    readme.append("## Content")
    readme.append("")
    content = manifest.get('content', {})
    themes = content.get('themes', [])
    adult_only = content.get('adult_only', False)

    if themes:
        readme.append(f"**Themes:** {', '.join(themes)}")
        readme.append("")

    readme.append(f"**Adult Content:** {'✓' if adult_only else '✗'}")
    readme.append("")

    # Entrypoints
    readme.append("## Entrypoints")
    readme.append("")
    entrypoints = manifest.get('entrypoints', {})
    readme.append("| Type | Path |")
    readme.append("|------|------|")
    for entry_type, entry_path in entrypoints.items():
        readme.append(f"| {entry_type} | `{entry_path}` |")
    readme.append("")

    # Presets
    readme.append("## Presets")
    readme.append("")
    presets = manifest.get('presets', [])
    if presets:
        readme.append("Available preset files in `presets/` directory:")
        readme.append("")
        for preset in presets:
            readme.append(f"- `{preset}.yaml`")
    else:
        readme.append("No presets available for this workflow.")
    readme.append("")

    # Example Usage
    readme.append("## Example Usage")
    readme.append("")
    readme.append("### API Endpoint")
    readme.append("")
    readme.append("```python")
    readme.append(f"# Workflow: {workflow_id}")
    readme.append("import requests")
    readme.append("")
    readme.append("response = requests.post(")
    readme.append(f"    \"http://localhost:8188/workflows/{workflow_id}\",")
    readme.append("    json={")
    readme.append("        \"inputs\": {")
    readme.append("            # Add your inputs here")
    readme.append("        }")
    readme.append("    }")
    readme.append(")")
    readme.append("```")
    readme.append("")

    # Validation
    readme.append("## Validation")
    readme.append("")
    readme.append("To validate this workflow manifest:")
    readme.append("")
    readme.append("```bash")
    readme.append(f"python -m tools.validator --manifest packs/{manifest.get('category')}/{workflow_id.split('.')[-1]}/manifest.yaml")
    readme.append("```")
    readme.append("")

    # Metadata
    readme.append("## Metadata")
    readme.append("")
    readme.append(f"- **Generated:** {datetime.utcnow().isoformat()}Z")
    readme.append(f"- **Manifest Path:** `packs/{manifest.get('category')}/{workflow_id.split('.')[-1]}/manifest.yaml`")
    readme.append("")

    return {
        "success": True,
        "workflow_id": workflow_id,
        "readme": "\n".join(readme),
        "manifest": manifest
    }


def generate_pack_readme(
    pack_id: str,
    packs_dir: Path,
    output_format: str = "markdown"
) -> Dict[str, Any]:
    """
    Generate documentation for a pack.

    Args:
        pack_id: ID of the pack
        packs_dir: Path to the packs directory
        output_format: Output format

    Returns:
        Dictionary with generated documentation
    """
    manifest = load_pack_manifest(pack_id, packs_dir)
    if manifest is None:
        return {
            "success": False,
            "error": f"Pack not found: {pack_id}"
        }

    readme = []

    # Header
    readme.append(f"# {manifest.get('name', pack_id)} Pack")
    readme.append("")
    readme.append(f"**ID:** `{pack_id}`")
    readme.append(f"**Version:** {manifest.get('version', 'unknown')}")
    readme.append("")
    readme.append("## Description")
    readme.append("")
    readme.append(manifest.get('description', 'No description available.'))
    readme.append("")

    # Workflows
    readme.append("## Workflows")
    readme.append("")
    workflows = manifest.get('workflows', [])
    readme.append(f"This pack contains {len(workflows)} workflow(s):")
    readme.append("")

    for workflow_id in workflows:
        readme.append(f"- `{workflow_id}`")

    readme.append("")

    # Default Enabled
    readme.append("## Configuration")
    readme.append("")
    readme.append(f"**Default Enabled:** {'✓' if manifest.get('default_enabled', True) else '✗'}")
    readme.append("")

    # Dependencies
    dependencies = manifest.get('dependencies', [])
    if dependencies:
        readme.append("### Dependencies")
        readme.append("")
        readme.append("This pack depends on:")
        readme.append("")
        for dep in dependencies:
            readme.append(f"- `{dep}`")
        readme.append("")

    # Validation
    readme.append("## Validation")
    readme.append("")
    readme.append("To validate this pack manifest:")
    readme.append("")
    readme.append("```bash")
    readme.append(f"python -m tools.validator --manifest packs/{pack_id}/pack-manifest.yaml")
    readme.append("```")
    readme.append("")

    return {
        "success": True,
        "pack_id": pack_id,
        "readme": "\n".join(readme),
        "manifest": manifest
    }


def generate_catalog(
    packs_dir: Path,
    output_format: str = "markdown"
) -> Dict[str, Any]:
    """
    Generate a comprehensive catalog of all workflows.

    Args:
        packs_dir: Path to the packs directory
        output_format: Output format

    Returns:
        Dictionary with catalog data
    """
    catalog = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "total_workflows": 0,
        "total_packs": 0,
        "categories": {},
        "workflows": []
    }

    if yaml is None:
        print("Error: PyYAML not available")
        return {"success": False, "error": "PyYAML required"}

    # Collect pack information
    pack_manifests = list(packs_dir.glob("**/pack-manifest.yaml"))
    catalog["total_packs"] = len(pack_manifests)

    # Collect workflow information
    workflow_manifests = list(packs_dir.glob("**/manifest.yaml"))
    for manifest_path in workflow_manifests:
        if "pack-manifest" in str(manifest_path):
            continue

        try:
            with open(manifest_path, 'r') as f:
                manifest = yaml.safe_load(f)

            if manifest:
                workflow_id = manifest.get("id", "")
                category = manifest.get("category", "unknown")

                if category not in catalog["categories"]:
                    catalog["categories"][category] = {
                        "workflows": [],
                        "count": 0
                    }

                workflow_info = {
                    "id": workflow_id,
                    "name": manifest.get("name", ""),
                    "version": manifest.get("version", ""),
                    "category": category,
                    "status": manifest.get("status", "stable"),
                    "description": manifest.get("description", ""),
                    "tags": manifest.get("tags", [])
                }

                catalog["workflows"].append(workflow_info)
                catalog["categories"][category]["workflows"].append(workflow_info)
                catalog["categories"][category]["count"] += 1
                catalog["total_workflows"] += 1

        except Exception:
            continue

    # Sort workflows in each category
    for category in catalog["categories"]:
        catalog["categories"][category]["workflows"].sort(
            key=lambda x: x["name"]
        )

    return {
        "success": True,
        "catalog": catalog
    }


def generate_catalog_readme(
    catalog: Dict[str, Any],
    categories_config: Optional[Dict[str, Any]] = None
) -> str:
    """
    Generate a README.md catalog from catalog data.

    Args:
        catalog: Catalog data from generate_catalog()
        categories_config: Optional category configuration

    Returns:
        Formatted README string
    """
    lines = []

    lines.append("# AI Suite Workflow Catalog")
    lines.append("")
    lines.append(f"**Total Workflows:** {catalog['total_workflows']}")
    lines.append(f"**Total Packs:** {catalog['total_packs']}")
    lines.append(f"**Last Updated:** {catalog['generated_at']}")
    lines.append("")
    lines.append("## Categories")
    lines.append("")

    for category, data in sorted(catalog['categories'].items()):
        lines.append(f"### {category}")
        lines.append("")
        lines.append(f"**{data['count']} workflows**")
        lines.append("")

        for workflow in data['workflows']:
            lines.append(f"- [{workflow['name']}](#user-content-{workflow['id'].replace('.', '-')}) "
                        f"(`{workflow['id']}`)")

        lines.append("")

    lines.append("## Workflows")
    lines.append("")

    for workflow in sorted(catalog['workflows'], key=lambda x: x['name']):
        lines.append(f"### {workflow['name']}")
        lines.append("")
        lines.append(f"**ID:** `{workflow['id']}`")
        lines.append(f"**Version:** {workflow['version']}")
        lines.append(f"**Category:** {workflow['category']}")
        lines.append(f"**Status:** {workflow['status']}")
        lines.append("")
        lines.append(workflow['description'])
        lines.append("")
        if workflow['tags']:
            lines.append(f"**Tags:** {', '.join(workflow['tags'])}")
            lines.append("")

    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("*Generated by AI Suite Documentation Generator*")

    return "\n".join(lines)


def generate_configuration_examples(
    packs_dir: Path,
    output_format: str = "markdown"
) -> Dict[str, Any]:
    """
    Generate configuration examples from manifests.

    Args:
        packs_dir: Path to packs directory
        output_format: Output format

    Returns:
        Dictionary with examples
    """
    examples = {
        "yaml": [],
        "json": []
    }

    if yaml is None:
        return {"success": False, "error": "PyYAML required"}

    # Find all manifests and extract examples
    for manifest_path in packs_dir.glob("**/manifest.yaml"):
        if "pack-manifest" in str(manifest_path):
            continue

        try:
            with open(manifest_path, 'r') as f:
                manifest = yaml.safe_load(f)

            if manifest:
                # Create minimal example
                example = {
                    "id": manifest.get("id", ""),
                    "name": manifest.get("name", ""),
                    "inputs": {}
                }

                for input_param in manifest.get("inputs", []):
                    if "default" in input_param:
                        example["inputs"][input_param["id"]] = input_param["default"]

                # Convert to JSON for JSON example
                examples["json"].append({
                    "workflow": example["id"],
                    "example": json.dumps(example, indent=2)
                })

                # Format as YAML for YAML example
                yaml_example = yaml.dump(example, default_flow_style=False)
                examples["yaml"].append({
                    "workflow": example["id"],
                    "example": yaml_example
                })

        except Exception:
            continue

    return {
        "success": True,
        "examples": examples
    }


def generate_documentation(
    packs_dir: Path,
    output_dir: Path,
    workflow_id: Optional[str] = None,
    pack_id: Optional[str] = None,
    catalog: bool = False,
    examples: bool = False,
    format: str = "markdown"
) -> Dict[str, Any]:
    """
    Generate documentation for workflows and packs.

    Args:
        packs_dir: Path to packs directory
        output_dir: Path to output directory
        workflow_id: Specific workflow to document
        pack_id: Specific pack to document
        catalog: Whether to generate catalog
        examples: Whether to generate configuration examples
        format: Output format

    Returns:
        Dictionary with generation results
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    results = {
        "success": True,
        "generated_files": [],
        "errors": []
    }

    try:
        if workflow_id:
            result = generate_workflow_readme(workflow_id, packs_dir, format)
            if result["success"]:
                output_path = output_dir / f"{workflow_id}.md"
                with open(output_path, 'w') as f:
                    f.write(result["readme"])
                results["generated_files"].append(str(output_path))
            else:
                results["success"] = False
                results["errors"].append(result.get("error", "Unknown error"))

        elif pack_id:
            result = generate_pack_readme(pack_id, packs_dir, format)
            if result["success"]:
                output_path = output_dir / f"{pack_id}.md"
                with open(output_path, 'w') as f:
                    f.write(result["readme"])
                results["generated_files"].append(str(output_path))
            else:
                results["success"] = False
                results["errors"].append(result.get("error", "Unknown error"))

        elif catalog:
            result = generate_catalog(packs_dir, format)
            if result["success"]:
                catalog_readme = generate_catalog_readme(result["catalog"])
                output_path = output_dir / "README.md"
                with open(output_path, 'w') as f:
                    f.write(catalog_readme)
                results["generated_files"].append(str(output_path))

                # Also save catalog data
                catalog_path = output_dir / "catalog.json"
                with open(catalog_path, 'w') as f:
                    json.dump(result["catalog"], f, indent=2)
                results["generated_files"].append(str(catalog_path))
            else:
                results["success"] = False
                results["errors"].append(result.get("error", "Unknown error"))

        elif examples:
            result = generate_configuration_examples(packs_dir, format)
            if result["success"]:
                for example_type, examples_list in result["examples"].items():
                    output_path = output_dir / f"examples.{example_type}.md"
                    with open(output_path, 'w') as f:
                        f.write(f"# Configuration Examples\n\n")
                        for example in examples_list:
                            f.write(f"## {example['workflow']}\n\n")
                            f.write(f"```{example_type}\n")
                            f.write(example['example'])
                            f.write("\n```\n\n")
                    results["generated_files"].append(str(output_path))
            else:
                results["success"] = False
                results["errors"].append(result.get("error", "Unknown error"))

        else:
            # Generate documentation for all packs
            pack_manifests = list(packs_dir.glob("**/pack-manifest.yaml"))
            for pack_path in pack_manifests:
                if yaml is None:
                    continue
                try:
                    with open(pack_path, 'r') as f:
                        manifest = yaml.safe_load(f)
                    if manifest:
                        pack_id = manifest.get("id", "")
                        result = generate_pack_readme(pack_id, packs_dir, format)
                        if result["success"]:
                            output_path = output_dir / "packs" / f"{pack_id}.md"
                            output_path.parent.mkdir(parents=True, exist_ok=True)
                            with open(output_path, 'w') as f:
                                f.write(result["readme"])
                            results["generated_files"].append(str(output_path))
                except Exception as e:
                    results["errors"].append(f"Error processing {pack_path}: {e}")

    except Exception as e:
        results["success"] = False
        results["errors"].append(f"Documentation generation error: {e}")

    return results


def main():
    """Main entry point for the documentation generator CLI."""
    parser = argparse.ArgumentParser(
        description="Generate documentation from manifests",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s --workflow character.character-sheet --output-dir docs/
  %(prog)s --pack character --output-dir docs/
  %(prog)s --packs-dir packs --output-dir docs/ --catalog
  %(prog)s --packs-dir packs --output-dir docs/ --examples

The --workflow and --pack options generate docs for specific items.
The --catalog option generates a comprehensive workflow catalog.
The --examples option generates configuration examples.
        """
    )

    parser.add_argument(
        "--workflow",
        type=str,
        help="Workflow ID to generate docs for (e.g., character.character-sheet)"
    )

    parser.add_argument(
        "--pack",
        type=str,
        help="Pack ID to generate docs for (e.g., character)"
    )

    parser.add_argument(
        "--packs-dir",
        type=str,
        default="packs",
        help="Path to packs directory (default: packs)"
    )

    parser.add_argument(
        "--output-dir",
        type=str,
        default="docs",
        help="Output directory for generated docs (default: docs)"
    )

    parser.add_argument(
        "--catalog",
        action="store_true",
        help="Generate comprehensive workflow catalog"
    )

    parser.add_argument(
        "--examples",
        action="store_true",
        help="Generate configuration examples"
    )

    parser.add_argument(
        "--format",
        type=str,
        default="markdown",
        choices=["markdown", "json", "html"],
        help="Output format (default: markdown)"
    )

    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose output"
    )

    args = parser.parse_args()

    # Validate arguments
    if not (args.workflow or args.pack or args.catalog or args.examples):
        parser.error("One of --workflow, --pack, --catalog, or --examples is required")

    if args.workflow and args.pack:
        parser.error("Cannot specify both --workflow and --pack")

    # Setup paths
    packs_dir = Path(args.packs_dir)
    if not packs_dir.exists():
        print(f"Error: Packs directory not found: {packs_dir}", file=sys.stderr)
        sys.exit(1)

    output_dir = Path(args.output_dir)

    if args.verbose:
        print(f"Generating documentation from: {packs_dir}")
        print(f"Output directory: {output_dir}")

    # Generate
    results = generate_documentation(
        packs_dir=packs_dir,
        output_dir=output_dir,
        workflow_id=args.workflow,
        pack_id=args.pack,
        catalog=args.catalog,
        examples=args.examples,
        format=args.format
    )

    if args.verbose:
        if results["success"]:
            print(f"\nSuccessfully generated {len(results['generated_files'])} file(s):")
            for file in results["generated_files"]:
                print(f"  - {file}")
        else:
            print("\nDocumentation generation failed:")
            for error in results["errors"]:
                print(f"  - {error}")

    if not results["success"]:
        sys.exit(1)


if __name__ == "__main__":
    main()