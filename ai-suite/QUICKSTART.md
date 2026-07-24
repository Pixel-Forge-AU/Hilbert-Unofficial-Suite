# AI Suite V2 - Quickstart Guide

Ready to start creating with AI? This guide will have you up and running in minutes!

## 🚀 Quick Start

### 1. Prerequisites

Before you begin, make sure your system meets these requirements:

- **Python**: Version 3.10 or higher
- **RAM**: 8GB minimum (16GB+ recommended)
- **GPU**: NVIDIA GPU with 8GB+ VRAM recommended (works without GPU, but slower)
- **Storage**: 20GB+ free space for models

Check your Python version:
```bash
python3 --version
```

### 2. Installation

Clone the repository and install dependencies:

```bash
# Navigate to your desired directory
cd /workspace/repos

# Clone the repository
git clone https://github.com/your-org/ai-suite-v2.git
cd ai-suite-v2

# Install dependencies
pip install -r requirements.txt
```

### 3. Basic Configuration

Create a models directory and configure your settings:

```bash
# Create models directory
mkdir -p models

# Create configuration (optional - uses defaults if not present)
cp config/suite.yaml.example config/suite.yaml
```

**Note**: You don't need API keys! This runs locally on your machine.

### 4. Launch the Web Interface

Start the launcher with a web interface:

```bash
python3 launcher.py
```

The web interface will be available at: **http://127.0.0.1:39000**

💡 **Tip**: Use `python3 launcher.py --help` to see all available options.

### 5. Your First Workflow

Let's run a simple character sheet workflow:

```bash
# View available workflows
python3 launcher.py list

# Run a workflow with custom parameters
python3 launcher.py run character.character-sheet \
  prompt="a futuristic cyberpunk character with neon lights" \
  width=1024 \
  height=768 \
  steps=30
```

### 6. Exploring Workflows

The platform includes 50+ workflows across 15+ categories:

```bash
# List all workflows
python3 launcher.py list

# List workflows in a category
python3 launcher.py list --category character

# Show workflow details
python3 launcher.py show character.character-sheet

# Run a workflow with presets
python3 launcher.py run character.character-sheet \
  prompt="a fantasy elf queen" \
  preset=detailed
```

**Popular categories:**
- `character` - Character sheets, expressions, identity
- `core-generation` - Basic image generation
- `image-editing` - Inpainting, outpainting, editing
- `video-animation` - Image-to-video, animation
- `horror-gore` - Special effects
- `materials` - Texture and material generation

### 7. Troubleshooting

**Issue: "Module not found" errors**
```bash
pip install -r requirements.txt
```

**Issue: "ComfyUI not connected"**
- Ensure ComfyUI is running on port 8188 (or update config/suite.yaml)
- Or use workflows that don't require ComfyUI

**Issue: Out of memory**
- Reduce `width` and `height` parameters
- Use fewer `steps`
- Enable low VRAM mode in config

**Issue: No workflows showing**
- Verify you're in the repository root directory
- Check that `workflows/` and `packs/` directories exist
- Run `python3 launcher.py config` to see configuration

### 📚 Next Steps

- **Full Documentation**: See [docs/README.md](docs/README.md) for detailed guides
- **Workflow Registry**: Explore workflows in [registry/](registry/)
- **Custom Workflows**: Learn to create your own in [CONTRIBUTING.md](CONTRIBUTING.md)
- **Community**: Join our Discord for support and sharing

### 💡 Pro Tips

1. **Start small**: Begin with smaller image sizes (512x512) to test workflows
2. **Use presets**: Quick presets are faster for testing
3. **Check logs**: `logs/` directory contains detailed operation logs
4. **Batch processing**: Add `batch_size=N` to generate multiple images at once

---

**Happy Creating!** 🎨✨

For support and questions, check the full documentation or join our community.

### Port reference

| Port | Service |
|---|---|
| 39000 | Studio |
| 39001 | llama.cpp |
| 39002 | qwen-sidecar |
| 39003 | ComfyUI |
| 39004 | Chat |
| 39005 | Playwright |
| 39006 | Planner API |
| 39007 | Orchestrator API |
| 39008 | Genesis Runtime |
| 39009 | OpenHands agent-server |
| 39010/39011 | Planner Postgres/Redis (docker) |
| 39012/39013 | Orchestrator Postgres/Redis (docker) |
| 39014/39015 | Orchestrator MinIO (docker, unused) |

See `docs/SERVICES.md` for the full picture.
11434	Ollama — unchanged, 