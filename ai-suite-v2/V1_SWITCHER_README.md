# Local AI Switcher

This folder contains a local llama.cpp Vulkan server, ComfyUI with ROCm PyTorch,
and a small switcher that keeps only one GPU-heavy service running at a time.

Commands:

```bash
./ai-switch llama   # stop ComfyUI, start Qwen3-Coder-Next on llama.cpp
./ai-switch llama-heretic # start Qwen3.6-35B-A3B uncensored Heretic
./ai-switch chat    # start the Hilbert browser chat UI
./ai-switch hilbert # start both llama.cpp and Hilbert chat
./ai-switch hilbert-heretic # start Heretic plus Hilbert chat
./ai-switch comfy   # stop llama.cpp, start ComfyUI
./ai-switch studio  # start the Meshi-style browser UI for ComfyUI workflows
./ai-switch playwright # start local browser automation service
./ai-switch stop    # stop both
./ai-switch status  # show process status
./ai-switch diag    # print torch, ROCm, and Vulkan diagnostics
./ai-switch health  # print system health snapshot
./ai-switch monitor-start # log system health every 30s
./ai-switch monitor-stop  # stop health logging
./ai-switch display-safe-toggle # toggle COSMIC screen-off/suspend safety mode
./launch-switcher   # open the small GUI
```

Endpoints:

```text
llama.cpp: http://127.0.0.1:8080
ComfyUI:   http://127.0.0.1:8188
Hilbert:   http://127.0.0.1:8090
Studio:    http://127.0.0.1:8000
Playwright:http://127.0.0.1:8092
```

In v2, Studio opens the integrated launcher. Legacy v1 workflows are listed in
the `legacy-v1` category and queue through the migrated ComfyUI prompt runner.

The Playwright service exposes a localhost HTTP API for shared browser
automation:

```bash
curl -X POST http://127.0.0.1:8092/api/page \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","text":true,"links":true}'

curl -X POST http://127.0.0.1:8092/api/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"local AI news","limit":5}'
```

After the first install, log out and back in, or reboot, so membership in the
`render` and `video` groups applies to desktop shells.

If ROCm reports a gfx architecture mismatch on this AMD GPU/APU, edit
`config.env` and set `HSA_OVERRIDE_GFX_VERSION` to the value recommended for
your specific GPU.

The Heretic profile uses
`llmfan46/Qwen3.6-35B-A3B-uncensored-heretic-GGUF:Q4_K_M` by default. If the
configured `LLAMA_HERETIC_MODEL` path does not exist, llama.cpp will fetch from
Hugging Face on first launch.
# Historical V1 Notes

This file was copied from the old `local-ai-switcher` for reference only.
In AI Suite V2, `./ai-switch studio` starts the integrated v2 launcher on port `8000`; the old standalone Studio server on port `8091` is not the active path.
