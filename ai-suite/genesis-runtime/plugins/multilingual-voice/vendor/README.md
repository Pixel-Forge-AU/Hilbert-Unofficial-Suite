Optional bundled binaries and models can live here.

The plugin checks these paths after configured/env paths and before falling back
to PATH:

- `whisper/windows-x64/whisper-cli.exe`
- `whisper/linux-x64/whisper-cli`
- `whisper/macos/whisper-cli`
- `ffmpeg/windows-x64/ffmpeg.exe`
- `ffmpeg/linux-x64/ffmpeg`
- `ffmpeg/macos/ffmpeg`
- `models/ggml-base.bin`

Models are not committed because they are large. The plugin UI can download the
default `ggml-base.bin` model into plugin runtime data instead.
