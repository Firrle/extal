#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { watch } = require('fs');

const FONTS_DIR = path.join(__dirname, '../frontend/assets/fonts');
const FRONTEND_DIR = path.join(__dirname, '../frontend');
const OUTPUT_FILE = path.join(__dirname, '../frontend/fonts.css');

let mainProcessCallback = null;

/**
 * Set callback to notify main process when fonts change
 */
function setMainProcessCallback(callback) {
  mainProcessCallback = callback;
}

/**
 * Extract font metadata from filename
 */
function parseFontFilename(filename) {
  const nameWithoutExt = filename.replace(/\.ttf$/i, '');
  const nameKey = nameWithoutExt.toLowerCase();
  
  // Map filename patterns to font properties
  const fontMap = {
    'inter-variablefont_slnt,wght': { family: 'Inter', weight: '100 900', style: 'normal' },
    'inter-italic-variablefont_opsz,wght': { family: 'Inter', weight: '100 900', style: 'italic' },
    'roboto-variablefont_wght': { family: 'Roboto', weight: '100 900' },
    'lora-variablefont_wght': { family: 'Lora', weight: '100 700' },
    'firasans-variablefont_wght': { family: 'Fira Sans', weight: '100 900' },
    'sourcesans3-variablefont_wght': { family: 'Source Sans 3', weight: '100 900' },
    'sourceserif4-variablefont_wght': { family: 'Source Serif 4', weight: '200 900' },
    'playfairdisplay-variablefont_wght': { family: 'Playfair Display', weight: '400 900' },
    'oswald-variablefont_wght': { family: 'Oswald', weight: '200 700' },
    'rubik-variablefont_wght': { family: 'Rubik', weight: '100 900' },
    'jetbrainsmono-variablefont_wght': { family: 'JetBrains Mono', weight: '100 800' },
    'bebasneue-regular': { family: 'Bebas Neue', weight: '400' },
    // Gaze font variants (Gazeb__=bold, Gazei__=italic, Gazen__=normal)
    'gazeb__': { family: 'Gaze', weight: '700', style: 'normal' },
    'gazei__': { family: 'Gaze', weight: '400', style: 'italic' },
    'gazen__': { family: 'Gaze', weight: '400', style: 'normal' }
  };
  
  if (fontMap[nameKey]) {
    return fontMap[nameKey];
  }

  // Handle compound font names whose prefix identifies a known family
  // e.g. FiraSans-Bold.ttf → family "Fira Sans", weight 700
  const compoundFamilyPrefixes = {
    'firasans': 'Fira Sans',
    'sourcesans': 'Source Sans',
    'sourceserif': 'Source Serif',
    'playfairdisplay': 'Playfair Display',
    'jetbrainsmono': 'JetBrains Mono',
  };
  for (const [prefix, displayFamily] of Object.entries(compoundFamilyPrefixes)) {
    if (nameKey.startsWith(prefix)) {
      const suffix = nameKey.slice(prefix.length).replace(/^[-_]+/, '');
      const inferredStyle = /italic|oblique/.test(suffix) ? 'italic' : 'normal';
      let inferredWeight = '400';
      if (/black|heavy/.test(suffix)) inferredWeight = '900';
      else if (/extrabold|ultrabold/.test(suffix)) inferredWeight = '800';
      else if (/semibold|demibold/.test(suffix)) inferredWeight = '600';
      else if (/\bbold\b/.test(suffix)) inferredWeight = '700';
      else if (/medium/.test(suffix)) inferredWeight = '500';
      else if (/extralight|ultralight/.test(suffix)) inferredWeight = '200';
      else if (/light/.test(suffix)) inferredWeight = '300';
      else if (/thin/.test(suffix)) inferredWeight = '100';
      return { family: displayFamily, weight: inferredWeight, style: inferredStyle };
    }
  }

  // Fallback: infer family/weight/style from filename
  const lower = nameKey;
  const style = /(italic|oblique)/.test(lower) ? 'italic' : 'normal';

  let weight = '400';
  if (/thin/.test(lower)) weight = '100';
  else if (/extralight|ultralight/.test(lower)) weight = '200';
  else if (/light/.test(lower)) weight = '300';
  else if (/medium/.test(lower)) weight = '500';
  else if (/semibold|demibold/.test(lower)) weight = '600';
  else if (/bold/.test(lower)) weight = '700';
  else if (/extrabold|ultrabold/.test(lower)) weight = '800';
  else if (/black|heavy/.test(lower)) weight = '900';

  const stopTokens = new Set([
    'variablefont', 'opsz', 'wght', 'wdth', 'slnt', 'ital', 'italic', 'oblique',
    'regular', 'roman', 'bold', 'black', 'heavy', 'thin', 'light', 'medium',
    'semibold', 'demibold', 'extrabold', 'ultrabold', 'extralight', 'ultralight'
  ]);

  const tokens = nameWithoutExt
    .split(/[_-]+/)
    .map(t => t.trim())
    .filter(t => t.length > 0)
    .filter(t => {
      const tLower = t.toLowerCase();
      if (stopTokens.has(tLower)) return false;
      if (/^\d+pt$/.test(tLower)) return false;
      if (/(opsz|wght|wdth|slnt|ital)/.test(tLower)) return false;
      return true;
    });

  const family = tokens.join(' ') || nameWithoutExt.replace(/[_-]+/g, ' ').trim();

  return { family, weight, style };
}

/**
 * Generate CSS @font-face rule
 */
function generateFontFace(relativePath, metadata) {
  return `@font-face {
    font-family: "${metadata.family}";
    src: url("${relativePath}") format("truetype");
    font-style: ${metadata.style || 'normal'};
    font-weight: ${metadata.weight};
    font-display: swap;
}`;
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function listFontFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFontFiles(fullPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.ttf')) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Generate fonts.css file from font files in directory
 */
function generateFontsCSS() {
  try {
    if (!fs.existsSync(FONTS_DIR)) {
      console.error(`Fonts directory not found: ${FONTS_DIR}`);
      return;
    }

    const files = listFontFiles(FONTS_DIR).sort();

    if (files.length === 0) {
      console.warn('No TTF files found in fonts directory');
      return;
    }

    const familiesSet = new Set();

    const fontFaces = files
      .map(filePath => {
        // Validate file is actually a TTF (check file header)
        const buffer = Buffer.alloc(4);
        try {
          const fd = fs.openSync(filePath, 'r');
          fs.readSync(fd, buffer, 0, 4, 0);
          fs.closeSync(fd);
          
          // TTF files start with 0x00010000 or "OTTO" (OpenType)
          const hex = buffer.toString('hex');
          if (!hex.match(/^(00010000|4f54544f)/)) {
            console.warn(`⚠️  Invalid font file (not TTF): ${path.relative(FONTS_DIR, filePath)} - skipping`);
            return null;
          }
        } catch (e) {
          console.warn(`⚠️  Could not validate file: ${path.relative(FONTS_DIR, filePath)} - skipping`);
          return null;
        }

        const relativeToFonts = path.relative(FONTS_DIR, filePath);
        const filename = path.basename(filePath);
        const metadata = parseFontFilename(filename);
        const relativeToFrontend = toPosixPath(path.relative(FRONTEND_DIR, filePath));
        if (metadata && metadata.family) {
          familiesSet.add(metadata.family);
        }
        return generateFontFace(relativeToFrontend, metadata);
      })
      .filter(Boolean)
      .join('\n\n');

    const css = `/* Auto-generated fonts.css - Do not edit manually */
/* Generated from fonts in: ${FONTS_DIR} */
/* To regenerate, run: npm run fonts:generate */

${fontFaces}
`;

    // Try to write fonts.css, but skip if in a packaged/read-only environment
    try {
      fs.writeFileSync(OUTPUT_FILE, css, 'utf8');
      console.log(`✅ Generated fonts.css with ${fontFaces.split('@font-face').length - 1} fonts`);
    } catch (writeError) {
      // In packaged apps (AppImage, asar), the filesystem is read-only
      // This is expected and not an error - fonts.css is pre-generated during build
      if (writeError.code === 'ENOENT' || writeError.code === 'ENOTDIR' || writeError.code === 'EACCES' || writeError.code === 'EPERM') {
        console.log(`ℹ️  Running in packaged environment - fonts.css is pre-generated`);
      } else {
        throw writeError;
      }
    }
    
    // Notify main process if callback is set
    if (mainProcessCallback) {
      const validFonts = files.filter(filePath => {
        const buffer = Buffer.alloc(4);
        try {
          const fd = fs.openSync(filePath, 'r');
          fs.readSync(fd, buffer, 0, 4, 0);
          fs.closeSync(fd);
          return buffer.toString('hex').match(/^(00010000|4f54544f)/);
        } catch (e) {
          return false;
        }
      });
      const families = Array.from(familiesSet).sort((a, b) => a.localeCompare(b));
      mainProcessCallback({
        files: validFonts.map(filePath => path.relative(FONTS_DIR, filePath)),
        families
      });
    }
    
    return files;
  } catch (error) {
    // Don't exit on error in packaged app, just log warning
    if (process.argv[2] === '--watch' || error.code === 'ENOTDIR' || error.code === 'EACCES') {
      console.warn('⚠️  Warning: Could not generate fonts.css:', error.message);
    } else {
      console.error('Error generating fonts.css:', error);
      process.exit(1);
    }
  }
}

/**
 * Check if running in a packaged environment (AppImage, ASAR, etc.)
 */
function isPackagedEnvironment() {
  return process.mainModule && 
         process.mainModule.filename && 
         process.mainModule.filename.includes('.asar');
}

/**
 * Watch fonts directory for changes
 */
function watchFontsDirectory() {
  // In packaged environments (AppImage with ASAR), file watching won't work
  // and fonts are pre-generated during the build
  if (isPackagedEnvironment()) {
    return;
  }

  console.log(`👁️  Watching for font changes in: ${FONTS_DIR}`);

  const watchedDirs = new Map();

  const addWatcher = (dir) => {
    if (watchedDirs.has(dir)) return;

    try {
      const watcher = watch(dir, (eventType, filename) => {
        if (!filename) {
          generateFontsCSS();
          return;
        }

        const fullPath = path.join(dir, filename);
        try {
          const stat = fs.existsSync(fullPath) ? fs.statSync(fullPath) : null;
          if (stat && stat.isDirectory()) {
            addWatcher(fullPath);
            generateFontsCSS();
            return;
          }
        } catch (_e) {
          // Ignore stat errors, still try to regenerate
        }

        if (filename.toLowerCase().endsWith('.ttf')) {
          console.log(`📝 Font detected (${eventType}): ${path.relative(FONTS_DIR, fullPath)}`);
          generateFontsCSS();
        }
      });

      watchedDirs.set(dir, watcher);
    } catch (error) {
      // Silently skip watch errors in packaged environments
      if (process.argv[2] === '--watch' || process.env.NODE_ENV === 'development') {
        console.warn(`⚠️  Failed to watch directory: ${dir}`, error.message);
      }
    }
  };

  const walkAndWatch = (dir) => {
    try {
      addWatcher(dir);
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          walkAndWatch(path.join(dir, entry.name));
        }
      }
    } catch (error) {
      // In packaged app, directories in asar might not be accessible
      if (process.argv[2] === '--watch' || process.env.NODE_ENV === 'development') {
        console.warn(`⚠️  Could not read directory: ${dir}`, error.message);
      }
    }
  };

  try {
    walkAndWatch(FONTS_DIR);
  } catch (error) {
    // In packaged environments, silently continue
    console.log(`ℹ️  Font watching disabled in packaged environment`);
  }
}

// Export for use as a module (from Electron main process)
module.exports = {
  generateFontsCSS,
  watchFontsDirectory,
  setMainProcessCallback
};

// CLI usage
if (require.main === module) {
  const command = process.argv[2];

  if (command === '--watch') {
    generateFontsCSS();
    watchFontsDirectory();
    // Keep process alive
    process.on('SIGINT', () => {
      console.log('\n👋 Stopping font watcher');
      process.exit(0);
    });
  } else {
    generateFontsCSS();
  }
}
