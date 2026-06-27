# Extal World Builder - Documentation Index

## Quick Navigation

### For Users
- **[QUICK_START.md](QUICK_START.md)** - Main user guide
  - App quick start
  - Toolbar tools
  - LanguageTool
  - AI Rewrite
  - TTS and WAV export
  - Settings, templates, and linking workflow

- **[LINKING_SYSTEM_GUIDE.md](LINKING_SYSTEM_GUIDE.md)** - Linking and navigation guide
  - Clickable links
  - Backlinks
  - Hover previews
  - Relationship network views

### For Developers
- **[THEME_SYSTEM.md](THEME_SYSTEM.md)** - Theme system technical documentation
- **[THEME_SETUP_SUMMARY.md](THEME_SETUP_SUMMARY.md)** - Theme implementation summary
- **[FONT_WATCHER_IMPLEMENTATION.md](FONT_WATCHER_IMPLEMENTATION.md)** - Font scanning and regeneration notes
- **[FONT_FIXES.md](FONT_FIXES.md)** - Font validation and recovery notes

### For QA And Testing
- **[TESTING_CHECKLIST.md](TESTING_CHECKLIST.md)** - Verification checklist

### Feature-Specific Docs
- **[../tts/piper/README.md](../tts/piper/README.md)** - Bundled Piper layout and runtime behavior
- **[../themes/README.txt](../themes/README.txt)** - Theme file usage
- **[../backend/AUTO_SCANNER_README.md](../backend/AUTO_SCANNER_README.md)** - Auto-scanner documentation

---

## User-Facing Features Covered By The Docs

The current documentation set now covers these user-facing features:

- Theme customization and theme import/export
- Topic and Character template management in Settings
- Offline LanguageTool spelling and grammar workflow
- Local AI Rewrite workflow for GGUF models
- Text to Speech with bundled Piper or system voices
- WAV export with bundled Piper
- Linking, backlinks, and relationship navigation

---

## Recommended Reading Order

### If You Just Want To Use The App
1. `QUICK_START.md`
2. `LINKING_SYSTEM_GUIDE.md`

### If You Need TTS Details
1. `QUICK_START.md`
2. `../tts/piper/README.md`

### If You Are Working On Themes
1. `QUICK_START.md`
2. `THEME_SYSTEM.md`
3. `THEME_SETUP_SUMMARY.md`

### If You Are Testing A Build
1. `QUICK_START.md`
2. `TESTING_CHECKLIST.md`

---

## Notes

- The older docs were centered mostly on the theme system.
- The main quick start now reflects the current worldbuilding-focused workflow and TTS support.
- Feature-specific technical docs remain separated so user docs stay focused on usage.
All colors use CSS variables, so:
- Any new CSS element can use colors
- Add `var(--color-name)` to styles
- Color automatically customizable
- No extra code needed

---

## Troubleshooting

### Settings Button Not Visible
- Check HTML was updated correctly
- Refresh page (F5)
- Check console for errors (F12)

### Colors Don't Change
- Check themes.js loaded (Network tab)
- Verify localStorage enabled
- Check console for errors

### Settings Don't Persist
- Verify localStorage enabled
- Check DevTools Application > Storage
- Try clearing cache

### Import/Export Issues
- Verify file is valid JSON
- Check browser console for errors
- Try example files first

See **[TESTING_CHECKLIST.md](TESTING_CHECKLIST.md)** for detailed troubleshooting.

---

## Status

✅ **Implementation Complete**
- All features implemented
- All documentation complete
- All files created/modified
- Ready for immediate use
- Production-ready

**Date Completed:** February 6, 2026
**Status:** ✅ READY FOR DEPLOYMENT

---

## Next Steps

1. Read **[QUICK_START.md](QUICK_START.md)** to get started
2. Try each built-in theme
3. Customize colors to your preference
4. Explore linking between topics, characters, maps, and events
5. Refer to **[TESTING_CHECKLIST.md](TESTING_CHECKLIST.md)** for validation

---

**Need Help?** Check the documentation file relevant to your question:
- User questions → QUICK_START.md
- Technical questions → THEME_SYSTEM.md
- Testing questions → TESTING_CHECKLIST.md
- Theme files → themes/README.txt
