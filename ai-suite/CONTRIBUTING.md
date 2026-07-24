# Contributing to AI Suite V2

Thank you for your interest in contributing to AI Suite V2! This guide will help you get started contributing to this modular ComfyUI workflow platform.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
- [Development Workflow](#development-workflow)
- [Git Workflow](#git-workflow)
- [Code Style and Conventions](#code-style-and-conventions)
- [Testing Requirements](#testing-requirements)
- [Documentation Requirements](#documentation-requirements)
- [Workflow Development Guide](#workflow-development-guide)
- [Pack Development Guide](#pack-development-guide)
- [Review Process](#review-process)
- [Building and Testing](#building-and-testing)
- [Troubleshooting](#troubleshooting)
- [Acknowledgments](#acknowledgments)

---

## Code of Conduct

### Our Pledge

In the interest of fostering an open and welcoming environment, we as contributors and maintainers pledge to make participation in our project and our community a harassment-free experience for everyone, regardless of:

- Age
- Body size
- Disability
- Ethnicity
- Gender identity and expression
- Level of experience
- Nationality
- Personal appearance
- Race
- Religion
- Sexual identity and orientation

### Our Standards

Examples of behavior that contributes to a positive environment:

- Using welcoming and inclusive language
- Being respectful of differing viewpoints and experiences
- Gracefully accepting constructive criticism
- Focusing on what is best for the community
- Showing empathy towards other community members

Examples of unacceptable behavior:

- Trolling, insulting or derogatory comments
- Personal or political attacks
- Public or private harassment
- Publishing others' private information
- Other unethical or unprofessional conduct

### Our Responsibilities

Project maintainers are responsible for clarifying standards of acceptable behavior and are expected to take appropriate and fair corrective action in response to any instances of unacceptable behavior.

### Scope

This Code of Conduct applies within all project spaces, including GitHub, Discord, and any other communication channels used by the project.

---

## Getting Started

### First-Time Contributors

Welcome! We're excited to have you contribute to AI Suite V2. Here's how to get started:

#### 1. Understand the Project

Read these essential documents first:

- **[README.md](../README.md)**: Overview of the project
- **[Instructions.md](../Instructions.md)**: Complete project specification
- **[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)**: System architecture
- **[docs/USER_GUIDE.md](../docs/USER_GUIDE.md)**: How users interact with the platform

#### 2. Set Up Development Environment

```bash
# Clone the repository
git clone https://github.com/ai-suite/v2.git
cd ai-suite-v2

# Install dependencies
pip install -r requirements.txt

# Install development dependencies
pip install -r tools/requirements.txt

# Install workflow validation dependencies
pip install jsonschema pyyaml
```

#### 3. Explore the Codebase

Familiarize yourself with the structure:

```
ai-suite-v2/
├── packs/              # Workflow packs (main development area)
│   ├── core-generation/
│   ├── character/
│   ├── image-editing/
│   ├── horror-gore/
│   └── ...
├── docs/               # Documentation
│   ├── categories/
│   ├── workflows/
│   ├── installation/
│   └── developer-guide/
├── schemas/            # JSON schemas
│   ├── workflow-manifest.schema.json
│   ├── pack-manifest.schema.json
│   ├── preset.schema.json
│   └── model-manifest.schema.json
├── config/             # Configuration files
├── registry/           # Workflow registry
├── tools/              # Development tools
├── tests/              # Test files
└── launcher.py         # Main launcher
```

#### 4. Choose an Issue

Browse open issues:

- **Good First Issue**: Perfect for beginners
- **Help Wanted**: Issues needing community help
- **Bug**: Known issues to fix
- **Enhancement**: Feature requests
- **Documentation**: Documentation improvements

#### 5. Join the Community

- **Discord**: Join our server for real-time help
- **GitHub Discussions**: Ask questions and share ideas
- **Issues**: Report bugs and request features

### Experienced Contributors

If you're already familiar with the project:

1. Review the [Development Workflow](#development-workflow) section
2. Check the [Review Process](#review-process) expectations
3. Consider taking on more complex issues
4. Help mentor new contributors

---

## How to Contribute

### Reporting Bugs

Before reporting a bug:

1. **Check if it's already reported**: Search existing issues
2. **Test on latest version**: Ensure the issue exists in current main
3. **Gather information**: Prepare system details and reproduction steps

#### Bug Report Template

```markdown
**Describe the bug**
A clear description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '...'
3. See error

**Expected behavior**
A clear description of what you expected to happen.

**Screenshots**
If applicable, add screenshots to help explain your problem.

**Environment:**
- OS: [e.g., Windows 11, macOS 14, Ubuntu 22.04]
- Python version: [e.g., 3.9.18]
- ComfyUI version: [e.g., 0.3.18]
- GPU: [e.g., NVIDIA RTX 4090]
- VRAM: [e.g., 24GB]

**Additional context**
Add any other context about the problem here.
```

### Requesting Features

Before requesting a feature:

1. **Check if it's already requested**: Search existing issues
2. **Verify alignment**: Ensure it fits project goals
3. **Consider scope**: Be realistic about feature complexity

#### Feature Request Template

```markdown
**Is your feature request related to a problem? Please describe.**
A clear description of what the problem is.

**Describe the solution you'd like**
A clear description of what you want to happen.

**Describe alternatives you've considered**
A clear description of any alternative solutions or features you've considered.

**Additional context**
Add any other context or screenshots about the feature request here.
```

### Submitting Pull Requests

#### PR Checklist

Before submitting a PR:

- [ ] Code follows project style guidelines
- [ ] Tests pass (if applicable)
- [ ] Documentation updated
- [ ] Changelog entry added (for user-facing changes)
- [ ] Commit messages are clear and descriptive
- [ ] PR description is detailed
- [ ] Related issues referenced

#### PR Template

```markdown
**Description**
A clear description of what this PR does.

**Type of Change**
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update
- [ ] Other (please describe)

**Testing**
Describe how you tested this change.

**Screenshots**
If applicable, add screenshots to help explain your changes.

**Related Issues**
Fixes # (issue number)

**Checklist**
- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
```

---

## Development Workflow

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/YOUR_USERNAME/ai-suite-v2.git
cd ai-suite-v2

# Add upstream remote
git remote add upstream https://github.com/ai-suite/v2.git

# Verify remotes
git remote -v
```

### 2. Create a Branch

```bash
# Create a branch for your work
git checkout -b feature/your-feature-name
# or
git checkout -b bugfix/issue-number-description
```

Branch naming conventions:
- `feature/` for new features
- `bugfix/` for bug fixes
- `docs/` for documentation updates
- `refactor/` for code refactoring
- `test/` for test additions/changes

### 3. Make Your Changes

Follow the guidelines in this document:
- Write clean, maintainable code
- Add tests where appropriate
- Update documentation
- Follow the [Code Style](#code-style-and-conventions) guidelines

### 4. Test Your Changes

```bash
# Run all tests
python -m pytest tests/

# Run specific test file
python -m pytest tests/test_validator.py

# Run validation on packs
python tools/validator.py --all
```

### 5. Commit Your Changes

Follow the [Git Workflow](#git-workflow) guidelines for commit messages.

```bash
git add .
git commit -m "feat: add new workflow feature"
```

### 6. Push and Create PR

```bash
# Push to your fork
git push origin feature/your-feature-name

# Create PR through GitHub UI
```

---

## Git Workflow

### Branching Strategy

```
main
 └── develop (optional)
      ├── feature/branches
      ├── bugfix/branches
      └── hotfix/branches
```

### Branch Naming

- **Features**: `feature/short-description`
  - Example: `feature/add-character-portrait`
- **Bug Fixes**: `bugfix/issue-number-short-description`
  - Example: `bugfix/123-fix-inpainting-crash`
- **Documentation**: `docs/what-was-changed`
  - Example: `docs/update-user-guide`
- **Hotfixes**: `hotfix/urgent-fix-description`
  - Example: `hotfix/security-patch`

### Commit Message Format

```
type(scope): description

[optional body]

[optional footer]
```

#### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or modifying tests
- `chore`: Maintenance tasks
- `perf`: Performance improvements
- `ci`: CI/CD changes
- `build`: Build system changes

#### Examples

```bash
# Good commit messages
feat(character): add new portrait workflow
fix(inpainting): resolve crash when mask is empty
docs(readme): update installation instructions
refactor(config): simplify configuration loading
test(workflow): add smoke test for character-pose
```

### Pull Request Workflow

1. Create PR from feature branch to `main`
2. Assign reviewer (or request review)
3. Address review comments
4. Mark as ready for review
5. Merge after approval

---

## Code Style and Conventions

### Python Style

We follow [PEP 8](https://www.python.org/dev/peps/pep-0008/) with some additions:

#### Formatting

- **Indentation**: 4 spaces, no tabs
- **Line length**: 100 characters max
- **Quotes**: Use double quotes for strings
- **Imports**: Group standard, third-party, local
- **Spacing**: One blank line between functions, two between classes

#### Naming Conventions

```python
# Functions and variables
def my_function_name():
    local_variable = value

# Classes
class MyClass:
    def __init__(self):
        self.attribute_name = value

# Constants
MAX_WORKFLOW_COUNT = 100
DEFAULT_WIDTH = 1024

# Private members
def _internal_function():
    pass
```

#### Type Hints

Use type hints for all function signatures:

```python
from pathlib import Path
from typing import Dict, List, Optional, Any

def process_workflow(
    workflow_path: Path,
    config: Dict[str, Any],
    validation_mode: bool = False
) -> Optional[Dict[str, Any]]:
    """Process a workflow file."""
    pass
```

#### Docstrings

Use Google-style docstrings:

```python
def load_manifest(manifest_path: Path) -> Optional[Dict[str, Any]]:
    """
    Load a YAML manifest file.

    Args:
        manifest_path: Path to the YAML file

    Returns:
        Parsed manifest dictionary or None if loading fails
    """
    pass
```

### YAML Style

#### Manifest Files

- Use 2-space indentation
- Use double quotes for strings with special characters
- Include all required fields
- Add descriptive comments

```yaml
id: character.portrait
name: Character Portrait
version: "1.0.0"

description: >
  High-quality character portrait generation focusing on face and upper body.
  Optimized for detailed facial features and expressions.
```

#### Configuration Files

```yaml
settings:
  default_width: 1024
  default_height: 1024
  default_steps: 20
```

### JSON Style

- 2-space indentation
- Double quotes for all strings
- Trailing commas for multi-line structures

### Documentation Style

#### Markdown

- Use title case for headings
- Include code blocks with language identifiers
- Use bullet points for lists
- Link to related documentation

```python
```python
# Example code block
def example():
    print("Hello, World!")
```
```

#### API Documentation

```python
"""Workflow API module.

This module provides the REST API endpoints for workflow management.

Endpoints:
    GET /api/workflows - List all workflows
    GET /api/workflows/{id} - Get workflow details
    POST /api/workflows/{id}/run - Execute workflow
    DELETE /api/jobs/{id} - Cancel job
"""
```

---

## Testing Requirements

### Test Types

#### 1. Unit Tests

Test individual components:

```python
def test_manifest_loading():
    """Test loading and parsing manifest files."""
    manifest = load_manifest(Path("test/manifest.yaml"))
    assert manifest is not None
    assert manifest["id"] == "test.workflow"
```

#### 2. Integration Tests

Test component interactions:

```python
def test_workflow_execution():
    """Test complete workflow execution pipeline."""
    result = execute_workflow("character.portrait", inputs={...})
    assert result.success
```

#### 3. Smoke Tests

Test basic workflow functionality:

```python
def test_character_portrait_smoke():
    """Smoke test for character portrait workflow."""
    result = run_smoke_test("character.portrait")
    assert result["status"] == "success"
```

### Test Organization

```
tests/
├── unit/               # Unit tests
│   ├── test_config.py
│   ├── test_validator.py
│   └── test_registry.py
├── integration/        # Integration tests
│   ├── test_launcher.py
│   └── test_api.py
├── smoke/             # Smoke tests
│   ├── core-generation/
│   ├── character/
│   └── ...
└── manifests/         # Test manifests
```

### Running Tests

```bash
# All tests
python -m pytest tests/ -v

# Specific test file
python -m pytest tests/unit/test_validator.py -v

# With coverage
python -m pytest tests/ --cov=tools --cov-report=xml

# Fast tests only
python -m pytest tests/ -m "not slow"
```

### Test Coverage

Aim for at least 80% coverage for:
- Core tools
- Validation logic
- Configuration management
- API endpoints

---

## Documentation Requirements

### What to Document

#### 1. New Workflows

Each workflow needs:

- **README.md** in workflow directory:
  - Description
  - Input parameters
  - Output examples
  - Model requirements
  - Usage examples

```markdown
# Character Portrait

High-quality character portrait generation focusing on face and upper body.

## Inputs
- `prompt` (required): Positive prompt describing the character
- `negative_prompt`: Negative prompt for undesirable elements
- `width`: Output image width (default: 1024)
- `height`: Output image height (default: 1024)

## Model Requirements
- Checkpoint: flux or sdxl
- VAE: Optional
- LoRA: Optional

## Example
```yaml
inputs:
  prompt: "Portrait of a fantasy warrior, highly detailed, 8k"
```
```

#### 2. New Features

Update:
- Architecture documentation
- User guide
- Developer guide
- API reference

#### 3. Configuration Changes

Update:
- Configuration guide
- Example configurations
- Migration guide (if breaking)

### Documentation Location

```
docs/
├── categories/        # Category overviews
│   ├── core-generation.md
│   └── character.md
├── workflows/         # Individual workflow docs
│   ├── text-to-image.md
│   └── portrait.md
├── installation/      # Installation guides
│   ├── linux.md
│   └── macos.md
└── developer-guide/   # Developer documentation
    ├── workflow-development.md
    └── testing.md
```

### Documentation Best Practices

- Use clear, concise language
- Include code examples
- Add diagrams where helpful
- Keep documentation up to date
- Link related documentation

---

## Workflow Development Guide

### Creating a New Workflow

#### 1. Create Pack Directory Structure

```bash
mkdir -p packs/my-new-pack/my-workflow
cd packs/my-new-pack/my-workflow
```

#### 2. Create Manifest File

Create `manifest.yaml`:

```yaml
id: my-new-pack.my-workflow
name: My Workflow
version: "1.0.0"

category: my-new-pack
subcategory: my-subcategory

description: >
  Description of what this workflow does.

status: experimental

entrypoints:
  ui: workflow.json
  api: workflow-api.json

inputs:
  - id: prompt
    type: text
    required: true
    description: The main prompt

outputs:
  - id: image
    type: image

models:
  required:
    - role: checkpoint
      family:
        - flux
        - sdxl

hardware:
  minimum_vram_gb: 8
  recommended_vram_gb: 16

custom_nodes:
  required:
    - comfyui-custom-node
```

#### 3. Create Workflow JSON

Create `workflow.json` with ComfyUI workflow structure.

#### 4. Create API Workflow

Create `workflow-api.json` for API execution.

#### 5. Test Your Workflow

```bash
# Validate manifest
python tools/validator.py --manifest manifest.yaml

# Run smoke test
python tools/test_workflow.py --workflow my-new-pack.my-workflow
```

### Workflow Best Practices

- **Keep it focused**: One clear purpose
- **Document everything**: Inputs, outputs, requirements
- **Test thoroughly**: Smoke tests and edge cases
- **Optimize for performance**: Efficient workflows
- **Be model-agnostic**: Support multiple model families
- **Handle errors gracefully**: Clear error messages

---

## Pack Development Guide

### Creating a New Pack

#### 1. Create Pack Directory

```bash
mkdir -p packs/new-pack-name
```

#### 2. Create Pack Manifest

Create `pack-manifest.yaml`:

```yaml
id: new-pack-name
name: New Pack Name
version: "1.0.0"

description: >
  Description of what workflows this pack provides.

workflows:
  - new-pack-name.workflow-one
  - new-pack-name.workflow-two

default_enabled: true
```

#### 3. Add Workflows

Add workflow directories inside the pack:

```
packs/new-pack-name/
├── pack-manifest.yaml
├── workflow-one/
│   ├── manifest.yaml
│   ├── workflow.json
│   ├── workflow-api.json
│   └── README.md
└── workflow-two/
    ├── manifest.yaml
    ├── workflow.json
    ├── workflow-api.json
    └── README.md
```

### Pack Guidelines

- Group related workflows together
- Use descriptive pack names
- Include comprehensive documentation
- Test all workflows in pack
- Follow naming conventions

---

## Review Process

### PR Review Checklist

Reviewers will check:

- [ ] Code quality and style
- [ ] Test coverage
- [ ] Documentation
- [ ] Performance impact
- [ ] Security considerations
- [ ] Backward compatibility
- [ ] Code duplication
- [ ] Error handling

### Review Timeline

- **First response**: 24 hours
- **Complete review**: 48 hours
- **Merge**: After approval and CI pass

### Review Feedback

#### Positive Feedback

```markdown
LGTM! 🚀

This looks great. The implementation is clean and well-documented.
```

#### Constructive Feedback

```markdown
Good approach! A few suggestions:

1. Consider adding error handling for X
2. Could we optimize Y for better performance?
3. Let's update the documentation to cover Z

Let me know what you think!
```

### Addressing Feedback

1. Make requested changes
2. Reply to each comment
3. Push updates
4. Request re-review

---

## Building and Testing

### Development Setup

```bash
# Clone repository
git clone https://github.com/YOUR_USERNAME/ai-suite-v2.git
cd ai-suite-v2

# Install dependencies
pip install -r requirements.txt

# Install development dependencies
pip install pytest pytest-cov flake8 black isort

# Run linting
flake8 .
black --check .

# Run tests
pytest tests/ -v
```

### Building Documentation

```bash
# Generate API documentation
python tools/documentation_generator.py

# Build workflow registry
python tools/registry_generator.py --all
```

### Running Validation

```bash
# Validate all workflows
python tools/validator.py --all

# Validate specific pack
python tools/validator.py --pack core-generation

# Strict validation
python tools/validator.py --all --strict
```

### Continuous Integration

CI runs on pull requests:

```yaml
- Python linters (flake8, black, isort)
- Unit tests
- Integration tests
- Smoke tests
- Documentation build
- Manifest validation
```

---

## Troubleshooting

### Common Issues

#### 1. Manifest Validation Errors

**Problem**: `Validation failed: missing required field`

**Solution**: Check manifest has all required fields from schema.

#### 2. Workflow Not Showing in Launcher

**Problem**: Workflow not appearing in UI

**Solution**: 
- Check registry is up to date
- Verify pack is enabled in config
- Check manifest ID format

#### 3. Dependency Issues

**Problem**: Custom node not found

**Solution**: 
- Check workflow manifest has correct node name
- Install required custom nodes
- Check node compatibility

#### 4. Test Failures

**Problem**: Tests failing

**Solution**: 
- Run with verbose output: `pytest -v`
- Check test fixtures
- Verify test environment setup

### Getting Help

- **Documentation**: Check relevant docs
- **Discord**: Ask in #development channel
- **GitHub Issues**: Report bugs
- **GitHub Discussions**: Ask questions

---

## Recognition

### Contributor Recognition

We recognize contributors through:

- **Contributors list**: In repository README
- **Changelog**: Your contributions documented
- **Release notes**: Acknowledged in releases
- **Community shoutouts**: In Discord and social media

### Becoming a Maintainer

Contributors who consistently contribute:

1. Write high-quality code
2. Help review PRs
3. Mentor new contributors
4. Improve documentation
5. Fix critical bugs

Reach out to current maintainers if you're interested.

---

## License

By contributing to AI Suite V2, you agree that your contributions will be licensed under the [MIT License](../LICENSE).

---

## Acknowledgments

We deeply appreciate all our contributors:

### Core Team
- Project lead and architecture
- Core development team
- Documentation maintainers
- QA and testing team

### Community Contributors

Thank you to everyone who has contributed code, documentation, tests, bug reports, feature requests, and community support. Your contributions make this project possible.

Special thanks to the ComfyUI community for their amazing work and support.

---

## Thank You!

Thank you for taking the time to contribute to AI Suite V2! Your efforts help make this project better for everyone.

Questions? Check out:
- [Documentation](docs/)
- [Discord](https://discord.gg/aistudio)
- [GitHub Discussions](https://github.com/ai-suite/v2/discussions)

Happy coding! 🎨✨