# Font Management System

This project uses an **automatic font detection system** similar to GIMP. When you launch the application, it automatically watches for new fonts and reloads them instantly.

## How It Works

- **`frontend/assets/fonts/`** - Directory containing all TTF font files
- **`frontend/fonts.css`** - Auto-generated CSS file with all @font-face declarations
- **`scripts/generate-fonts.js`** - Node.js font scanner/watcher (runs in Electron main process)
- **`frontend/font-watcher.js`** - Browser script that reloads fonts.css on updates

## Adding a New Font

**That's it! Just two simple steps:**

1. **Drop the font file** into `frontend/assets/fonts/` or any subfolder (must be `.ttf` format)
2. **Add font mapping** to `scripts/generate-fonts.js` in the `fontMap` object

The app will automatically detect the new font within a second—no restart needed!

## Font Mapping

The script needs to know the font family name and weight range. Add your font to the `fontMap` object in `scripts/generate-fonts.js`:

```javascript
const fontMap = {
  'YourFont-VariableFont_wght': { 
    family: 'Your Font', 
    weight: '100 900' 
  },
  'YourFont-Bold': { 
    family: 'Your Font', 
    weight: '700' 
  },
};
```

Common weight ranges:
- Variable fonts: `'100 900'` (supports full range)
- Single weight: `'400'` (regular weight)
- Custom: `'200 700'` (light to bold)

## NPM Scripts (For Manual Operations)

```bash
# Generate fonts.css once (auto-done on app launch)
npm run fonts:generate

# Watch fonts directory and auto-regenerate when fonts change
# (automatically running inside the Electron app)
npm run fonts:watch
```

## Using Fonts in CSS

Once a font is registered, use it anywhere in your CSS:

```css
body {
    font-family: "Inter", sans-serif;
    font-weight: 400;
}

h1 {
    font-family: "Playfair Display", serif;
    font-weight: 700;
}
```

## Current Fonts

- Bebas Neue (400)
- Fira Sans (100–900)
- Inter (100–900)
- JetBrains Mono (100–800)
- Lora (100–700)
- Oswald (200–700)
- Playfair Display (400–900)
- Roboto (100–900)
- Rubik (100–900)
- Source Sans 3 (100–900)
- Source Serif 4 (200–900)

## How the Auto-Watcher Works

1. **App starts** → Electron main process initializes the font watcher
2. **fonts.css is generated** from all TTF files in `frontend/assets/fonts/`
3. **Renderer window loads** → `font-watcher.js` begins listening for updates
4. **You add a font file (any subfolder)** → The watcher detects it instantly
5. **CSS is regenerated** → Main process notifies renderer
6. **fonts.css reloads** → Browser automatically pulls the updated fonts

---

**Note:** `fonts.css` is auto-generated. Don't edit it manually—add fonts to the folder and let the watcher regenerate it automatically.
