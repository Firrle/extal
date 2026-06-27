Bundled Piper assets live here.

Expected layout:

- linux/bin/piper
- mac/bin/piper
- windows/bin/piper.exe
- models/<voice>.onnx
- models/<voice>.onnx.json

Current Linux install in this repo:

- `linux/bin/piper` is a wrapper script.
- The wrapper executes the bundled Python runtime at `backend/python/linux/bin/python3` with `-m piper`.
- `piper-tts` and its Python dependencies are installed into `backend/python/linux/lib/python3.12/site-packages`.
- A default voice is installed at `models/en_US-lessac-medium.onnx` with its matching `.json` config and `MODEL_CARD`.

Runtime behavior:

- The Electron main process resolves the Piper binary from this folder at runtime.
- Packaged builds rely on `asarUnpack` so these files stay executable outside `app.asar`.
- The app scans `models/` for `.onnx` files and exposes them in the TTS settings UI.

Notes:

- Keep each model config JSON next to its matching `.onnx` file.
- If multiple models are bundled, the first discovered model becomes the default until the user chooses another one in settings.
- Linux and macOS launchers should have executable permissions before packaging.