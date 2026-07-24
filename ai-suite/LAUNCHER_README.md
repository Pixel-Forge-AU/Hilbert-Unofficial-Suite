# AI Suite V2 Launcher

A Python launcher for the AI Suite V2 web interface with both Flask web interface and CLI capabilities.

## Features

### Web Interface
- Dashboard with workflow grid view
- Category filtering and search
- Workflow details view
- Launch workflow modal

### CLI Interface
- List available workflows
- Launch workflows by ID
- Show workflow details
- Monitor running jobs

### Configuration Management
- Load suite.yaml configuration
- Model path resolution
- Hardware profile selection
- Feature flag handling

### Workflow Management
- Registry loading from registry.json
- Workflow dependency resolution
- Model availability checking
- Hardware compatibility validation

### Job Queue
- Track running and queued workflows
- Progress monitoring
- Result management

## Installation

```bash
pip install -r requirements.txt
```

## Usage

### Web Interface

```bash
python3 launcher.py
```

Or with custom host/port:

```bash
python3 launcher.py --host 0.0.0.0 --port 8000
```

### CLI Commands

```bash
# Show version
python3 launcher.py --version

# List workflows
python3 launcher.py list

# Show workflow details
python3 launcher.py show <workflow-id>

# Run workflow
python3 launcher.py run <workflow-id> --prompt "your prompt"

# Monitor jobs
python3 launcher.py jobs

# Show configuration
python3 launcher.py config

# Show categories
python3 launcher.py categories

# Control migrated local runtime services
python3 launcher.py service status
python3 launcher.py service llama
python3 launcher.py service comfy
python3 launcher.py service studio
python3 launcher.py service stop
```

The migrated v1 switcher is also available as `./launch-switcher` or `./ai-switch <command>`.
`./ai-switch studio` starts this v2 launcher, not the old standalone Studio server.
The v1 workflow JSON files and controls are loaded from `legacy-workflows/` under the `legacy-v1` category.

## Configuration

Configuration is loaded from `config/suite.yaml` in the project directory.

Key settings include:
- ComfyUI connection settings
- Launcher server settings
- Default generation parameters
- Path configurations

## API Endpoints

- `GET /` - Web interface
- `GET /api/workflows` - List all workflows
- `GET /api/workflows/<workflow_id>` - Get workflow details
- `GET /api/jobs` - Monitor jobs
- `POST /api/jobs` - Launch new job
- `GET /api/services` - Show migrated switcher service status
- `POST /api/services/<command>` - Run a migrated switcher command
- `GET /api/config` - Get configuration
- `GET /api/categories` - List categories

## Project Structure

```
ai-suite-v2/
├── launcher.py           # Main launcher
├── requirements.txt      # Dependencies
├── config/              # Configuration files
│   ├── suite.yaml       # Main configuration
│   ├── model-paths.yaml # Model paths
│   ├── hardware-profiles.yaml # Hardware profiles
│   ├── categories.yaml  # Categories
│   └── feature-flags.yaml # Feature flags
├── registry/            # Workflow registry
│   └── registry.json    # Workflow definitions
├── packs/               # Workflow packs
├── legacy-workflows/    # Migrated v1 workflow JSON files
└── shared/              # Shared resources
```

## License

MIT
