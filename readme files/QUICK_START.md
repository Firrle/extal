# Extal World Builder - User Quick Start Guide

## What You Can Do

In the current build you can:

- Create and edit world Topics, Characters, Events, and Maps
- Use built-in linking and backlinks to move between connected entities
- Run offline spelling and grammar checks with LanguageTool
- Rewrite text locally with your installed GGUF model
- Read selected text aloud with Text to Speech using bundled Piper or system voices
- Export speech as WAV when using bundled Piper
- Save Topic and Character templates in Settings
- Customize the UI theme and save/import/export color schemes

---

## Quick Start

### 1. Launch the App
```bash
npm start
```

### 2. Open or Create Content
- Use the left navigation to choose Topics, Characters, Timeline, or Maps
- Select an existing item or create a new one
- Changes save automatically as you work

### 3. Use the Main Toolbar
The editor toolbar includes several editing and review tools:

- `ABC✓` - Open offline LanguageTool spelling and grammar checks
- `AI✎` - Open local AI Rewrite
- `TTS` - Read the current selection or active editor aloud
- `WAV` - Save selected text or the active editor as a WAV file with bundled Piper
- `🔗` - Insert links
- `🖼️` controls - Insert and position images

---

## Settings

Open **Settings** from the top toolbar to access the current user-facing configuration areas.

### Theme Customization

- Choose from built-in themes
- Customize individual UI colors
- Export and import theme JSON files
- Reset colors to the selected theme defaults

### Topic Templates
In Settings you can manage default templates for Topics:

- Choose the default template used for new topics
- Apply the selected template to the current topic
- Save the current topic as a custom template
- Delete a selected custom topic template

### Character Templates
The same workflow is available for Characters:

- Choose the default template for new characters
- Apply the selected template to the current character
- Save the current character as a custom template
- Delete selected custom character templates

### Text to Speech
Settings includes a full TTS section.

You can configure:

- **Provider**: Bundled Piper or System Voices
- **System Voice**: Pick an installed OS voice when using the system provider
- **Piper Model**: Choose from bundled Piper voices discovered in `tts/piper/models`
- **Delivery Preset**: `Raw`, `Natural`, or `Narration`
- **Grammar Cleanup**: `Off`, `Minimal`, or `Strict`
- **Pause Strength**: Controls how strongly Natural and Narration add pause-friendly punctuation
- **Speed**: Playback speed for both providers
- **Pitch**: Playback pitch for live playback
- **Preview Voice**: Test the current TTS configuration before using it in the editor

### TTS Notes

- Bundled Piper voices are stored inside the app and exposed automatically in Settings
- `Natural` and `Narration` improve pacing for read-aloud text
- Grammar cleanup uses the app's local LanguageTool integration when available
- WAV export is available only for bundled Piper
- Piper speed is rendered without shifting pitch during normal use

---

## Spelling And Grammar

Click `ABC✓` in the editor toolbar to open **LanguageTool (Offline)**.

Current workflow:

- Set the language code, such as `en-US`
- Optionally choose an embedded LanguageTool server JAR path
- Start or stop the local LanguageTool server from the modal
- Check the current editor or just the current selection
- Download or update the LanguageTool bundle from the modal
- Maintain a custom dictionary and clear it when needed
- Apply individual suggested replacements directly from results

Use this when you want deterministic, local spelling and grammar cleanup before rewriting or TTS.

---

## AI Rewrite

Click `AI✎` in the toolbar to open **AI Rewrite (Local Model, Offline)**.

What it does:

- Uses your installed GGUF model locally
- Sends no text online
- Shows the active local model and whether local AI is enabled
- Supports two modes:
  - `Fix grammar (minimal)`
  - `Rewrite (preserve voice)`
- Lets you adjust rewrite strength
- Can rewrite the current selection or the current paragraph
- Lets you review the suggestion before applying or copying it

This is the best fit for line-level cleanup when you want more stylistic help than LanguageTool alone.

---

## Text To Speech And WAV Export

The toolbar exposes two related actions:

- `TTS` reads the current selection, or the active editor if nothing is selected
- `WAV` saves speech output as a WAV file using bundled Piper

Best use cases:

- Proof-listen topic notes
- Preview the effect of punctuation and delivery pacing
- Export narration drafts for review outside the app

For best results:

- Use **Natural** or **Narration** in Settings for prose
- Turn on **Minimal** or **Strict** grammar cleanup if your text has rough punctuation
- Use **Preview Voice** in Settings before long sessions or WAV export

---

## Linking And Navigation

The app includes a separate linking guide because the linking system is large enough to deserve its own document.

See:

- `LINKING_SYSTEM_GUIDE.md` for clickable links, backlinks, hover previews, and relationship networks

In day-to-day use, this means you can:

- Click linked entities to jump directly to them
- See where topics and characters are referenced
- Follow event relationships through the vault more quickly

---

## Storage Notes

Different features save in different places:

- Theme choices and some editor preferences are stored locally on the device
- Topic and Character template choices are managed through app settings and persist between sessions
- Exported themes and WAV files are regular files you can keep or share

---

## Best First Workflow

If you are new to the current build, this is the fastest way to try the main tools:

1. Open a Topic
2. Use `ABC✓` to run a grammar pass
3. Use `AI✎` to rewrite a paragraph locally
4. Open Settings and configure TTS with Piper or a system voice
5. Preview the voice, then use `TTS` on the current content
6. Export a `WAV` if you want an audio proof copy
7. Use linking features to connect related topics, characters, maps, and events

---

## Related Docs

- `LINKING_SYSTEM_GUIDE.md` - Cross-references, backlinks, and relationship graphs
- `THEME_SYSTEM.md` - Technical theme system details
- `TESTING_CHECKLIST.md` - QA checklist for current features
- `DOCUMENTATION_INDEX.md` - Documentation overview

---

## FAQ

**Q: Does the app still support theme export/import?**
A: Yes. Theme import, export, reset, and local persistence are still available in Settings.

**Q: Does AI Rewrite send text online?**
A: No. The rewrite modal is designed for local GGUF model use.

**Q: Can I use TTS without bundled Piper?**
A: Yes. You can switch the provider to System Voices in Settings.

**Q: Can I save speech to WAV with system voices?**
A: No. WAV export currently works only with bundled Piper.

**Q: What is the difference between LanguageTool and AI Rewrite?**
A: LanguageTool is best for deterministic spelling and grammar suggestions. AI Rewrite is better for stylistic editing and rephrasing.

**Q: Where should I look for linking behavior?**
A: Use `LINKING_SYSTEM_GUIDE.md`, which documents navigation, backlinks, tooltips, and relationship views.

---

This guide reflects the current worldbuilding-focused app workflow and does not describe the removed writing editor.
