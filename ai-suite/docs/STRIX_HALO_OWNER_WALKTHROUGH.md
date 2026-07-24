# Strix Halo Owner Walkthrough

This walkthrough is for owners of Strix Halo systems such as the Ryzen AI Max+ 395 / Radeon 8060S machines used with AI Suite V2. It explains the BIOS memory change, Linux performance tuning, local LLM routing, and verification steps needed to reproduce the local setup.

The tuning baseline comes from the `hogeheer499-commits/strix-halo-guide` findings, adapted to this suite and to Pop!_OS/systemd-boot.

## Goal

The target state is:

- Leave as much system RAM visible to Linux as possible.
- Give the AMD iGPU a large GTT/TTM memory aperture for LLM workloads.
- Run llama.cpp through Vulkan/RADV with full GPU layer offload.
- Keep Ollama available as an alternate route without replacing llama.cpp.
- Make the Studio Performance page show all green checks.

## Important Terminology

On Strix Halo, the BIOS UMA setting and the Linux GTT/TTM settings solve different parts of the same memory problem.

`UMA Frame Buffer` is the fixed memory carved out by firmware before Linux boots. It is always reserved for the GPU and is no longer available as normal system RAM.

`GTT` is the Linux AMDGPU graphics translation table aperture. It lets the GPU address system memory dynamically when workloads need more memory than the fixed UMA carve-out.

For local LLMs, the guide favors a small fixed UMA carve-out plus a large GTT/TTM aperture. That is not magic transfer from CPU to GPU. It is Linux exposing most RAM normally while still letting the iGPU map a large shared-memory working set through the driver.

## BIOS Setup

1. Enter BIOS or UEFI setup.
2. Find the AMD CBS/PBS graphics or UMA section.
3. Set `UMA Frame Buffer` to `512MB` if the firmware offers it.
4. If `512MB` is hidden or the vendor minimum is higher, set the lowest stable value the vendor exposes, commonly `2GB`.
5. Save and reboot.

On some Infplane/AIMAX firmware builds, the useful setting may be hidden or unstable. If a hidden BIOS section crashes when opened, do not keep forcing it from that menu. A crash at that point means the form is not safe on that firmware build.

For the local Infplane/AIMAX BIOS 3.05 situation:

- Infplane has not published a matching ROM.
- The AIMAX motherboard ROM is useful for inspection, but it is not automatically safe to flash onto an Infplane machine.
- UMAF/smoke payload crashes mean the next safe path is vendor firmware, a confirmed matching ROM, or a controlled external firmware workflow. Treat blind NVRAM edits as risky because a wrong variable can leave the machine unbootable.

## Linux Kernel Parameters

On Pop!_OS/systemd-boot systems, add the Strix Halo LLM memory parameters with:

```bash
sudo kernelstub -a "amdgpu.gttsize=131072 ttm.pages_limit=31457280 amdgpu.cwsr_enable=0"
```

On GRUB systems, first check `/etc/default/grub` for existing duplicates, then add:

```bash
sudo sed -i 's|^GRUB_CMDLINE_LINUX_DEFAULT="\(.*\)"|GRUB_CMDLINE_LINUX_DEFAULT="\1 amdgpu.gttsize=131072 ttm.pages_limit=31457280 amdgpu.cwsr_enable=0"|' /etc/default/grub
sudo update-grub
```

Reboot after changing kernel parameters.

After reboot, verify:

```bash
cat /proc/cmdline
cat /sys/class/drm/card*/device/mem_info_gtt_total 2>/dev/null
free -h
```

Expected signs:

- `/proc/cmdline` contains `amdgpu.gttsize=131072`, `ttm.pages_limit=31457280`, and `amdgpu.cwsr_enable=0`.
- GTT total is about `137438953472` bytes, which is 128 GiB.
- System RAM remains near the expected physical total, minus the BIOS UMA carve-out.

## AMDGPU Module Limits

Create the module limit file:

```bash
printf "%s\n" \
  "options amdgpu gttsize=122800" \
  "options ttm pages_limit=31457280" \
  "options ttm page_pool_size=31457280" | sudo tee /etc/modprobe.d/amdgpu_llm_optimized.conf
sudo update-initramfs -u -k all
```

Reboot after applying this.

Verify:

```bash
cat /etc/modprobe.d/amdgpu_llm_optimized.conf
```

## GPU Permissions

Make sure the owner account can access the GPU render nodes:

```bash
sudo usermod -aG render,video "$USER"
```

Log out and back in, then verify:

```bash
groups
```

The output should include `render` and `video`.

## Performance Governor

Install and activate `tuned`:

```bash
sudo apt install -y tuned
sudo systemctl enable --now tuned
sudo tuned-adm profile accelerator-performance
```

If `power-profiles-daemon.service` does not exist, that is fine. It means there is no service to disable on that install.

Verify:

```bash
tuned-adm active
```

Expected:

```text
Current active profile: accelerator-performance
```

## Vulkan/RADV Path

The guide baseline uses Mesa RADV for Vulkan. Verify:

```bash
vulkaninfo --summary
ls /usr/share/vulkan/icd.d/
```

Expected signs:

- `DRIVER_ID_MESA_RADV`
- `GFX1151`
- `/usr/share/vulkan/icd.d/radeon_icd.json`

If AMDVLK is installed and taking priority, Vulkan apps may choose the wrong path. Prefer RADV for this setup.

## llama.cpp Profile

For the main single-user route, `config.env` should contain:

```env
LLAMA_CTX=131072
LLAMA_GPU_LAYERS=999
LLAMA_EXTRA_ARGS=--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 1
```

Restart the local LLM service after changing it:

```bash
python3 ai_manager.py llama-restart
```

For multiple local tools/users, use the lower-context profile:

```env
LLAMA_CTX=65536
LLAMA_GPU_LAYERS=999
LLAMA_EXTRA_ARGS=--flash-attn on --device Vulkan0 --batch-size 2048 --ubatch-size 512 --parallel 4 --cont-batching
```

## Ollama Route

Ollama is an alternate route, not a replacement for llama.cpp. Keep both:

- Use llama.cpp when you want explicit Vulkan/RADV flags, long context, GGUF control, and tuned model slots.
- Use Ollama when you want simple model management, Open WebUI-style integrations, or a quick separate chat backend.

The suite expects:

```env
OLLAMA_HOST=127.0.0.1
OLLAMA_PORT=11434
OLLAMA_MODEL=qwen3:0.6b
```

If Ollama does not show GPU backend evidence, add a systemd override:

```bash
sudo mkdir -p /etc/systemd/system/ollama.service.d
printf "%s\n" \
  "[Service]" \
  "Environment=\"OLLAMA_VULKAN=1\"" \
  "Environment=\"OLLAMA_IGPU_ENABLE=1\"" \
  "Environment=\"HIP_VISIBLE_DEVICES=-1\"" \
  "Environment=\"OLLAMA_FLASH_ATTENTION=1\"" \
  "Environment=\"OLLAMA_CONTEXT_LENGTH=8192\"" \
  "Environment=\"AMD_VULKAN_ICD=RADV\"" \
  "Environment=\"VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/radeon_icd.json\"" \
  "Environment=\"OLLAMA_NUM_BATCH=512\"" \
  "Environment=\"OLLAMA_NUM_PARALLEL=1\"" | sudo tee /etc/systemd/system/ollama.service.d/override.conf
sudo systemctl daemon-reload
sudo systemctl restart ollama
```

Verify:

```bash
ollama list
journalctl -u ollama -n 120 --no-pager
```

Healthy logs usually show `ROCm0`, `gfx1151`, or another GPU backend marker. If ROCm is working, prefer that over forcing Vulkan.

## Model Routing In Studio

Studio now checks local LLM endpoints in this order:

1. Optional `LLM_ENDPOINTS` entries from `config.env`.
2. The sidecar endpoint.
3. The main llama.cpp endpoint.
4. The Ollama OpenAI-compatible endpoint.

Useful commands:

```bash
python3 ai_manager.py llama
python3 ai_manager.py ollama
python3 ai_manager.py chat
python3 ai_manager.py chat-ollama
python3 ai_manager.py status
```

The switcher exposes both llama.cpp and Ollama so owners can route to either backend when there is a reason.

## Studio Verification

Start Studio:

```bash
python3 launcher.py
```

Open:

```text
http://127.0.0.1:8000
```

Use the Performance page. The Strix Halo checks should cover:

- Strix Halo hardware
- Boot memory aperture
- AMDGPU module limits
- GPU access groups
- Performance governor
- Vulkan RADV path
- Ollama GPU backend
- llama-server profile

From a terminal, the same summary can be checked with:

```bash
curl -fsS http://127.0.0.1:8000/api/performance/strix-halo
curl -fsS http://127.0.0.1:8000/api/performance/models
```

## Troubleshooting

If a BIOS section crashes, stop using that hidden section on that firmware build. Use the lowest visible UMA setting, document the firmware version, and wait for a vendor-matched ROM or confirmed recovery method.

If the Performance page says reboot commands are orange, check whether the kernel parameters and modprobe file are already active. When they are active, the reboot/admin command rows should no longer be highlighted as pending.

If `power-profiles-daemon.service` is missing, ignore that line and continue with `tuned`.

If GTT total is not 128 GiB after reboot, check `/proc/cmdline`, rebuild initramfs after the modprobe file, and confirm the system actually booted the updated kernel entry.

If Ollama is online but shows no GPU evidence, inspect:

```bash
systemctl cat ollama
journalctl -u ollama -n 120 --no-pager
```

If Hugging Face models remain missing after a download, verify the actual files first:

```bash
find models -type f -name "*.gguf" | sort
```

Some catalogue rows may point to private, renamed, gated, or removed repositories. In that case the suite can only mark them installed after the files exist locally.

## Owner Handoff Checklist

- BIOS UMA set to `512MB`, or lowest stable vendor-exposed value.
- `/proc/cmdline` contains the three AMDGPU/TTM parameters.
- `/etc/modprobe.d/amdgpu_llm_optimized.conf` contains the AMDGPU/TTM limits.
- User belongs to `render` and `video`.
- `tuned-adm active` reports `accelerator-performance`.
- `vulkaninfo --summary` shows Mesa RADV on GFX1151.
- `config.env` contains the desired llama.cpp profile.
- Ollama is installed only as an alternate backend and has GPU evidence when used.
- Studio Performance page reports all checks green.
