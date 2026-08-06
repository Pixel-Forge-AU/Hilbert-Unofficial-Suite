#!/usr/bin/env python3
"""
Pack Mover Module

Moves workflow packs between categories: relocates the pack directory,
updates its manifest.yaml `category:` field, and updates the `workflows:`
list in both the source and destination category's pack-manifest.yaml.
Edits are line-based (not a full YAML re-dump) so comments and formatting
in existing manifests are preserved.

Example usage:
    # See what's in each category
    python -m tools pack-mover list
    python -m tools pack-mover list --category video-gen

    # Move one or more packs to an existing category
    python -m tools pack-mover move --pack video.image-to-video --to video-edit

    # Move into a brand-new category (creates its pack-manifest.yaml)
    python -m tools pack-mover move --pack video.new-thing --to video-fx \\
        --category-name "Video FX" --category-description "Stylistic video effects"

    # Skip the automatic registry rebuild (e.g. to batch several moves first)
    python -m tools pack-mover move --pack a.b --pack c.d --to some-category --no-rebuild-registry
"""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import yaml
except ImportError:
    print("Warning: PyYAML not installed. Install with: pip install pyyaml")
    yaml = None  # type: ignore


def load_yaml(path: Path) -> Optional[Dict[str, Any]]:
    if yaml is None:
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f)
    except Exception as e:
        print(f"Error reading {path}: {e}")
        return None


def find_all_packs(packs_dir: Path) -> Dict[str, Dict[str, Any]]:
    """Map workflow id -> {path, category, dirname} for every pack manifest.yaml."""
    packs: Dict[str, Dict[str, Any]] = {}
    for manifest_path in packs_dir.glob("*/*/manifest.yaml"):
        manifest = load_yaml(manifest_path)
        if not manifest or "id" not in manifest:
            continue
        pack_id = manifest["id"]
        packs[pack_id] = {
            "path": manifest_path.parent,
            "category": manifest.get("category", manifest_path.parent.parent.name),
            "dirname": manifest_path.parent.name,
            "name": manifest.get("name", pack_id),
        }
    return packs


def find_category_manifests(packs_dir: Path) -> Dict[str, Path]:
    """Map category id -> its pack-manifest.yaml path."""
    categories: Dict[str, Path] = {}
    for pack_manifest_path in packs_dir.glob("*/pack-manifest.yaml"):
        manifest = load_yaml(pack_manifest_path)
        cat_id = (manifest or {}).get("id", pack_manifest_path.parent.name)
        categories[cat_id] = pack_manifest_path
    return categories


def git_available(cwd: Path) -> bool:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=str(cwd), capture_output=True, text=True, timeout=10
        )
        return result.returncode == 0 and result.stdout.strip() == "true"
    except Exception:
        return False


def move_dir(src: Path, dst: Path, use_git: bool) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if use_git:
        result = subprocess.run(
            ["git", "mv", str(src), str(dst)],
            cwd=str(src.parent.parent.parent), capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            return
        # Falls through to plain move (e.g. untracked directory - "git mv" refuses those)
    shutil.move(str(src), str(dst))


def remove_dir(path: Path, use_git: bool) -> None:
    if use_git:
        result = subprocess.run(
            ["git", "rm", "-rf", "-q", str(path)],
            cwd=str(path.parent.parent.parent), capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            return
        # Falls through to plain delete (e.g. untracked directory - "git rm" refuses those)
    shutil.rmtree(str(path))


def update_category_field(manifest_path: Path, new_category: str) -> bool:
    text = manifest_path.read_text(encoding="utf-8")
    new_text, count = re.subn(
        r"^category:\s*.*$", f"category: {new_category}", text, count=1, flags=re.MULTILINE
    )
    if count == 0:
        print(f"Warning: no `category:` line found in {manifest_path}, leaving untouched")
        return False
    manifest_path.write_text(new_text, encoding="utf-8")
    return True


def remove_workflow_from_pack_manifest(pack_manifest_path: Path, pack_id: str) -> None:
    lines = pack_manifest_path.read_text(encoding="utf-8").splitlines(keepends=True)
    pattern = re.compile(r"^\s*-\s*" + re.escape(pack_id) + r"\s*$")
    new_lines = [ln for ln in lines if not pattern.match(ln)]
    if len(new_lines) != len(lines):
        pack_manifest_path.write_text("".join(new_lines), encoding="utf-8")


def add_workflow_to_pack_manifest(pack_manifest_path: Path, pack_id: str) -> None:
    lines = pack_manifest_path.read_text(encoding="utf-8").splitlines(keepends=True)
    already_present = any(re.match(r"^\s*-\s*" + re.escape(pack_id) + r"\s*$", ln) for ln in lines)
    if already_present:
        return

    workflows_start = None
    for i, ln in enumerate(lines):
        if re.match(r"^workflows:\s*$", ln):
            workflows_start = i
            break

    new_line = f"  - {pack_id}\n"

    if workflows_start is None:
        # No workflows: block yet - append one at the end
        if lines and not lines[-1].endswith("\n"):
            lines[-1] += "\n"
        lines.append("workflows:\n")
        lines.append(new_line)
        pack_manifest_path.write_text("".join(lines), encoding="utf-8")
        return

    # Insert after the last "  - " list item under workflows:
    insert_at = workflows_start + 1
    for i in range(workflows_start + 1, len(lines)):
        if re.match(r"^\s*-\s*\S", lines[i]):
            insert_at = i + 1
        elif lines[i].strip() == "":
            continue
        else:
            break
    lines.insert(insert_at, new_line)
    pack_manifest_path.write_text("".join(lines), encoding="utf-8")


def create_category(packs_dir: Path, category_id: str, name: str, description: str) -> Path:
    category_dir = packs_dir / category_id
    category_dir.mkdir(parents=True, exist_ok=True)
    pack_manifest_path = category_dir / "pack-manifest.yaml"
    content = (
        f"# {name} Pack Manifest\n\n"
        f"id: {category_id}\n"
        f"name: {name}\n"
        f'version: "1.0.0"\n\n'
        f"description: >\n  {description}\n\n"
        f"workflows:\n\n"
        f"default_enabled: true\n"
    )
    pack_manifest_path.write_text(content, encoding="utf-8")
    print(f"Created new category: {category_dir}")
    return pack_manifest_path


def rebuild_registry(packs_dir: Path, output_path: Path, verbose: bool) -> None:
    # Import locally so `pack-mover list` doesn't require registry_generator's deps
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from tools.registry_generator import generate_registry
    registry = generate_registry(packs_dir, None, output_path)
    if verbose:
        print(f"Registry rebuilt: {registry['total_packs']} packs, {registry['total_workflows']} workflows")


def cmd_list(args: argparse.Namespace) -> None:
    packs_dir = Path(args.packs_dir)
    packs = find_all_packs(packs_dir)
    by_category: Dict[str, List[str]] = {}
    for pack_id, info in packs.items():
        by_category.setdefault(info["category"], []).append(f"{pack_id}  ({info['name']})")

    categories = sorted(by_category.keys())
    if args.category:
        categories = [c for c in categories if c == args.category]
        if not categories:
            print(f"No packs found in category: {args.category}")
            return

    for cat in categories:
        items = sorted(by_category[cat])
        print(f"\n{cat} ({len(items)})")
        for item in items:
            print(f"  {item}")


def cmd_move(args: argparse.Namespace) -> None:
    packs_dir = Path(args.packs_dir)
    packs = find_all_packs(packs_dir)
    categories = find_category_manifests(packs_dir)
    use_git = git_available(packs_dir)

    target_category = args.to
    if target_category not in categories:
        if not args.category_name:
            print(
                f"Error: category '{target_category}' doesn't exist yet. "
                f"Pass --category-name (and optionally --category-description) to create it."
            )
            sys.exit(1)
        new_manifest = create_category(
            packs_dir, target_category, args.category_name,
            args.category_description or args.category_name
        )
        categories[target_category] = new_manifest

    moved = []
    for pack_id in args.pack:
        info = packs.get(pack_id)
        if not info:
            print(f"Warning: pack id not found, skipping: {pack_id}")
            continue

        if info["category"] == target_category:
            print(f"Already in {target_category}, skipping: {pack_id}")
            continue

        src_dir = info["path"]
        dst_dir = packs_dir / target_category / info["dirname"]
        move_dir(src_dir, dst_dir, use_git)

        new_manifest_path = dst_dir / "manifest.yaml"
        update_category_field(new_manifest_path, target_category)

        old_category_manifest = categories.get(info["category"])
        if old_category_manifest and old_category_manifest.exists():
            remove_workflow_from_pack_manifest(old_category_manifest, pack_id)

        add_workflow_to_pack_manifest(categories[target_category], pack_id)

        print(f"Moved {pack_id}: {info['category']} -> {target_category}")
        moved.append(pack_id)

    if not moved:
        print("Nothing moved.")
        return

    if not args.no_rebuild_registry:
        rebuild_registry(packs_dir, Path(args.registry_output), args.verbose)
        print("Remember to restart Studio to pick up the new registry.json")
    else:
        print("Skipped registry rebuild (--no-rebuild-registry). "
              "Run `python -m tools pack-mover move` again without that flag, "
              "or `python -m tools registry`, when ready.")


def cmd_remove(args: argparse.Namespace) -> None:
    packs_dir = Path(args.packs_dir)
    packs = find_all_packs(packs_dir)
    categories = find_category_manifests(packs_dir)
    use_git = git_available(packs_dir)

    removed = []
    for pack_id in args.pack:
        info = packs.get(pack_id)
        if not info:
            print(f"Warning: pack id not found, skipping: {pack_id}")
            continue

        category_manifest = categories.get(info["category"])
        if category_manifest and category_manifest.exists():
            remove_workflow_from_pack_manifest(category_manifest, pack_id)

        remove_dir(info["path"], use_git)
        print(f"Removed {pack_id} (was in {info['category']})")
        removed.append(pack_id)

    if not removed:
        print("Nothing removed.")
        return

    if not args.no_rebuild_registry:
        rebuild_registry(packs_dir, Path(args.registry_output), args.verbose)
        print("Remember to restart Studio to pick up the new registry.json")


def cmd_remove_category(args: argparse.Namespace) -> None:
    packs_dir = Path(args.packs_dir)
    categories = find_category_manifests(packs_dir)
    category_id = args.category

    if category_id not in categories:
        print(f"Error: category not found: {category_id}")
        sys.exit(1)

    category_dir = categories[category_id].parent
    remaining = [d.name for d in category_dir.iterdir() if d.is_dir()]
    if remaining:
        print(f"Error: category '{category_id}' still has packs ({', '.join(remaining)}). "
              f"Move or remove them first.")
        sys.exit(1)

    use_git = git_available(packs_dir)
    manifest_path = categories[category_id]
    if use_git:
        result = subprocess.run(
            ["git", "rm", "-f", "-q", str(manifest_path)],
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

    print(f"Removed empty category: {category_id}")
    if not args.no_rebuild_registry:
        rebuild_registry(packs_dir, Path(args.registry_output), args.verbose)
        print("Remember to restart Studio to pick up the new registry.json")


def main():
    parser = argparse.ArgumentParser(
        description="Move workflow packs between categories",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="action", required=True)

    list_parser = subparsers.add_parser("list", help="List packs by category")
    list_parser.add_argument("--packs-dir", type=str, default="packs")
    list_parser.add_argument("--category", type=str, help="Only show this category")
    list_parser.set_defaults(func=cmd_list)

    move_parser = subparsers.add_parser("move", help="Move one or more packs to a category")
    move_parser.add_argument(
        "--pack", type=str, action="append", required=True,
        help="Pack id to move (e.g. video.image-to-video). Repeatable."
    )
    move_parser.add_argument("--to", type=str, required=True, help="Destination category id")
    move_parser.add_argument("--packs-dir", type=str, default="packs")
    move_parser.add_argument("--registry-output", type=str, default="registry/registry.json")
    move_parser.add_argument("--no-rebuild-registry", action="store_true")
    move_parser.add_argument("--category-name", type=str, help="Display name, if --to is a new category")
    move_parser.add_argument("--category-description", type=str, help="Description, if --to is a new category")
    move_parser.add_argument("--verbose", "-v", action="store_true")
    move_parser.set_defaults(func=cmd_move)

    remove_parser = subparsers.add_parser("remove", help="Delete one or more packs entirely")
    remove_parser.add_argument(
        "--pack", type=str, action="append", required=True,
        help="Pack id to delete (e.g. video.image-to-video). Repeatable."
    )
    remove_parser.add_argument("--packs-dir", type=str, default="packs")
    remove_parser.add_argument("--registry-output", type=str, default="registry/registry.json")
    remove_parser.add_argument("--no-rebuild-registry", action="store_true")
    remove_parser.add_argument("--verbose", "-v", action="store_true")
    remove_parser.set_defaults(func=cmd_remove)

    remove_category_parser = subparsers.add_parser("remove-category", help="Delete an empty category")
    remove_category_parser.add_argument("--category", type=str, required=True, help="Category id to delete")
    remove_category_parser.add_argument("--packs-dir", type=str, default="packs")
    remove_category_parser.add_argument("--registry-output", type=str, default="registry/registry.json")
    remove_category_parser.add_argument("--no-rebuild-registry", action="store_true")
    remove_category_parser.add_argument("--verbose", "-v", action="store_true")
    remove_category_parser.set_defaults(func=cmd_remove_category)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
