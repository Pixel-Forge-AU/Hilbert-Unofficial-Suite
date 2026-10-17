# AI Suite - User Guide

## Table of Contents

- [Introduction](#introduction)
- [Installing and Launching AI Suite](#installing-and-launching-ai-suite)
- [Browsing and Selecting Workflows](#browsing-and-selecting-workflows)
- [Configuring Models and Settings](#configuring-models-and-settings)
- [Running Workflows](#running-workflows)
- [Understanding Workflow Parameters](#understanding-workflow-parameters)
- [Editing Video in Workspace](#editing-video-in-workspace)
- [Troubleshooting Common Issues](#troubleshooting-common-issues)
- [Best Practices](#best-practices)

---

## Introduction

This user guide provides comprehensive instructions for using AI Suite. Whether you're a beginner or an experienced AI artist, this guide will help you get the most out of the platform.

AI Suite is a powerful platform for generating AI artwork, editing images, and creating animations using ComfyUI workflows. This guide will walk you through every step of the process.

### What You'll Learn

- How to install and launch AI Suite
- How to browse and select workflows
- How to configure models and settings
- How to run workflows and manage jobs
- How to understand and use workflow parameters
- How to troubleshoot common issues

---

## Installing and Launching AI Suite

### Prerequisites

Before installing AI Suite, ensure you have:

- **Python 3.9-3.11** installed
- **vulkan SDK** https://www.lunarg.com/products/vulkan-sdk/
- **At least 16 GB RAM**
- **At least 50 GB free storage space**

### Step 1: Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/ai-suite.git
cd ai-suite
```

### Step 2: Install Dependencies

```bash
pip install -r requirements.txt
```

This will install:
- Flask (web server)
- PyYAML (configuration parsing)
- Requests (HTTP client)
- PIL (image processing)

### Step 3: Configure Model Paths (Optional)

Edit `config/model-paths.yaml` to specify your model locations:

```yaml
# Example model-paths.yaml
model_paths:
  checkpoints:
    - /path/to/stable-diffusion-models
    - /path/to/flux-models
  vae:
    - /path/to/vae-models
  loras:
    - /path/to/loras
  controlnets:
    - /path/to/controlnet-models
```

### Step 4: Launch AI Suite

```bash
python launcher.py
```

You should see output like:

```
AI Suite Launcher v3.1.0
Loading configuration...
Loading registry...
Starting server on http://127.0.0.1:8000
```

### Step 5: Access the Web Interface

Open your browser and navigate to:

```
http://127.0.0.1:8000
```

### Alternative: Command Line Launch

For headless servers or advanced usage:

```bash
# Start server without GUI
python launcher.py --host 0.0.0.0 --port 8000

# Run in debug mode
python launcher.py --debug

# Run with specific configuration
python launcher.py --config /path/to/custom-suite.yaml
```

---

## Browsing and Selecting Workflows

### Using the Web Interface

Once the launcher is running, you'll see the main interface with:

1. **Sidebar**: Categories and filters
2. **Main Area**: Workflow cards
3. **Top Bar**: Search and actions

### Browsing by Category

Categories are listed in the sidebar. Click on a category to view its workflows:

- **Core Generation**: Text-to-image, image-to-image, inpainting, etc.
- **Character**: Character sheets, expressions, poses, etc.
- **Image Editing**: Background removal, object removal, etc.
- **Horror & Gore**: Battle damage, zombie progression, etc.
- **Video & Animation**: Image-to-video, talking head, etc.
- **3D**: Image-to-3D, multi-view, etc.

### Searching for Workflows

Use the search bar to find specific workflows:

- Type workflow keywords (e.g., "inpainting", "character", "upscale")
- Use tags for more specific searches (e.g., "face", "hand", "low-vram")

### Filtering Workflows

Use filters to narrow down workflows:

- **By Status**: Stable, Experimental, Deprecated
- **By Hardware**: Low VRAM, Medium VRAM, High VRAM
- **By Category**: Select from dropdown
- **By Tag**: Select relevant tags

### Understanding Workflow Cards

Each workflow card displays:

- **Name**: Human-readable workflow name
- **Description**: Brief overview of functionality
- **Thumbnail**: Example output (if available)
- **Status**: Stability indicator (green = stable, yellow = experimental)
- **Hardware**: VRAM requirement indicator
- **Tags**: Relevant tags for the workflow

### Selecting a Workflow

To select a workflow:

1. Click on the workflow card
2. Review the details in the workflow view
3. Configure inputs and settings
4. Click "Run Workflow"

---

## Configuring Models and Settings

### Accessing Workflow Settings

1. Select a workflow
2. Click "Configure" or "Run Workflow"
3. Fill in required parameters

### Model Configuration

#### Selecting Checkpoint Models

Most workflows support multiple model families. Select your model from the dropdown:

- **Flux**: For Flux-based models
- **SDXL**: For Stable Diffusion XL models
- **SD 1.5**: For Stable Diffusion 1.5 models
- **SD 3**: For Stable Diffusion 3 models

#### Loading Custom Models

If you have custom models:

1. Ensure they're in a configured model path
2. Refresh the model list
3. Select your custom model

#### Model Fallback

If your preferred model isn't available:

1. The workflow will try alternative models from the same family
2. If no models are available, you'll receive a clear error message
3. Follow the installation guidance to add missing models

### Preset Configuration

Presets provide quick configuration for common scenarios:

#### Quality Presets

| Preset | Steps | CFG | Resolution | Use Case |
|--------|-------|-----|------------|----------|
| Fast | 8-12 | 5.0 | 512-768 | Quick drafts |
| Balanced | 20-30 | 7.0 | 768-1024 | General use |
| High Quality | 30-50 | 7.5-8.0 | 1024-1536 | Final outputs |
| Extreme | 50+ | 8.0+ | 1536+ | Maximum quality |

#### Hardware Presets

| Preset | VRAM | Batch Size | Optimization |
|--------|------|------------|--------------|
| Low VRAM | < 8 GB | 1 | CPU offload |
| Medium VRAM | 8-16 GB | 2-4 | Balanced |
| High VRAM | 16+ GB | 4+ | Full precision |

### Advanced Settings

#### Generation Parameters

- **Width/Height**: Output dimensions (multiples of 64)
- **Steps**: Number of inference steps (higher = more detail, longer time)
- **CFG/Guidance**: How strictly to follow the prompt (5-15 typical range)
- **Sampler**: Algorithm for generation (Euler, DPM++ 2M, etc.)
- **Scheduler**: Step scheduling method
- **Batch Size**: Number of images to generate (higher = more VRAM)

#### Quality Control Settings

- **Enable Quality Control**: Check output quality
- **Minimum Score**: Threshold for accepting outputs
- **Maximum Retries**: Number of retry attempts
- **Face Restoration**: Automatically fix faces
- **Hand Repair**: Automatically fix hands

---

## Running Workflows

### Starting a Workflow

1. **Configure the workflow** with your desired settings
2. **Click "Run Workflow"**
3. **Monitor the progress** in the job queue

### Understanding the Job Queue

The job queue shows:

- **Job ID**: Unique identifier for the job
- **Workflow**: Name of the workflow being run
- **Status**: Queued, Running, Completed, Failed
- **Progress**: Percentage completion
- **Time**: Estimated time remaining

### Monitoring Progress

During workflow execution:

1. **Real-time progress** is displayed
2. **Intermediate outputs** may be shown
3. **Console output** shows detailed logs
4. **Error messages** are highlighted

### Accessing Results

When a workflow completes:

1. **Results appear** in the output gallery
2. **Click to preview** individual images
3. **Download buttons** save to your device
4. **Metadata** includes generation parameters

### Batch Processing

To generate multiple variations:

1. Set **Batch Size** > 1
2. Use different seeds for variety
3. Enable "Random Seed" for automatic variation
4. Results are grouped by seed

---

## Understanding Workflow Parameters

### Input Types

#### Text Inputs

- **Prompt**: Positive description of desired output
- **Negative Prompt**: Elements to avoid in output
- **Style Prompt**: Artistic style instructions
- **Subject Prompt**: Specific subject details

#### Image Inputs

- **Source Image**: Input for image-to-image workflows
- **Mask Image**: Region to modify
- **Control Image**: Guidance for controlnet

#### Numeric Inputs

- **Float**: Decimal values (e.g., strength, scale)
- **Integer**: Whole numbers (e.g., steps, seed)
- **Range**: Values with minimum/maximum constraints

#### Model Inputs

- **Checkpoint**: Main model for generation
- **VAE**: Decoder model for image quality
- **LoRA**: Lightweight model additions
- **ControlNet**: Guidance models

### Parameter Best Practices

#### Prompt Engineering

1. **Be Specific**: Describe what you want
2. **Use Style Words**: Include artistic style
3. **Negative Prompts**: Specify what to avoid
4. **Structure Prompts**: Use commas to separate concepts

Example prompt:
```
portrait of a fantasy warrior, detailed armor, epic lighting, cinematic composition, masterpiece, 8k, highly detailed
```

Example negative prompt:
```
blurry, low quality, deformed, bad anatomy, extra limbs, disfigured, low contrast
```

#### Workflow-Specific Parameters

Each workflow has unique parameters. Check the workflow documentation for:

- **Input requirements**
- **Recommended values**
- **Advanced options**
- **Example configurations**

---

## Editing Video in Workspace

The **Workspace** tab (Creative group) is a multitrack editor for cutting your Library videos,
images, and audio together and exporting an MP4. It needs the Workspace engine running; if the
tab says the engine is offline, press **Start engine** (or run `./ai-switch concat`).

### Projects

- **New** creates a project (choose landscape, vertical, square, or 4K, and the frame rate).
  Projects are private to your identity.
- The project list remembers the last project you opened in this browser.
- **Save** (Ctrl+S) writes the project. The toolbar shows *Unsaved changes* until you do. If
  you switch projects with unsaved changes, you are asked to save or discard them.
- **Duplicate** copies the saved project (and anything uploaded into it) into a new project of
  yours, named "... copy". Use it to start a new edit from an earlier one.
- **Save as template** keeps this edit's layout, titles, effects, keyframes, and timing for reuse.
  Tick which media become **slots** (replaced each time); everything else is copied into the template.
  **From template…** shows your templates; pick one, choose Library media for each slot, and a
  new project is made. Templates are private to you, and deleting one leaves projects made from it intact.
- **Delete** removes the project and anything uploaded into it. Library items and finished
  exports are kept.

### Adding media

- **Library** opens a list of your own and shared Library videos, images, and audio; click an
  item to add it to the project's media bin.
- **Upload** adds a file from your computer to the project only (it does not appear in Library).
- Drag a bin item onto a track, or double-click it to place it at the playhead.

### Editing

| Do this | How |
|---|---|
| Move a clip | Drag it (also up/down to another track). Clips snap to the playhead and to other clips' edges. |
| Trim | Drag a clip's left or right edge |
| Split | Put the playhead inside a clip and press **S** (or **Split**). With a clip selected, only that clip is split |
| Delete a clip | Select it, press **Delete** |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y) |
| Opacity, volume, fades, mute | Select a clip and use the inspector on the right |
| Tracks | **Add track**; each track has show/hide, mute, and remove (×). Higher tracks draw over lower ones |

Clips on one track cannot overlap. A move that would overlap does nothing and says so.

### Titles, position, transitions, and effects

- **Add title** places a 4-second title at the playhead on a track above the picture. Select it
  to edit the words, size, colour, weight, alignment, italic, shadow, and an optional background.
- **Position** (any picture or title): scale, horizontal, vertical (positive moves down), and
  rotation; **Reset** puts it back. Use it with a higher track for picture-in-picture.
- **Transition in**: pick one of Concat's transitions (dissolves, wipes, iris, push, and more) and
  its length. It plays in the seconds *before* the clip starts, revealing it over what is
  underneath, and is drawn as a striped band on the timeline. The clip's source needs that much
  footage before its in-point (a clip split from a longer one has it).
- **Picture effects**: add effects (blur, glow, vignette, chroma key, ...) and looks (mono,
  film, golden hour, ...) from the **Add…** menu. Each has an on/off box, its own sliders, and ×
  to remove it. Order matters; new ones go last.
- **Audio effects** (video and audio clips): echo, reverb rooms, voice enhance, denoise, and
  others, with the same controls.

- **Picture** (video and image clips): crop each edge, blend mode (multiply, screen, add,
  lighten, darken), and horizontal/vertical flip.

All of these show in the paused exact frame and in the export, not in the approximate playback.

### Keyframes

Scale, horizontal, vertical, rotation, opacity, and volume can change over a clip:

1. Select the clip and put the playhead where the change should start; press the ◇ beside the
   property to set a keyframe there (it turns ◆).
2. Move the playhead and either press ◇ again or simply move the slider: once a property has
   keyframes, moving its slider sets a keyframe at the playhead.
3. With the playhead on a keyframe, choose how it is approached (linear, ease in, ease out, ease
   in and out). **Previous key / Next key** jump between keyframes; **Clear** removes all of a
   property's keyframes; pressing ◆ removes the one at the playhead.

Picture effects' sliders (a vignette's strength, a blur's amount, and so on) have the same ◇
controls, so an effect can fade in, grow, or change over the clip.

Keyframes show as small diamonds on the selected clip. The sliders show the value at the
playhead, and **Reset** in Position only resets properties that have no keyframes.
Undo history covers the current session; after the engine restarts, a reopened project starts
with no undo history.

### Captions

**Captions…** (on the timeline bar, or in the inspector of a clip with sound) transcribes speech
into captions:

- Choose the clip, the accuracy (*Base* is faster, *Small* is more accurate), the language (or
  detect it), placement (bottom, middle, top), size, and whether to put a box behind the words.
- Speech recognition runs on this machine; nothing is uploaded. Progress shows in the toolbar
  with a Cancel button.
- Each line becomes a title on a track above the picture, breaking at sentences, pauses, and
  about 42 characters. All of them are added as one step, so a single **Undo** removes them.
  Select any caption to fix its words or style.

### Preview

- **Paused**, the monitor shows the *exact frame* the export will produce at the playhead
  (badge: **Exact frame**).
- **Playing** (Space) plays the source media under the playhead so you can judge timing. It is
  labelled **Approximate preview**: it shows only the topmost clip, without layering, opacity,
  or fades. Pause to see the exact frame, and check the exported file for final review.
- Use ←/→ to step one frame, Shift+←/→ for one second, Home to jump to the start; click or drag
  in the ruler to scrub.

### Exporting

**Export MP4** renders the timeline at its own size (or a smaller one) as H.264/AAC. Progress
shows in the toolbar, and **Cancel** stops it. One export runs at a time across all users. When
it finishes, the file is in Library under **Video** (Mine), named after the project. An export
keeps running if you refresh the page.

## Troubleshooting Common Issues

### Issue: Workflow Not Loading

**Symptoms**:
- Workflow card appears blank
- "Error loading workflow" message
- Empty workflow details

**Solutions**:

1. **Check Registry**:
   ```bash
   python tools/build_registry.py
   ```

2. **Validate Manifest**:
   ```bash
   python tools/validate_workflows.py --workflow <workflow_id>
   ```

3. **Check File Permissions**:
   Ensure the launcher can read workflow files

### Issue: Missing Models

**Symptoms**:
- "Missing required model" error
- Workflow fails to start
- Model dropdown is empty

**Solutions**:

1. **Install Required Models**:
   - Download models to configured paths
   - Refresh the model list
   - Restart the launcher

2. **Check Model Paths**:
   ```yaml
   # config/model-paths.yaml
   model_paths:
     checkpoints:
       - /correct/path/to/models
   ```

3. **Use Recommended Models**:
   - Check workflow documentation
   - Use tested model combinations

### Issue: GPU Out of Memory

**Symptoms**:
- "CUDA out of memory" error
- Workflow crashes mid-generation
- System becomes unresponsive

**Solutions**:

1. **Reduce Batch Size**:
   Set batch size to 1

2. **Lower Resolution**:
   Use smaller width/height values

3. **Enable Low VRAM Mode**:
   - In workflow settings
   - Select "Low VRAM" preset

4. **Close Other Applications**:
   Free up GPU memory

5. **Use CPU Offload**:
   Enable in advanced settings

### Issue: Slow Performance

**Symptoms**:
- Long generation times
- Stalled progress
- High system load

**Solutions**:

1. **Use Faster Presets**:
   Try "Fast" or "Balanced" preset

2. **Reduce Steps**:
   Lower step count (12-20 for drafts)

3. **Optimize Hardware**:
   - Ensure GPU drivers are updated
   - Close background applications
   - Check for system bottlenecks

### Issue: Poor Quality Outputs

**Symptoms**:
- Blurry or low quality
- Artifacts and distortions
- Doesn't match prompt

**Solutions**:

1. **Increase Quality Settings**:
   - Higher step count (30-50)
   - Higher CFG value (7-8)
   - Better sampler (DPM++ 2M)

2. **Improve Prompt**:
   - More specific descriptions
   - Better negative prompts
   - Include quality keywords

3. **Try Different Model**:
   - Use high-quality checkpoint
   - Add LoRA for style
   - Test different models

### Issue: Custom Nodes Missing

**Symptoms**:
- "Missing custom node" error
- Workflow fails with dependency error
- Nodes not found

**Solutions**:

1. **Install Custom Nodes**:
   ```bash
   # In ComfyUI directory
   git clone https://github.com/ltdrdata/ComfyUI-Manager
   ```

2. **Check Node Versions**:
   Ensure compatible versions are installed

3. **Restart ComfyUI**:
   Restart ComfyUI after node installation

### Issue: Connection to ComfyUI Failed

**Symptoms**:
- "Failed to connect to ComfyUI" error
- Workflow hangs
- No progress

**Solutions**:

1. **Start ComfyUI**:
   ```bash
   cd ComfyUI
   python main.py --listen 0.0.0.0 --port 39003
   ```

2. **Check ComfyUI Settings**:
   Ensure ComfyUI is running and accessible

3. **Network Configuration**:
   - Verify ComfyUI host/port in settings
   - Check firewall settings
   - Test network connectivity

---

## Best Practices

### Workflow Design

1. **Start Simple**: Begin with basic workflows
2. **Test Incrementally**: Add complexity gradually
3. **Document Settings**: Note successful configurations
4. **Use Presets**: Save and share successful setups

### Model Management

1. **Organize Models**: Keep models in structured directories
2. **Version Control**: Note model versions for reproducibility
3. **Backup Models**: Maintain backups of important models
4. **Test Compatibility**: Verify model combinations work

### Performance Optimization

1. **Monitor VRAM**: Watch GPU memory usage
2. **Optimize Batch Size**: Balance speed and memory
3. **Use Appropriate Resolution**: Match resolution to model
4. **Enable Caching**: Use ComfyUI caching features

### Output Management

1. **Organize Outputs**: Use clear naming conventions
2. **Metadata Preservation**: Keep generation parameters
3. **Backup Important Results**: Store successful outputs
4. **Batch Organization**: Group related outputs

### Troubleshooting Checklist

Before seeking help, check:

- [ ] All required models are installed
- [ ] All required custom nodes are installed
- [ ] ComfyUI is running and accessible
- [ ] Sufficient GPU memory is available
- [ ] Configuration files are valid
- [ ] Workflow files are not corrupted
- [ ] System meets minimum requirements

---

## Getting Help

### Documentation Resources

- **Main Documentation**: `/docs/` directory
- **Workflow Documentation**: Each workflow's README.md
- **Example Workflows**: `/example/` directory

### Community Resources

- **GitHub Issues**: Report bugs and request features
- **Discussions**: Community discussions and tips
- **Examples**: Share and find workflow configurations

### Support Channels

- **Documentation**: See this guide and linked resources
- **Issue Tracker**: Submit detailed bug reports
- **Discussions**: Community support and tips

---

*For more detailed information on specific workflows, check the individual workflow documentation in the `packs/` directory.*
