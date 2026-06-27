# Font Watcher Auto-Detection Implementation

## Summary

The font system now works **exactly like GIMP**—just drop a font file in the folder, add it to the mapping, and it's instantly available when the app is running. No manual regeneration or app restarts needed.

## What Was Changed

### 1. **scripts/generate-fonts.js** (Modified)
   - Converted to a reusable Node.js module
   - Exports `generateFontsCSS()`, `watchFontsDirectory()`, and `setMainProcessCallback()`
   - Allows main process to be notified when fonts change

### 2. **main.js** (Updated)
   - Added import of font generator module
   - Created `initializeFontWatcher()` function
   - Font watcher starts automatically when app window finishes loading
   - Sets up IPC callback to notify renderer when fonts are detected

### 3. **preload.js** (Updated)
   - Added `onFontsUpdated()` listener to the API
   - Allows renderer to receive notifications from main process

### 4. **frontend/font-watcher.js** (New)
   - Browser-side script that listens for font updates
   - Automatically reloads `fonts.css` with cache-busting timestamp
   - Safe fallback if running in non-Electron environment

### 5. **frontend/index.html** (Updated)
   - Added `<script src="font-watcher.js"></script>` tag
   - Removed inline @font-face declarations (now in fonts.css)

## How It Works (User Flow)

1. **User launches app**
   - Electron main process starts
   - `initializeFontWatcher()` is called when window loads
   - `fonts.css` is generated from all TTF files
   - Font watcher begins monitoring `frontend/assets/fonts/`
   - Renderer loads and `font-watcher.js` starts listening

2. **User adds a new font**
   - Places `.ttf` file in `frontend/assets/fonts/`
   - Adds mapping to `scripts/generate-fonts.js` `fontMap`
   - File watcher detects the new file immediately
   - `fonts.css` is regenerated with new font
   - Main process notifies renderer via IPC
   - Renderer reloads `fonts.css` with cache-bust
   - **New font is available in the app (no restart!)**

## File Structure

```
extal_browser/
├── scripts/
│   └── generate-fonts.js          (Font scanner/watcher)
├── main.js                        (Updated: font watcher init)
├── preload.js                     (Updated: font IPC)
└── frontend/
    ├── fonts.css                  (Auto-generated)
    ├── font-watcher.js            (New: browser listener)
    ├── index.html                 (Updated: includes watcher)
    ├── FONTS_README.md            (Documentation)
    └── assets/fonts/
        ├── Inter-VariableFont_slnt,wght.ttf
        ├── Roboto-VariableFont_wght.ttf
        └── ... (other fonts)
```

## Adding Fonts (User Instructions)

**Step 1:** Drop `.ttf` file into `frontend/assets/fonts/`

**Step 2:** Add mapping in `scripts/generate-fonts.js`:
```javascript
const fontMap = {
  // ... existing fonts ...
  'MyNewFont-Regular': { 
    family: 'My New Font', 
    weight: '400' 
  },
};
```

**That's it!** The app will auto-detect within ~1 second.

## Benefits

✅ **Zero friction** - No CLI commands or app restarts  
✅ **GIMP-like experience** - Just drop and go  
✅ **Real-time detection** - Instant feedback  
✅ **Safe** - Non-blocking file watcher  
✅ **Backwards compatible** - Manual NPM scripts still work  

## Testing

You can manually test with:
```bash
npm run fonts:generate    # One-time generation
npm run fonts:watch      # Manual watch mode (if app not running)
```

But in normal use, the app handles everything automatically.
