/**
 * Font Watcher - Auto-reload fonts.css when new fonts are detected
 * 
 * This script listens for font updates from the Electron main process
 * and automatically reloads the fonts.css stylesheet when changes occur.
 */

let pendingFontUpdate = null;
let applyRetryInterval = null;

function normalizeFontKey(fontName) {
    return fontName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function applyFontUpdate(data) {
    const families = Array.isArray(data?.families) ? data.families : [];
    const files = Array.isArray(data?.files) ? data.files : [];
    const count = families.length || files.length || 0;
    if (!count) return false;

    if (window.ThemeManager && typeof window.ThemeManager.setEditorFonts === 'function') {
        if (families.length) {
            window.ThemeManager.setEditorFonts(families);
        }
        if (families.length) {
            if (window.Editor && typeof window.Editor.registerDynamicFonts === 'function') {
                const keys = families.map(normalizeFontKey);
                window.Editor.registerDynamicFonts(keys);
            } else {
                return false;
            }
        }
        if (typeof window.populateToolbarFontSelector === 'function') {
            window.populateToolbarFontSelector();
        } else {
            const selector = document.getElementById('toolbar-font-selector');
            if (selector && typeof window.ThemeManager.getEditorFonts === 'function') {
                const fonts = window.ThemeManager.getEditorFonts();
                const currentFont = window.ThemeManager.getEditorFont ? window.ThemeManager.getEditorFont() : '';
                selector.innerHTML = '';
                fonts.forEach(fontName => {
                    const option = document.createElement('option');
                    option.value = fontName;
                    option.textContent = fontName;
                    option.selected = fontName === currentFont;
                    selector.appendChild(option);
                });
            }
        }
        if (typeof window.applyStoredEditorTypographyToEditors === 'function') {
            window.applyStoredEditorTypographyToEditors();
        }
        return true;
    }

    return false;
}

async function fetchFontsFromCSS() {
    try {
        const response = await fetch('fonts.css', { cache: 'no-store' });
        if (!response.ok) return [];
        const text = await response.text();
        const matches = [...text.matchAll(/font-family:\s*"([^"]+)"/g)];
        const families = matches.map(m => m[1]).filter(Boolean);
        return Array.from(new Set(families));
    } catch (_e) {
        return [];
    }
}

async function applyFontsFromCSS() {
    const families = await fetchFontsFromCSS();
    if (families.length && window.ThemeManager && typeof window.ThemeManager.setEditorFonts === 'function') {
        window.ThemeManager.setEditorFonts(families);
        if (window.Editor && typeof window.Editor.registerDynamicFonts === 'function') {
            const keys = families.map(normalizeFontKey);
            window.Editor.registerDynamicFonts(keys);
        } else {
            return false;
        }
        if (typeof window.populateToolbarFontSelector === 'function') {
            window.populateToolbarFontSelector();
        }
        if (typeof window.applyStoredEditorTypographyToEditors === 'function') {
            window.applyStoredEditorTypographyToEditors();
        }
        return true;
    }
    return false;
}

function scheduleApplyRetry() {
    if (applyRetryInterval) return;
    applyRetryInterval = setInterval(() => {
        if (pendingFontUpdate && applyFontUpdate(pendingFontUpdate)) {
            pendingFontUpdate = null;
            clearInterval(applyRetryInterval);
            applyRetryInterval = null;
        }
    }, 300);
}

function initFontWatcher() {
    // Check if we're in Electron context with the font watcher API
    if (!window.api || !window.api.onFontsUpdated) {
        console.log("🔤 Font watcher not available (running in browser mode)");
        return;
    }

    console.log("🔤 Font watcher initialized");

    // Listen for font updates from main process
    window.api.onFontsUpdated((data) => {
        const families = Array.isArray(data?.families) ? data.families : [];
        const files = Array.isArray(data?.files) ? data.files : [];
        const count = families.length || files.length || 0;
        console.log(`📦 Fonts updated: ${count} fonts detected`);

        if (!applyFontUpdate(data)) {
            pendingFontUpdate = data;
            scheduleApplyRetry();
        }

        reloadFontsCSS();
        applyFontsFromCSS();
    });
}

/**
 * Reload the fonts.css stylesheet by forcing a cache bust
 */
function reloadFontsCSS() {
    // Find the fonts.css link tag
    let fontsLink = document.querySelector('link[href="fonts.css"]');
    
    if (!fontsLink) {
        console.warn("⚠️  fonts.css link not found in DOM");
        return;
    }

    // Add a timestamp query parameter to force reload
    const timestamp = new Date().getTime();
    const originalHref = 'fonts.css';
    fontsLink.href = `${originalHref}?t=${timestamp}`;
    
    console.log(`✅ Reloaded fonts.css (cache bust: ${timestamp})`);
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initFontWatcher();
        if (pendingFontUpdate) {
            scheduleApplyRetry();
        }
        applyFontsFromCSS();
    });
} else {
    initFontWatcher();
    if (pendingFontUpdate) {
        scheduleApplyRetry();
    }
    applyFontsFromCSS();
}
