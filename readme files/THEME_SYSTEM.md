# Theme & Color Customization System

## Overview
The application now includes a comprehensive theme and color customization system that allows you to:
- **Select from 7 pre-designed color schemes**
- **Customize individual colors** with a color picker interface
- **Save and load your custom themes** as JSON files
- **Persistent storage** - your settings are saved in browser localStorage

## How to Access Settings

1. Click the **🎨 Settings** button in the top toolbar (next to AI Models button)
2. The Settings modal will open with the Theme & Appearance section
3. Customize your colors and close when done

## Built-in Color Schemes

### 1. **Dark (Default)**
A warm, muted dark theme with earthy tones. Perfect for extended viewing and reduces eye strain.
- Primary background: #3c3c3c
- Text color: #d4c9b8 (warm beige)
- Accent: #5e5436 (muted gold)

### 2. **Light**
A clean, bright theme with soft neutral colors for daytime use.
- Primary background: #f5f3f0 (off-white)
- Text color: #2c2520 (dark brown)
- Accent: #a89468 (warm tan)

### 3. **Ocean**
A cool, calming theme inspired by ocean tones.
- Primary background: #0f1419 (dark navy)
- Text color: #e0f2f1 (light cyan)
- Accent: #00bcd4 (bright cyan)

### 4. **Forest**
A natural, earthy theme with green tones.
- Primary background: #1b2b23 (dark forest)
- Text color: #d4e8da (light sage)
- Accent: #4a8a5f (forest green)

### 5. **Sunset**
A warm, vibrant theme with orange and warm tones.
- Primary background: #3a2a2a (dark brown)
- Text color: #ffe8d6 (warm cream)
- Accent: #ff6b54 (coral)

### 6. **Midnight**
A sleek, modern theme with purple accents.
- Primary background: #0a0e1a (very dark)
- Text color: #e8e9f3 (light lavender)
- Accent: #7c3aed (vivid purple)

### 7. **Cyberpunk**
A bold, futuristic theme with neon colors.
- Primary background: #0d0221 (deep purple)
- Text color: #00ff88 (neon green)
- Accent: #ff006e (neon pink)

## Color Customization

### Available Colors to Customize

Each theme includes these customizable color variables:

| Color | Purpose |
|-------|---------|
| **bg-primary** | Main background color |
| **bg-secondary** | Secondary panels background |
| **bg-tertiary** | Hover and tertiary backgrounds |
| **text-primary** | Main text color |
| **text-secondary** | Dimmed text (labels, help text) |
| **text-tertiary** | Very dim text |
| **border-color** | Border and divider lines |
| **accent** | Highlight and button colors |
| **accent-hover** | Accent color on hover |
| **accent-light** | Lighter accent for backgrounds |
| **success** | Success state color |
| **warning** | Warning/caution color |
| **danger** | Error/danger color |

### How to Customize Colors

1. Open Settings (🎨 button)
2. Select a base scheme from the dropdown
3. Scroll through the color customization section
4. For each color:
   - **Color picker** (colored square): Click to open color picker
   - **Hex input**: Type hex color codes directly (e.g., #FF5733)
5. Changes apply instantly
6. Your custom colors override the scheme automatically

## Saving & Loading Themes

### Export a Theme
1. Open Settings
2. Click **📤 Export Theme** button
3. A JSON file will download with your theme configuration
4. Share or backup this file

### Import a Theme
1. Open Settings
2. Click **📥 Import Theme** button
3. Select a previously exported theme file
4. Theme will apply immediately

### Theme File Format
Theme files are JSON and look like:
```json
{
  "scheme": "dark",
  "custom": {
    "accent": "#ff6b54",
    "text-primary": "#ffffff"
  }
}
```

## Resetting Colors

1. Open Settings
2. Click **🔄 Reset** button
3. Confirm the dialog
4. All custom colors are removed and the active scheme's defaults are restored

## Storage & Persistence

- **Location**: Browser localStorage
- **Keys used**:
  - `theme-current`: Stores the active color scheme name
  - `theme-custom`: Stores custom color overrides as JSON
- **Persistence**: Settings persist across sessions until cleared
- **Clearing**: Clearing browser data/cookies will reset to defaults

## Technical Details

### Files Added

1. **frontend/themes.js**
   - Core theme management system
   - Handles color storage and application
   - Loads/saves from localStorage
   - Manages all predefined schemes

2. **frontend/settings.js**
   - Settings modal UI
   - Color picker initialization
   - Import/export functionality
   - Event handling for settings changes

### CSS Variables

All colors are implemented as CSS custom properties (CSS variables) using the `:root` selector:
```css
:root {
    --bg-primary: #3c3c3c;
    --text-primary: #d4c9b8;
    /* ... etc ... */
}
```

This means colors automatically apply to all elements using `var(--color-name)`.

### How Colors Apply

1. When the page loads, `ThemeManager.init()` runs
2. Loads saved theme from localStorage
3. Applies colors to CSS `:root` variables
4. All elements using `var(--*)` CSS variables automatically get the colors

## Troubleshooting

### Changes Don't Persist
- Clear browser cache and reload
- Check if localStorage is enabled in your browser settings

### Colors Look Wrong
- Try exporting the current theme and reimporting it
- Check that hex color codes are valid (e.g., #RRGGBB format)

### Can't Open Settings
- Make sure JavaScript is enabled
- Check browser console for errors (F12)
- Try refreshing the page

## Future Enhancements

Possible future additions:
- Theme marketplace/sharing
- Advanced color harmony tools
- Automatic contrast checking
- Per-element styling options
- Animation/transition speed customization
