# Extal World Builder

Extal World Builder is an Electron-based desktop app for building and organizing worldbuilding material for the Extal setting. The project combines a desktop shell, a browser-based frontend, editor tooling, themes, mapping support, and optional local AI/TTS helpers.

## What It Includes

- Rich editor interface built around TinyMCE
- Worldbuilding-focused frontend UI and theme system
- Electron desktop packaging for Linux, Windows, and macOS
- Optional local helper scripts for AI-related workflows
- Optional Piper TTS integration

## Project Structure

- `main.js` — Electron main process
- `preload.js` — Electron preload bridge
- `frontend/` — UI, editor integration, assets, themes, maps, and browser-side scripts
- `backend/` — Python helpers, setup docs, and related tooling
- `tts/` — Piper TTS integration code and model metadata
- `scripts/` — build and utility scripts
- `themes/` — theme definitions

## Requirements

- Node.js
- npm

Some packaging flows also download or expect additional bundled assets during build time.

## Run In Development

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm start
```

## Build

Build scripts:

```bash
npm run dist
npm run dist:linux
npm run dist:win
npm run dist:mac
```

Before packaging, the project generates font CSS and may download a required wheel for local runtime support.

## Notes About Large Assets

This repository is intentionally set up to keep generated output and bundled runtime payloads out of Git, including:

- `node_modules/`
- `dist/`
- `build/`
- `squashfs-root/`
- `backend/python/`
- bundled wheel files
- large Piper model binaries

That keeps the GitHub repo manageable while still preserving the app source and documentation.

## License

This project is licensed under the MIT License. See [LICENSE](./LICENSE).
