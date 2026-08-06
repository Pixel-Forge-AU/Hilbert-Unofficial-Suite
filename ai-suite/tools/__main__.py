#!/usr/bin/env python3
"""
AI Suite Tools - Main Entry Point

This module provides a unified command-line interface for all AI Suite build tools,
including registry generation, workflow compilation, validation, and documentation generation.

Example usage:
    # Show help
    python -m tools

    # Generate registry
    python -m tools registry --packs-dir packs --output registry.json

    # Compile workflows
    python -m tools compile --workflow character.character-sheet --output-dir dist

    # Validate manifests
    python -m tools validate --packs-dir packs --all

    # Generate documentation
    python -m tools docs --workflow character.character-sheet --output-dir docs
"""

import argparse
import importlib
import sys
from pathlib import Path
from typing import Any, Dict, Optional

# Add current directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))


def get_tool_module(tool_name: str):
    """
    Dynamically import a tool module.

    Args:
        tool_name: Name of the tool module to import

    Returns:
        Imported module or None if import failed
    """
    try:
        module_name = f"tools.{tool_name}"
        return importlib.import_module(module_name)
    except ImportError as e:
        print(f"Error importing module {tool_name}: {e}")
        print("Make sure the tool file exists in the tools/ directory")
        return None


def main():
    """Main entry point for AI Suite tools."""
    parser = argparse.ArgumentParser(
        prog="ai-suite-tools",
        description="AI Suite Build Tools - A collection of utilities for managing AI workflows",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Available tools:
  registry    Generate registry JSON from pack manifests
  compile     Compile workflow packs for distribution
  validate    Validate manifests against schemas
  docs        Generate documentation from manifests

Examples:
  %(prog)s registry --packs-dir packs --output registry.json
  %(prog)s compile --workflow character.character-sheet --output-dir dist
  %(prog)s validate --packs-dir packs --all
  %(prog)s docs --workflow character.character-sheet --output-dir docs

Use '%(prog)s <tool> --help' for more information about a specific tool.
        """
    )

    subparsers = parser.add_subparsers(
        dest="tool",
        title="Available tools",
        description="Select a tool to run"
    )

    # Registry generator tool
    registry_parser = subparsers.add_parser(
        "registry",
        help="Generate registry JSON from pack manifests",
        description="Generate registry JSON from pack manifests",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    registry_parser.add_argument(
        "--packs-dir",
        type=str,
        default="packs",
        help="Path to packs directory (default: packs)"
    )
    registry_parser.add_argument(
        "--output",
        type=str,
        default="registry.json",
        help="Output path for registry JSON (default: registry.json)"
    )
    registry_parser.add_argument(
        "--category",
        type=str,
        action="append",
        help="Category to include (can be specified multiple times)"
    )
    registry_parser.add_argument(
        "--filter-by",
        type=str,
        help="Comma-separated list of categories to include"
    )
    registry_parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output"
    )

    # Workflow compiler tool
    compile_parser = subparsers.add_parser(
        "compile",
        help="Compile workflow packs for distribution",
        description="Compile workflow packs for distribution",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    compile_parser.add_argument(
        "--workflow",
        type=str,
        help="Workflow ID to compile (e.g., character.character-sheet)"
    )
    compile_parser.add_argument(
        "--pack",
        type=str,
        help="Pack ID to compile (e.g., character)"
    )
    compile_parser.add_argument(
        "--all",
        action="store_true",
        help="Compile all packs"
    )
    compile_parser.add_argument(
        "--output-dir",
        type=str,
        default="dist",
        help="Output directory (default: dist)"
    )
    compile_parser.add_argument(
        "--packs-dir",
        type=str,
        default="packs",
        help="Path to packs directory (default: packs)"
    )
    compile_parser.add_argument(
        "--include-deps",
        action="store_true",
        help="Include model dependencies"
    )
    compile_parser.add_argument(
        "--no-presets",
        action="store_true",
        help="Exclude preset files"
    )
    compile_parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output"
    )

    # Validator tool
    validate_parser = subparsers.add_parser(
        "validate",
        help="Validate manifests against schemas",
        description="Validate manifests against schemas",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    validate_parser.add_argument(
        "--manifest",
        type=str,
        help="Path to specific manifest file to validate"
    )
    validate_parser.add_argument(
        "--packs-dir",
        type=str,
        default="packs",
        help="Path to packs directory (default: packs)"
    )
    validate_parser.add_argument(
        "--schemas-dir",
        type=str,
        default="schemas",
        help="Path to schemas directory (default: schemas)"
    )
    validate_parser.add_argument(
        "--models-dir",
        type=str,
        help="Path to models directory for dependency checking"
    )
    validate_parser.add_argument(
        "--all",
        action="store_true",
        help="Validate all manifests in packs directory"
    )
    validate_parser.add_argument(
        "--workflow-only",
        action="store_true",
        help="Only validate workflow manifests"
    )
    validate_parser.add_argument(
        "--pack-only",
        action="store_true",
        help="Only validate pack manifests"
    )
    validate_parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings as errors"
    )
    validate_parser.add_argument(
        "--json",
        action="store_true",
        help="Output results as JSON"
    )
    validate_parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output"
    )

    # Pack mover tool - forwards straight through to pack_mover.main() rather than
    # duplicating its subcommands/flags here a second time (that duplication is exactly
    # what caused "remove"/"remove-category" to 404 until this comment was written).
    pack_mover_parser = subparsers.add_parser(
        "pack-mover",
        help="Move/remove workflow packs and categories (see: python -m tools.pack_mover --help)",
        description="Move/remove workflow packs and categories",
        add_help=False,
    )
    pack_mover_parser.add_argument("pack_mover_args", nargs=argparse.REMAINDER)

    # Documentation generator tool
    docs_parser = subparsers.add_parser(
        "docs",
        help="Generate documentation from manifests",
        description="Generate documentation from manifests",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )

    docs_parser.add_argument(
        "--workflow",
        type=str,
        help="Workflow ID to generate docs for"
    )
    docs_parser.add_argument(
        "--pack",
        type=str,
        help="Pack ID to generate docs for"
    )
    docs_parser.add_argument(
        "--packs-dir",
        type=str,
        default="packs",
        help="Path to packs directory (default: packs)"
    )
    docs_parser.add_argument(
        "--output-dir",
        type=str,
        default="docs",
        help="Output directory (default: docs)"
    )
    docs_parser.add_argument(
        "--catalog",
        action="store_true",
        help="Generate comprehensive workflow catalog"
    )
    docs_parser.add_argument(
        "--examples",
        action="store_true",
        help="Generate configuration examples"
    )
    docs_parser.add_argument(
        "--format",
        type=str,
        default="markdown",
        choices=["markdown", "json", "html"],
        help="Output format (default: markdown)"
    )
    docs_parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output"
    )

    args = parser.parse_args()

    if not args.tool:
        parser.print_help()
        sys.exit(0)

    # Import tool modules
    registry_module = get_tool_module("registry_generator")
    compile_module = get_tool_module("workflow_compiler")
    validate_module = get_tool_module("validator")
    docs_module = get_tool_module("documentation_generator")
    pack_mover_module = get_tool_module("pack_mover")

    # Execute the selected tool with parsed arguments
    if args.tool == "registry":
        if registry_module and hasattr(registry_module, "main"):
            # Save original sys.argv
            original_argv = sys.argv.copy()
            try:
                # Build argv for the module's main function
                argv = ["registry_generator"]
                if args.verbose:
                    argv.append("--verbose")
                if args.packs_dir != "packs":
                    argv.extend(["--packs-dir", args.packs_dir])
                if args.output != "registry.json":
                    argv.extend(["--output", args.output])
                if args.category:
                    for cat in args.category:
                        argv.extend(["--category", cat])
                if args.filter_by:
                    argv.extend(["--filter-by", args.filter_by])
                sys.argv = argv
                registry_module.main()
            finally:
                sys.argv = original_argv
        else:
            print("Error: Registry generator module not available")
            sys.exit(1)

    elif args.tool == "compile":
        if compile_module and hasattr(compile_module, "main"):
            original_argv = sys.argv.copy()
            try:
                argv = ["workflow_compiler"]
                if args.verbose:
                    argv.append("--verbose")
                if args.workflow:
                    argv.extend(["--workflow", args.workflow])
                if args.pack:
                    argv.extend(["--pack", args.pack])
                if args.all:
                    argv.append("--all")
                if args.output_dir != "dist":
                    argv.extend(["--output-dir", args.output_dir])
                if args.packs_dir != "packs":
                    argv.extend(["--packs-dir", args.packs_dir])
                if args.include_deps:
                    argv.append("--include-deps")
                if args.no_presets:
                    argv.append("--no-presets")
                sys.argv = argv
                compile_module.main()
            finally:
                sys.argv = original_argv
        else:
            print("Error: Workflow compiler module not available")
            sys.exit(1)

    elif args.tool == "validate":
        if validate_module and hasattr(validate_module, "main"):
            original_argv = sys.argv.copy()
            try:
                argv = ["validator"]
                if args.verbose:
                    argv.append("--verbose")
                if args.manifest:
                    argv.extend(["--manifest", args.manifest])
                if args.packs_dir != "packs":
                    argv.extend(["--packs-dir", args.packs_dir])
                if args.schemas_dir != "schemas":
                    argv.extend(["--schemas-dir", args.schemas_dir])
                if args.models_dir:
                    argv.extend(["--models-dir", args.models_dir])
                if args.all:
                    argv.append("--all")
                if args.workflow_only:
                    argv.append("--workflow-only")
                if args.pack_only:
                    argv.append("--pack-only")
                if args.strict:
                    argv.append("--strict")
                if args.json:
                    argv.append("--json")
                sys.argv = argv
                validate_module.main()
            finally:
                sys.argv = original_argv
        else:
            print("Error: Validator module not available")
            sys.exit(1)

    elif args.tool == "docs":
        if docs_module and hasattr(docs_module, "main"):
            original_argv = sys.argv.copy()
            try:
                argv = ["documentation_generator"]
                if args.verbose:
                    argv.append("--verbose")
                if args.workflow:
                    argv.extend(["--workflow", args.workflow])
                if args.pack:
                    argv.extend(["--pack", args.pack])
                if args.packs_dir != "packs":
                    argv.extend(["--packs-dir", args.packs_dir])
                if args.output_dir != "docs":
                    argv.extend(["--output-dir", args.output_dir])
                if args.catalog:
                    argv.append("--catalog")
                if args.examples:
                    argv.append("--examples")
                if args.format != "markdown":
                    argv.extend(["--format", args.format])
                sys.argv = argv
                docs_module.main()
            finally:
                sys.argv = original_argv
        else:
            print("Error: Documentation generator module not available")
            sys.exit(1)

    elif args.tool == "pack-mover":
        if pack_mover_module:
            original_argv = sys.argv.copy()
            try:
                sys.argv = ["pack_mover"] + args.pack_mover_args
                pack_mover_module.main()
            finally:
                sys.argv = original_argv
        else:
            print("Error: Pack mover module not available")
            sys.exit(1)

    else:
        print(f"Unknown tool: {args.tool}")
        sys.exit(1)


if __name__ == "__main__":
    main()