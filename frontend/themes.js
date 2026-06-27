// Theme Management System
// Provides color scheme customization with localStorage persistence

const ThemeManager = {
    editorFontSizeMin: 1,
    editorFontSizeMax: 512,

    // Predefined color schemes
    schemes: {
        dark: {
            name: 'Dark (Default)',
            colors: {
                'bg-primary': '#2a2a2a',
                'bg-secondary': '#333333',
                'bg-tertiary': '#3a3a3a',
                'editor-bg': '#2a2a2a',
                'writing-canvas-bg': '#333333',
                'writing-paper-bg': '#2a2a2a',
                'writing-paper-text': '#f2f2f2',
                'writing-paper-link': '#d4a574',
                'text-primary': '#f2f2f2',
                'text-secondary': '#c7c7c7',
                'text-tertiary': '#a8a8a8',
                'border-color': '#555555',
                'accent': '#d4a574',
                'accent-hover': '#e6b887',
                'accent-light': '#6b543b',
                'success': '#4caf50',
                'warning': '#d4a574',
                'danger': '#b87060',
            }
        },
        light: {
            name: 'Light',
            colors: {
                'bg-primary': '#f5f3f0',
                'bg-secondary': '#ede9e4',
                'bg-tertiary': '#e5ddd6',
                'editor-bg': '#f5f3f0',
                'writing-canvas-bg': '#ede9e4',
                'writing-paper-bg': '#f5f3f0',
                'writing-paper-text': '#2c2520',
                'writing-paper-link': '#a89468',
                'text-primary': '#2c2520',
                'text-secondary': '#5a514a',
                'text-tertiary': '#8b7f78',
                'border-color': '#d9cfc7',
                'accent': '#a89468',
                'accent-hover': '#8b754e',
                'accent-light': '#d4c9b8',
                'success': '#4caf50',
                'warning': '#ffc107',
                'danger': '#f44336',
            }
        },
        ocean: {
            name: 'Ocean',
            colors: {
                'bg-primary': '#0f1419',
                'bg-secondary': '#1a1f2e',
                'bg-tertiary': '#253549',
                'editor-bg': '#0f1419',
                'writing-canvas-bg': '#1a1f2e',
                'writing-paper-bg': '#0f1419',
                'writing-paper-text': '#e0f2f1',
                'writing-paper-link': '#00bcd4',
                'text-primary': '#e0f2f1',
                'text-secondary': '#b2dfdb',
                'text-tertiary': '#80cbc4',
                'border-color': '#004d73',
                'accent': '#00bcd4',
                'accent-hover': '#4dd0e1',
                'accent-light': '#26c6da',
                'success': '#4db8a8',
                'warning': '#ffb74d',
                'danger': '#ef5350',
            }
        },
        forest: {
            name: 'Forest',
            colors: {
                'bg-primary': '#1b2b23',
                'bg-secondary': '#243229',
                'bg-tertiary': '#2d3d33',
                'editor-bg': '#1b2b23',
                'writing-canvas-bg': '#243229',
                'writing-paper-bg': '#1b2b23',
                'writing-paper-text': '#d4e8da',
                'writing-paper-link': '#4a8a5f',
                'text-primary': '#d4e8da',
                'text-secondary': '#a8c9b0',
                'text-tertiary': '#7eb38a',
                'border-color': '#1a3a2a',
                'accent': '#4a8a5f',
                'accent-hover': '#6db888',
                'accent-light': '#3d6b4f',
                'success': '#66bb6a',
                'warning': '#ffc66d',
                'danger': '#ff6e40',
            }
        },
        sunset: {
            name: 'Sunset',
            colors: {
                'bg-primary': '#3a2a2a',
                'bg-secondary': '#4a3435',
                'bg-tertiary': '#5a4445',
                'editor-bg': '#3a2a2a',
                'writing-canvas-bg': '#4a3435',
                'writing-paper-bg': '#3a2a2a',
                'writing-paper-text': '#ffe8d6',
                'writing-paper-link': '#ff6b54',
                'text-primary': '#ffe8d6',
                'text-secondary': '#ffb8a0',
                'text-tertiary': '#ff9070',
                'border-color': '#6a3435',
                'accent': '#ff6b54',
                'accent-hover': '#ffb380',
                'accent-light': '#d97c5f',
                'success': '#66bb6a',
                'warning': '#ffa726',
                'danger': '#ef5350',
            }
        },
        midnight: {
            name: 'Midnight',
            colors: {
                'bg-primary': '#0a0e1a',
                'bg-secondary': '#131829',
                'bg-tertiary': '#1a2138',
                'editor-bg': '#0a0e1a',
                'writing-canvas-bg': '#131829',
                'writing-paper-bg': '#0a0e1a',
                'writing-paper-text': '#e8e9f3',
                'writing-paper-link': '#7c3aed',
                'text-primary': '#e8e9f3',
                'text-secondary': '#a0a3b0',
                'text-tertiary': '#7a7d8a',
                'border-color': '#1e2741',
                'accent': '#7c3aed',
                'accent-hover': '#a78bfa',
                'accent-light': '#6d28d9',
                'success': '#10b981',
                'warning': '#f59e0b',
                'danger': '#ef4444',
            }
        },
        cyberpunk: {
            name: 'Cyberpunk',
            colors: {
                'bg-primary': '#0d0221',
                'bg-secondary': '#1a0033',
                'bg-tertiary': '#26004d',
                'editor-bg': '#0d0221',
                'writing-canvas-bg': '#1a0033',
                'writing-paper-bg': '#0d0221',
                'writing-paper-text': '#00ff88',
                'writing-paper-link': '#ff006e',
                'text-primary': '#00ff88',
                'text-secondary': '#00cc66',
                'text-tertiary': '#ff006e',
                'border-color': '#ff006e',
                'accent': '#ff006e',
                'accent-hover': '#00ff88',
                'accent-light': '#ff0099',
                'success': '#00ff88',
                'warning': '#ffbe0b',
                'danger': '#ff006e',
            }
        },
        highfantasy: {
            name: 'High Fantasy (Extal)',
            colors: {
                'bg-primary': '#e6dfd0',
                'bg-secondary': '#d9cdb5',
                'bg-tertiary': '#c9bba5',
                'editor-bg': '#e6dfd0',
                'writing-canvas-bg': '#d9cdb5',
                'writing-paper-bg': '#e6dfd0',
                'writing-paper-text': '#000000',
                'writing-paper-link': '#948253',
                'text-primary': '#000000',
                'text-secondary': '#80592e',
                'text-tertiary': '#948253',
                'border-color': '#948253',
                'accent': '#948253',
                'accent-hover': '#82703e',
                'accent-light': '#3f6f3f',
                'success': '#2f4f2f',
                'warning': '#948253',
                'danger': '#8b4545',
            }
        }
    },

    currentScheme: 'dark',
    customColors: {},
    builtInSchemeKeys: [],
    editorFont: 'System Default',
    editorFontSize: 14,
    
    // Available fonts for the editor
    fonts: [
        'System Default',
        'Inter',
        'Roboto',
        'Lora',
        'Fira Sans',
        'Source Sans 3',
        'Source Serif 4',
        'Playfair Display',
        'Oswald',
        'Bebas Neue',
        'Rubik',
        'JetBrains Mono'
    ],

    // Initialize the theme system
    init: function() {
        this.builtInSchemeKeys = Object.keys(this.schemes);
        this.loadSavedTheme();
        this.applyTheme();
    },

    // Load theme from localStorage
    loadSavedTheme: function() {
        const savedSchemes = localStorage.getItem('theme-schemes');
        if (savedSchemes) {
            try {
                const parsed = JSON.parse(savedSchemes);
                if (parsed && typeof parsed === 'object') {
                    for (const [key, value] of Object.entries(parsed)) {
                        if (!this.schemes[key] && value && value.colors) {
                            this.schemes[key] = value;
                        }
                    }
                }
            } catch (e) {
                console.error('Failed to load custom schemes:', e);
            }
        }

        const saved = localStorage.getItem('theme-current');
        if (saved) {
            if (this.schemes[saved]) {
                this.currentScheme = saved;
            }
        }

        const customSaved = localStorage.getItem('theme-custom');
        if (customSaved) {
            try {
                this.customColors = JSON.parse(customSaved);
            } catch (e) {
                console.error('Failed to load custom colors:', e);
                this.customColors = {};
            }
        }

        const fontSaved = localStorage.getItem('editor-font');
        if (fontSaved) {
            this.editorFont = fontSaved;
        }

        const fontSizeSaved = localStorage.getItem('editor-font-size');
        if (fontSizeSaved) {
            const parsed = parseInt(fontSizeSaved, 10);
            if (Number.isFinite(parsed)) {
                this.editorFontSize = Math.max(this.editorFontSizeMin, Math.min(this.editorFontSizeMax, parsed));
            }
        }
    },

    // Save theme to localStorage
    saveTheme: function() {
        localStorage.setItem('theme-current', this.currentScheme);
        localStorage.setItem('theme-custom', JSON.stringify(this.customColors));
    },

    saveCustomSchemes: function() {
        const customSchemes = {};
        for (const [key, value] of Object.entries(this.schemes)) {
            if (!this.builtInSchemeKeys.includes(key)) {
                customSchemes[key] = value;
            }
        }
        localStorage.setItem('theme-schemes', JSON.stringify(customSchemes));
    },

    // Apply current theme to the page
    applyTheme: function() {
        const colors = this.getColors();
        const root = document.documentElement;

        for (const [key, value] of Object.entries(colors)) {
            root.style.setProperty('--' + key, value);
        }
    },

    // Get colors for current scheme, merged with custom overrides
    getColors: function() {
        const schemeColors = this.schemes[this.currentScheme]?.colors || this.schemes.dark.colors;
        return { ...this.schemes.dark.colors, ...schemeColors, ...this.customColors };
    },

    // Set the active color scheme
    setScheme: function(schemeName) {
        if (this.schemes[schemeName]) {
            this.currentScheme = schemeName;
            this.saveTheme();
            this.applyTheme();
            return true;
        }
        return false;
    },

    // Register or update a scheme (persisted if custom)
    registerScheme: function(schemeKey, schemeName, colors) {
        if (!schemeKey || !colors || typeof colors !== 'object') return false;
        const safeName = schemeName || schemeKey;
        this.schemes[schemeKey] = {
            name: safeName,
            colors: { ...colors }
        };
        this.saveCustomSchemes();
        return true;
    },

    // Update a single custom color
    setColor: function(colorKey, colorValue) {
        this.customColors[colorKey] = colorValue;
        this.saveTheme();
        this.applyTheme();
    },

    // Reset to scheme defaults (clearing custom overrides)
    resetToDefaults: function() {
        this.customColors = {};
        this.saveTheme();
        this.applyTheme();
    },

    // Get all available color keys
    getColorKeys: function() {
        return Object.keys(this.schemes.dark.colors);
    },

    // Get all scheme names
    getSchemeNames: function() {
        return Object.keys(this.schemes);
    },

    // Get scheme display name
    getSchemeName: function(schemeKey) {
        return this.schemes[schemeKey]?.name || schemeKey;
    },

    // Get available fonts for editor
    getEditorFonts: function() {
        return this.fonts;
    },

    // Merge discovered fonts into the available fonts list (preserves the curated defaults)
    setEditorFonts: function(fonts) {
        if (!Array.isArray(fonts)) return;
        const incoming = fonts.filter(Boolean);
        if (!incoming.length) return;
        // Merge discovered fonts with existing list so the curated defaults are always present
        const merged = Array.from(new Set([...this.fonts, ...incoming]));
        if (!merged.includes('System Default')) {
            merged.unshift('System Default');
        }
        this.fonts = merged;
        if (!this.fonts.includes(this.editorFont)) {
            this.editorFont = 'System Default';
            localStorage.setItem('editor-font', this.editorFont);
        }
    },

    // Get current editor font
    getEditorFont: function() {
        return this.editorFont;
    },

    // Set editor font
    setEditorFont: function(fontName) {
        if (this.fonts.includes(fontName)) {
            this.editorFont = fontName;
            localStorage.setItem('editor-font', fontName);
            return true;
        }
        return false;
    },

    // Get current editor font size
    getEditorFontSize: function() {
        return this.editorFontSize;
    },

    // Set editor font size
    setEditorFontSize: function(size) {
        const numSize = parseInt(size, 10);
        if (Number.isFinite(numSize) && numSize >= this.editorFontSizeMin && numSize <= this.editorFontSizeMax) {
            this.editorFontSize = numSize;
            localStorage.setItem('editor-font-size', numSize);
            return true;
        }
        return false;
    }
};
// Expose to global scope for other scripts
window.ThemeManager = ThemeManager;

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ThemeManager.init());
} else {
    ThemeManager.init();
}
