// ============================================================
//  ELECTRON MAIN PROCESS — Extal World Builder
// ============================================================

const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
const { execFile, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { generateFontsCSS, watchFontsDirectory, setMainProcessCallback } = require("./scripts/generate-fonts.js");
const { listPiperModels, prewarmPiperModel, synthesizePiperTts, savePiperTtsToFile, shutdownPiperWorker } = require("./tts/piper.js");

const DEBUG = false;
const log = (...args) => {
  if (DEBUG) console.log(...args);
};

const lastVaultBackupAt = new Map();
let languageToolProcess = null;
let languageToolLastStart = null;
let languageToolLogs = [];

// ------------------------------------------------------------
// Portable mode — always on when packaged
// All writable data lives next to the executable / app bundle.
// ------------------------------------------------------------
function getPortableRootDir() {
  // Windows: exe runs directly from the unpacked folder
  if (process.platform === 'win32') {
    return path.dirname(process.execPath);
  }

  // Linux AppImage: process.execPath is inside a temp mount (/tmp/.mount_XXX);
  //                 the real file location is in APPIMAGE env var
  if (process.platform === 'linux' && process.env.APPIMAGE) {
    return path.dirname(process.env.APPIMAGE);
  }

  // macOS: process.execPath is deep inside Foo.app/Contents/MacOS/;
  //        put portable-data next to the .app bundle
  if (process.platform === 'darwin') {
    const exeDir = path.dirname(process.execPath);
    const appBundleMatch = exeDir.match(/^(.+\.app)[\/\\]/);
    if (appBundleMatch) {
      return path.dirname(appBundleMatch[1]);
    }
  }

  // Fallback: folder containing the executable
  return path.dirname(process.execPath);
}

function configurePortablePaths() {
  if (!app.isPackaged) return;

  const rootDir = getPortableRootDir();
  const portableDataDir = path.join(rootDir, "portable-data");
  const portableUserDataDir = path.join(portableDataDir, "userData");
  const portableSessionDataDir = path.join(portableDataDir, "sessionData");
  const portableLogsDir = path.join(portableDataDir, "logs");

  try {
    fs.mkdirSync(portableUserDataDir, { recursive: true });
    fs.mkdirSync(portableSessionDataDir, { recursive: true });
    fs.mkdirSync(portableLogsDir, { recursive: true });

    app.setPath("userData", portableUserDataDir);
    app.setPath("sessionData", portableSessionDataDir);
    app.setPath("logs", portableLogsDir);
  } catch (error) {
    console.error("Portable mode path setup failed.", error);
    app.quit();
  }
}

configurePortablePaths();

function resolveAppPathInsideResources(...parts) {
  if (!app.isPackaged) return null;
  try {
    const unpacked = path.join(process.resourcesPath, "app.asar.unpacked", ...parts);
    if (fs.existsSync(unpacked)) return unpacked;
    const asar = path.join(process.resourcesPath, "app.asar", ...parts);
    if (fs.existsSync(asar)) return asar;
  } catch (e) {}
  return null;
}

function resolveBackendScriptPath(scriptFilename) {
  const packed = resolveAppPathInsideResources("backend", scriptFilename);
  if (packed) return packed;
  const dev = path.join(__dirname, "backend", scriptFilename);
  return dev;
}

function resolveTtsAssetPath(...parts) {
  const packed = resolveAppPathInsideResources("tts", ...parts);
  if (packed) return packed;
  return path.join(__dirname, "tts", ...parts);
}

function resolveFrontendAssetPath(...parts) {
  const candidates = [
    resolveAppPathInsideResources("frontend", ...parts),
    path.join(__dirname, "frontend", ...parts),
    path.join(process.cwd(), "frontend", ...parts)
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0] || null;
}

function getBundledPiperBinaryPath() {
  const candidates = process.platform === "win32"
    ? [
        resolveTtsAssetPath("piper", "windows", "piper.exe"),
        resolveTtsAssetPath("piper", "windows", "bin", "piper.exe")
      ]
    : process.platform === "darwin"
      ? [
          resolveTtsAssetPath("piper", "mac", "piper"),
          resolveTtsAssetPath("piper", "mac", "bin", "piper")
        ]
      : [
          resolveTtsAssetPath("piper", "linux", "piper"),
          resolveTtsAssetPath("piper", "linux", "bin", "piper")
        ];

  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

function getBundledPiperModels() {
  return listPiperModels(resolveTtsAssetPath("piper", "models"));
}

function getBundledPiperModel(modelId) {
  const models = getBundledPiperModels();
  if (!models.length) return null;
  const targetId = String(modelId || "").trim();
  if (!targetId) return models[0];
  return models.find((model) => model.id === targetId) || null;
}

function getBundledPiperSupport() {
  const binaryPath = getBundledPiperBinaryPath();
  const pythonPath = getBundledPythonCommand();
  const workerScriptPath = resolveTtsAssetPath("piper", "worker.py");
  const models = getBundledPiperModels();
  const playbackSupported = !!pythonPath && !!workerScriptPath && models.length > 0;

  let reason = "";
  if (!pythonPath) {
    reason = "Bundled Piper Python runtime was not found for this platform.";
  } else if (!workerScriptPath || !fs.existsSync(workerScriptPath)) {
    reason = "Bundled Piper worker script was not found under tts/piper.";
  } else if (!models.length) {
    reason = "No bundled Piper models were found under tts/piper/models.";
  }

  return {
    binaryPath,
    pythonPath,
    workerScriptPath,
    models,
    playback: {
      supported: playbackSupported,
      reason
    },
    download: {
      supported: playbackSupported,
      reason
    }
  };
}

function resolveBundledPiperRuntime(payload = {}) {
  const support = getBundledPiperSupport();
  if (!support.playback.supported) {
    throw new Error(support.playback.reason || "Bundled Piper is unavailable.");
  }

  const model = getBundledPiperModel(payload.modelId || payload.piperModelId);
  if (!model) {
    throw new Error("Requested bundled Piper model was not found.");
  }

  return {
    binaryPath: support.binaryPath,
    pythonPath: support.pythonPath,
    workerScriptPath: support.workerScriptPath,
    modelId: model.id,
    modelPath: model.path,
    modelConfigPath: model.configPath
  };
}

// ------------------------------------------------------------
// Python runtime resolution (bundled -> venv only, no system fallback)
// ------------------------------------------------------------
function getBundledPythonCommand() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "backend", "python")
    : path.join(__dirname, "backend", "python");
  const platformFolder = process.platform === "win32"
    ? "windows"
    : (process.platform === "darwin" ? "mac" : "linux");
  const platformBase = path.join(base, platformFolder);
  const candidates = [];

  if (process.platform === "win32") {
    candidates.push(path.join(platformBase, "python.exe"));
    candidates.push(path.join(platformBase, "Scripts", "python.exe"));
    candidates.push(path.join(platformBase, "bin", "python.exe"));
    candidates.push(path.join(base, "python.exe"));
    candidates.push(path.join(base, "Scripts", "python.exe"));
    candidates.push(path.join(base, "bin", "python.exe"));
  } else if (process.platform === "darwin") {
    candidates.push(path.join(platformBase, "bin", "python3"));
    candidates.push(path.join(platformBase, "bin", "python"));
    candidates.push(path.join(base, "bin", "python3"));
    candidates.push(path.join(base, "bin", "python"));
  } else {
    candidates.push(path.join(platformBase, "bin", "python3"));
    candidates.push(path.join(platformBase, "bin", "python"));
    candidates.push(path.join(base, "bin", "python3"));
    candidates.push(path.join(base, "bin", "python"));
  }

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function getVenvPythonCommand() {
  // In packaged apps, check user data directory first
  if (app.isPackaged) {
    const userVenvPython = process.platform === "win32"
      ? path.join(USER_DATA_DIR, "backend", "venv", "Scripts", "python.exe")
      : path.join(USER_DATA_DIR, "backend", "venv", "bin", "python");
    if (fs.existsSync(userVenvPython)) {
      return userVenvPython;
    }
  }
  
  // In dev mode, check in __dirname
  return process.platform === "win32"
    ? path.join(__dirname, "backend", "venv", "Scripts", "python.exe")
    : path.join(__dirname, "backend", "venv", "bin", "python");
}

function getPythonCommand() {
  const bundled = getBundledPythonCommand();
  if (bundled) return bundled;

  const venvPython = getVenvPythonCommand();
  if (fs.existsSync(venvPython)) return venvPython;

  return null;
}

// ------------------------------------------------------------
// Electron flags to fix compositor/cursor issues
// ------------------------------------------------------------
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('enable-begin-frame-scheduling');

// ------------------------------------------------------------
// Disable sandbox for Linux AppImage (SUID sandbox can't work in AppImage)
// ------------------------------------------------------------
if (process.platform === 'linux' && process.env.APPIMAGE) {
  app.commandLine.appendSwitch('no-sandbox');
  // Some environments have broken /dev/shm permissions/mounts.
  app.commandLine.appendSwitch('disable-dev-shm-usage');

  // If /tmp is also restricted, force Chromium temp/shared files into app-local storage.
  try {
    const chromiumTmpDir = path.join(app.getPath("userData"), "chromium-tmp");
    fs.mkdirSync(chromiumTmpDir, { recursive: true, mode: 0o700 });
    process.env.TMPDIR = chromiumTmpDir;
    process.env.TMP = chromiumTmpDir;
    process.env.TEMP = chromiumTmpDir;
    app.commandLine.appendSwitch("user-data-dir", app.getPath("userData"));
    console.log("Chromium tmp dir:", chromiumTmpDir);
  } catch (err) {
    console.error("Failed to configure Chromium tmp dir:", err.message);
  }
}

// ------------------------------------------------------------
// User data paths (writable in packaged apps)
// ------------------------------------------------------------
const USER_DATA_DIR = app.getPath("userData");
const USER_BACKEND_DIR = path.join(USER_DATA_DIR, "backend");
const USER_MODELS_DIR = path.join(USER_BACKEND_DIR, "models");
const VAULT_PATH = path.join(USER_BACKEND_DIR, "extal_vault.json");
const BUNDLED_VAULT_PATH = path.join(__dirname, "backend", "extal_vault.json");

// ------------------------------------------------------------
// Ensure vault exists
// ------------------------------------------------------------
function ensureVaultExists() {
  if (!fs.existsSync(USER_BACKEND_DIR)) {
    fs.mkdirSync(USER_BACKEND_DIR, { recursive: true });
  }

  if (!fs.existsSync(VAULT_PATH)) {
    if (fs.existsSync(BUNDLED_VAULT_PATH)) {
      fs.copyFileSync(BUNDLED_VAULT_PATH, VAULT_PATH);
    } else {
      const emptyVault = {
        topics: {},
        writing: {},
        characters: {},
        events: {},
        maps: {}
      };
      fs.writeFileSync(VAULT_PATH, JSON.stringify(emptyVault, null, 2));
    }
  }
}

const EXPORT_FORMATS = new Set(["html", "xml", "docx", "pdf"]);
const CATEGORY_TO_SECTION_KEY = {
  topics: "topics",
  writing: "writing",
  characters: "characters",
  timeline: "events",
  events: "events",
  maps: "maps"
};
const EXPORT_TAB_DEFS = [
  { key: "topics", title: "Topics" },
  { key: "writing", title: "Writing" },
  { key: "characters", title: "Characters" },
  { key: "events", title: "Timeline Events" },
  { key: "maps", title: "Maps" }
];
const INLINE_ASSET_CACHE = new Map();

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function toXmlTagName(name) {
  let tag = String(name || "item").replace(/[^A-Za-z0-9_.-]/g, "_");
  if (!/^[A-Za-z_]/.test(tag)) tag = `_${tag}`;
  return tag || "item";
}

function getItemDisplayName(item) {
  if (!item || typeof item !== "object") return "Unnamed";
  const fullName = [item.firstName, item.lastName].filter(Boolean).join(" ").trim();
  return item.name || item.title || fullName || item.id || "Unnamed";
}

function sortByDisplayName(a, b) {
  const aName = getItemDisplayName(a).toLowerCase();
  const bName = getItemDisplayName(b).toLowerCase();
  if (aName < bName) return -1;
  if (aName > bName) return 1;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function sortByOrderThenName(a, b) {
  const aOrder = Number.isFinite(Number(a?.order)) ? Number(a.order) : Number.MAX_SAFE_INTEGER;
  const bOrder = Number.isFinite(Number(b?.order)) ? Number(b.order) : Number.MAX_SAFE_INTEGER;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return sortByDisplayName(a, b);
}

function formatFieldLabel(key) {
  const normalized = String(key || "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return normalized
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isPrimitive(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function extractPrimitiveFields(item, omittedKeys = new Set()) {
  if (!item || typeof item !== "object") return [];
  const fields = [];
  Object.keys(item).sort().forEach((key) => {
    if (omittedKeys.has(key)) return;
    const value = item[key];
    if (value === null || value === undefined || value === "") return;
    if (Array.isArray(value)) {
      const allPrimitive = value.every((entry) => isPrimitive(entry));
      if (!allPrimitive || value.length === 0) return;
      fields.push({ key, label: formatFieldLabel(key), value: value.join(", ") });
      return;
    }
    if (!isPrimitive(value)) return;
    fields.push({ key, label: formatFieldLabel(key), value: String(value) });
  });
  return fields;
}

function isLikelyHtml(value) {
  return /<\/?[a-z][\s\S]*>/i.test(String(value || ""));
}

function markdownishToHtml(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  const out = [];
  let inUl = false;
  let inOl = false;
  let paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.map((line) => escapeHtml(line)).join("<br>")}</p>`);
    paragraph = [];
  };
  const closeLists = () => {
    if (inUl) { out.push("</ul>"); inUl = false; }
    if (inOl) { out.push("</ol>"); inOl = false; }
  };

  for (const lineRaw of lines) {
    const line = String(lineRaw || "");
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      closeLists();
      continue;
    }

    const h = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (h) {
      flushParagraph();
      closeLists();
      const level = h[1].length;
      out.push(`<h${level}>${escapeHtml(h[2])}</h${level}>`);
      continue;
    }

    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      closeLists();
      out.push(`<blockquote>${escapeHtml(quote[1])}</blockquote>`);
      continue;
    }

    const ul = trimmed.match(/^[-*]\s+(.*)$/);
    if (ul) {
      flushParagraph();
      if (inOl) { out.push("</ol>"); inOl = false; }
      if (!inUl) { out.push("<ul>"); inUl = true; }
      out.push(`<li>${escapeHtml(ul[1])}</li>`);
      continue;
    }

    const ol = trimmed.match(/^\d+\.\s+(.*)$/);
    if (ol) {
      flushParagraph();
      if (inUl) { out.push("</ul>"); inUl = false; }
      if (!inOl) { out.push("<ol>"); inOl = true; }
      out.push(`<li>${escapeHtml(ol[1])}</li>`);
      continue;
    }

    closeLists();
    paragraph.push(line);
  }

  flushParagraph();
  closeLists();
  return out.join("\n");
}

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".bmp") return "image/bmp";
  return "application/octet-stream";
}

function getInlineAssetDataUrl(assetRelPath) {
  const key = String(assetRelPath || "").replace(/^\/+/, "");
  if (!key) return null;
  if (INLINE_ASSET_CACHE.has(key)) return INLINE_ASSET_CACHE.get(key);

  const absolutePath = path.join(__dirname, "frontend", key);
  if (!fs.existsSync(absolutePath)) {
    INLINE_ASSET_CACHE.set(key, null);
    return null;
  }

  try {
    const fileData = fs.readFileSync(absolutePath);
    const mime = guessMimeType(absolutePath);
    const dataUrl = `data:${mime};base64,${fileData.toString("base64")}`;
    INLINE_ASSET_CACHE.set(key, dataUrl);
    return dataUrl;
  } catch (_) {
    INLINE_ASSET_CACHE.set(key, null);
    return null;
  }
}

function sanitizeRichHtml(rawHtml) {
  let html = String(rawHtml || "");
  html = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<style[\s\S]*?<\/style>/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  html = html.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  html = html.replace(/\s(href|src)\s*=\s*"javascript:[^"]*"/gi, (_full, attr) => ` ${String(attr).toLowerCase()}="#"`);
  html = html.replace(/\s(href|src)\s*=\s*'javascript:[^']*'/gi, (_full, attr) => ` ${String(attr).toLowerCase()}='#'`);
  html = html.replace(/src=(['"])(assets\/[^'"]+)\1/gi, (full, quote, rel) => {
    const dataUrl = getInlineAssetDataUrl(rel);
    if (!dataUrl) return full;
    return `src=${quote}${dataUrl}${quote}`;
  });
  return html;
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function htmlToPlainText(html) {
  const cleaned = String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/blockquote)>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(cleaned)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeRichContent(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return { html: "", text: "" };
  const html = isLikelyHtml(raw) ? sanitizeRichHtml(raw) : markdownishToHtml(raw);
  return { html, text: htmlToPlainText(html) };
}

function createExportEntry(type, item, extra = {}) {
  const displayName = getItemDisplayName(item);
  const omitted = new Set([
    "id", "name", "title", "type", "parentId", "order",
    "content", "description", "bio", "notes", "personality",
    "background", "motivations", "links", "markers"
  ]);
  const fields = extractPrimitiveFields(item, omitted);

  const contentFieldOrder = [
    ["content", "Content"],
    ["description", "Description"],
    ["bio", "Biography"],
    ["notes", "Notes"],
    ["personality", "Personality"],
    ["background", "Background"],
    ["motivations", "Motivations"]
  ];

  let mainLabel = "Content";
  let mainContent = { html: "", text: "" };
  const blocks = [];

  for (const [key, label] of contentFieldOrder) {
    const value = item && item[key];
    if (value === null || value === undefined || value === "") continue;
    const normalized = normalizeRichContent(value);
    if (!normalized.html && !normalized.text) continue;
    if (!mainContent.html && !mainContent.text) {
      mainLabel = label;
      mainContent = normalized;
    } else {
      blocks.push({ label, html: normalized.html, text: normalized.text });
    }
  }

  return {
    type,
    id: item?.id || "",
    name: displayName,
    mainLabel,
    contentHtml: mainContent.html,
    contentText: mainContent.text,
    fields,
    blocks,
    children: Array.isArray(extra.children) ? extra.children : []
  };
}

function buildTopicTreeEntries(topicsMap) {
  const topics = Object.values(topicsMap || {});
  if (!topics.length) return [];

  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const childrenByParent = new Map();
  const pushChild = (parentId, topic) => {
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(topic);
  };

  topics.forEach((topic) => {
    const parentId = topic && topic.parentId && byId.has(topic.parentId) ? topic.parentId : null;
    pushChild(parentId, topic);
  });

  const buildNode = (topic) => {
    const kids = (childrenByParent.get(topic.id) || [])
      .slice()
      .sort(sortByOrderThenName)
      .map((child) => buildNode(child));
    return createExportEntry("topic", topic, { children: kids });
  };

  let roots = (childrenByParent.get(null) || []).slice().sort(sortByOrderThenName);
  if (!roots.length) roots = topics.slice().sort(sortByOrderThenName);
  return roots.map((topic) => buildNode(topic));
}

function buildCharacterEntries(charsMap) {
  return Object.values(charsMap || {})
    .sort(sortByDisplayName)
    .map((character) => createExportEntry("character", character));
}

function buildEventEntries(eventsMap) {
  return Object.values(eventsMap || {})
    .sort(sortByDisplayName)
    .map((event) => createExportEntry("event", event));
}

function buildMapEntries(mapsMap) {
  return Object.values(mapsMap || {})
    .sort(sortByDisplayName)
    .map((mapItem) => {
      const markers = Array.isArray(mapItem.markers) ? mapItem.markers : [];
      const markerEntries = markers.map((marker, index) => {
        const withName = {
          ...marker,
          name: marker?.name || marker?.label || `Marker ${index + 1}`,
          id: marker?.id || `${mapItem.id || "map"}-marker-${index + 1}`
        };
        return createExportEntry("marker", withName);
      });
      return createExportEntry("map", mapItem, { children: markerEntries });
    });
}

function buildWritingTreeEntries(writingMap) {
  const nodes = Object.values(writingMap || {});
  const chapters = nodes.filter((n) => n && n.kind === "chapter");
  const scenes = nodes.filter((n) => n && n.kind === "scene");

  const scenesByParent = new Map();
  scenes.forEach((scene) => {
    const parentId = scene.parentId || null;
    if (!scenesByParent.has(parentId)) scenesByParent.set(parentId, []);
    scenesByParent.get(parentId).push(scene);
  });

  const chapterEntries = chapters
    .slice()
    .sort(sortByOrderThenName)
    .map((chapter) => {
      const childScenes = (scenesByParent.get(chapter.id) || []).slice().sort(sortByOrderThenName);
      const children = childScenes.map((scene) => createExportEntry("writing-scene", scene));
      return createExportEntry("writing-chapter", chapter, { children });
    });

  const orphanScenes = (scenesByParent.get(null) || []).slice().sort(sortByOrderThenName);
  const orphanEntries = orphanScenes.map((scene) => createExportEntry("writing-scene", scene));
  return chapterEntries.concat(orphanEntries);
}

function countEntries(entries) {
  return (entries || []).reduce((sum, entry) => sum + 1 + countEntries(entry.children || []), 0);
}

function buildExportModel(worldData, scope, category) {
  const currentSectionKey = CATEGORY_TO_SECTION_KEY[String(category || "").toLowerCase()] || null;
  const activeDefs = (scope === "current" && currentSectionKey)
    ? EXPORT_TAB_DEFS.filter((def) => def.key === currentSectionKey)
    : EXPORT_TAB_DEFS;

  const source = (worldData && typeof worldData === "object") ? worldData : {};
  const sections = activeDefs.map((def) => {
    let entries = [];
    if (def.key === "topics") entries = buildTopicTreeEntries(source.topics || {});
    else if (def.key === "writing") entries = buildWritingTreeEntries(source.writing || {});
    else if (def.key === "characters") entries = buildCharacterEntries(source.characters || {});
    else if (def.key === "events") entries = buildEventEntries(source.events || {});
    else if (def.key === "maps") entries = buildMapEntries(source.maps || {});
    return {
      key: def.key,
      title: def.title,
      entries,
      count: countEntries(entries)
    };
  });

  return {
    title: scope === "current" ? `Extal Export - ${category || "Current Tab"}` : "Extal Export - Full Vault",
    generatedAt: new Date().toISOString(),
    scope,
    category,
    sections
  };
}

function renderHtmlEntry(entry, depth = 0) {
  const fieldsHtml = entry.fields.length
    ? `<dl class="fields">${entry.fields.map((f) => `<dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd>`).join("")}</dl>`
    : "";
  const mainHtml = entry.contentHtml
    ? `<div class="block"><h4>${escapeHtml(entry.mainLabel)}</h4><div class="rich-content">${entry.contentHtml}</div></div>`
    : "";
  const blocksHtml = entry.blocks.map((block) => (
    `<div class="block"><h4>${escapeHtml(block.label)}</h4><div class="rich-content">${block.html}</div></div>`
  )).join("");
  const childrenHtml = (entry.children || []).length
    ? `<div class="children">${entry.children.map((child) => renderHtmlEntry(child, depth + 1)).join("")}</div>`
    : "";

  return `<article class="entry depth-${Math.min(depth, 6)} type-${escapeHtml(entry.type)}">
    <h3>${escapeHtml(entry.name)}${entry.id ? ` <span class="id">(${escapeHtml(entry.id)})</span>` : ""}</h3>
    ${fieldsHtml}
    ${mainHtml}
    ${blocksHtml}
    ${childrenHtml}
  </article>`;
}

function buildExportHtml(model) {
  const tabList = model.sections
    .map((section) => `<li><a href="#tab-${escapeHtml(section.key)}">${escapeHtml(section.title)} (${section.count})</a></li>`)
    .join("");
  const sectionHtml = model.sections.map((section) => `
    <section id="tab-${escapeHtml(section.key)}" class="tab-section">
      <h2>${escapeHtml(section.title)} <span class="count">(${section.count})</span></h2>
      ${section.entries.length ? section.entries.map((entry) => renderHtmlEntry(entry, 0)).join("") : '<p class="empty">No entries.</p>'}
    </section>
  `).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(model.title)}</title>
  <style>
    body { font-family: "Segoe UI", Arial, sans-serif; margin: 26px; color: #222; line-height: 1.45; }
    h1 { margin: 0 0 6px 0; font-size: 26px; }
    h2 { margin: 28px 0 10px 0; font-size: 20px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    h3 { margin: 0 0 8px 0; font-size: 15px; }
    h4 { margin: 10px 0 6px 0; font-size: 12px; color: #555; text-transform: uppercase; letter-spacing: 0.04em; }
    .meta { color: #555; font-size: 12px; margin-bottom: 10px; }
    .tabs { margin: 0 0 12px 0; padding-left: 18px; }
    .tabs li { margin: 2px 0; }
    .tabs a { color: #0b5cab; text-decoration: none; }
    .tabs a:hover { text-decoration: underline; }
    .count { color: #666; font-weight: normal; font-size: 13px; }
    .id { color: #666; font-weight: normal; font-size: 12px; }
    .entry { border: 1px solid #e4e4e4; border-radius: 6px; padding: 10px 12px; margin: 10px 0; background: #fff; }
    .children { margin-top: 10px; padding-left: 14px; border-left: 2px solid #eee; }
    .fields { display: grid; grid-template-columns: max-content 1fr; gap: 4px 8px; margin: 6px 0 4px; font-size: 12px; }
    .fields dt { font-weight: 600; color: #444; }
    .fields dd { margin: 0; color: #555; }
    .rich-content { font-size: 13px; }
    .rich-content p { margin: 0 0 7px 0; }
    .rich-content img { max-width: 100%; height: auto; }
    .rich-content table { border-collapse: collapse; width: 100%; }
    .rich-content td, .rich-content th { border: 1px solid #bbb; padding: 4px 6px; vertical-align: top; }
    .block { margin-top: 8px; }
    .empty { color: #666; font-style: italic; }
    @media print { body { margin: 10mm; } .entry { page-break-inside: avoid; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(model.title)}</h1>
  <div class="meta">Generated: ${escapeHtml(model.generatedAt)} | Scope: ${escapeHtml(model.scope)}</div>
  <ul class="tabs">${tabList}</ul>
  ${sectionHtml}
</body>
</html>`;
}

function buildXmlEntry(entry) {
  const attrs = `type="${escapeXml(entry.type)}" id="${escapeXml(entry.id || "")}" name="${escapeXml(entry.name || "")}"`;
  const fieldsXml = entry.fields.map((field) =>
    `<field key="${escapeXml(field.key)}" label="${escapeXml(field.label)}">${escapeXml(field.value)}</field>`
  ).join("");
  const blocksXml = entry.blocks.map((block) =>
    `<block label="${escapeXml(block.label)}">${escapeXml(block.text || "")}</block>`
  ).join("");
  const childrenXml = (entry.children || []).map((child) => buildXmlEntry(child)).join("");
  const contentText = escapeXml(entry.contentText || "");

  return `<entry ${attrs}>` +
    (fieldsXml ? `<fields>${fieldsXml}</fields>` : "") +
    (contentText ? `<content label="${escapeXml(entry.mainLabel || "Content")}">${contentText}</content>` : "") +
    (blocksXml ? `<blocks>${blocksXml}</blocks>` : "") +
    (childrenXml ? `<children>${childrenXml}</children>` : "") +
    `</entry>`;
}

function buildExportXml(model) {
  const sectionsXml = model.sections.map((section) => {
    const entriesXml = section.entries.map((entry) => buildXmlEntry(entry)).join("");
    return `<tab key="${escapeXml(section.key)}" title="${escapeXml(section.title)}" count="${section.count}">${entriesXml}</tab>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<extalExport title="${escapeXml(model.title)}" generatedAt="${escapeXml(model.generatedAt)}" scope="${escapeXml(model.scope)}">` +
    `${sectionsXml}` +
    `</extalExport>\n`;
}

function appendEntryTextLines(lines, entry, depth = 0) {
  const indent = "  ".repeat(depth);
  lines.push(`${indent}- ${entry.name}${entry.id ? ` [${entry.id}]` : ""}`);
  entry.fields.forEach((field) => {
    lines.push(`${indent}  ${field.label}: ${field.value}`);
  });
  if (entry.contentText) {
    lines.push(`${indent}  ${entry.mainLabel}:`);
    entry.contentText.split(/\r?\n/).forEach((line) => {
      lines.push(`${indent}    ${line}`);
    });
  }
  entry.blocks.forEach((block) => {
    lines.push(`${indent}  ${block.label}:`);
    String(block.text || "").split(/\r?\n/).forEach((line) => {
      lines.push(`${indent}    ${line}`);
    });
  });
  (entry.children || []).forEach((child) => appendEntryTextLines(lines, child, depth + 1));
}

function buildExportText(model) {
  const lines = [];
  lines.push(model.title);
  lines.push(`Generated: ${model.generatedAt}`);
  lines.push(`Scope: ${model.scope}`);
  lines.push("");

  model.sections.forEach((section) => {
    lines.push(`${section.title} (${section.count})`);
    lines.push("-".repeat(Math.max(12, section.title.length + 8)));
    if (!section.entries.length) {
      lines.push("No entries.");
    } else {
      section.entries.forEach((entry) => appendEntryTextLines(lines, entry, 0));
    }
    lines.push("");
  });

  return lines.join("\n");
}

let _crcTable = null;
function getCrcTable() {
  if (_crcTable) return _crcTable;
  _crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    _crcTable[n] = c >>> 0;
  }
  return _crcTable;
}

function crc32(buffer) {
  const table = getCrcTable();
  let crc = 0 ^ (-1);
  for (let i = 0; i < buffer.length; i += 1) {
    crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

function createZipBuffer(entries) {
  const localChunks = [];
  const centralChunks = [];
  let offset = 0;

  entries.forEach((entry) => {
    const nameBuffer = Buffer.from(String(entry.name).replace(/\\/g, "/"), "utf8");
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), "utf8");
    const checksum = crc32(dataBuffer);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(dataBuffer.length, 18);
    localHeader.writeUInt32LE(dataBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localChunks.push(localHeader, nameBuffer, dataBuffer);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(dataBuffer.length, 20);
    centralHeader.writeUInt32LE(dataBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralChunks.push(centralHeader, nameBuffer);
    offset += localHeader.length + nameBuffer.length + dataBuffer.length;
  });

  const centralDirectory = Buffer.concat(centralChunks);
  const endOfCentral = Buffer.alloc(22);
  endOfCentral.writeUInt32LE(0x06054b50, 0);
  endOfCentral.writeUInt16LE(0, 4);
  endOfCentral.writeUInt16LE(0, 6);
  endOfCentral.writeUInt16LE(entries.length, 8);
  endOfCentral.writeUInt16LE(entries.length, 10);
  endOfCentral.writeUInt32LE(centralDirectory.length, 12);
  endOfCentral.writeUInt32LE(offset, 16);
  endOfCentral.writeUInt16LE(0, 20);

  return Buffer.concat([...localChunks, centralDirectory, endOfCentral]);
}

function parseInlineStyle(styleValue) {
  const style = String(styleValue || "");
  const out = {};
  style.split(";").forEach((pair) => {
    const idx = pair.indexOf(":");
    if (idx <= 0) return;
    const key = pair.slice(0, idx).trim().toLowerCase();
    const value = pair.slice(idx + 1).trim().toLowerCase();
    if (!key) return;
    out[key] = value;
  });
  return out;
}

function tokenizeHtml(input) {
  const html = String(input || "");
  const tokens = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      if (i < html.length) tokens.push({ type: "text", value: html.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ type: "text", value: html.slice(i, lt) });

    // Comment
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      if (end === -1) break;
      i = end + 3;
      continue;
    }

    const gt = html.indexOf(">", lt + 1);
    if (gt === -1) break;
    const raw = html.slice(lt + 1, gt).trim();
    i = gt + 1;
    if (!raw) continue;
    if (raw[0] === "!") continue; // doctype, etc.

    const isClosing = raw.startsWith("/");
    const body = (isClosing ? raw.slice(1) : raw).trim().replace(/\/\s*$/, "");
    const match = body.match(/^([a-zA-Z0-9:-]+)/);
    if (!match) continue;
    const name = match[1].toLowerCase();
    const attrString = body.slice(match[1].length).trim();

    const attrs = {};
    attrString.replace(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g, (_, k, v1, v2, v3) => {
      const key = String(k || "").toLowerCase();
      const value = v1 ?? v2 ?? v3 ?? "";
      if (key) attrs[key] = String(value);
      return "";
    });

    const selfClosing = /\/\s*$/.test(raw) || name === "br" || name === "img" || name === "hr" || name === "meta" || name === "link";
    tokens.push({ type: "tag", name, attrs, isClosing, selfClosing });
  }
  return tokens;
}

function sniffImageTypeFromBuffer(buffer) {
  if (!buffer || buffer.length < 12) return null;
  // PNG signature
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return "png";
  // JPEG SOI
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) return "jpeg";
  // GIF
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return "gif";
  return null;
}

function getPngDimensions(buffer) {
  // IHDR chunk starts at byte 8; width/height are big-endian at 16/20
  if (!buffer || buffer.length < 24) return null;
  const signatureOk = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
  if (!signatureOk) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

function getJpegDimensions(buffer) {
  if (!buffer || buffer.length < 4) return null;
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;
  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xFF) { offset += 1; continue; }
    const marker = buffer[offset + 1];
    // Standalone markers
    if (marker === 0xD9 || marker === 0xDA) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    // SOF markers that contain dimensions
    if (
      marker === 0xC0 || marker === 0xC1 || marker === 0xC2 || marker === 0xC3 ||
      marker === 0xC5 || marker === 0xC6 || marker === 0xC7 ||
      marker === 0xC9 || marker === 0xCA || marker === 0xCB ||
      marker === 0xCD || marker === 0xCE || marker === 0xCF
    ) {
      if (offset + 2 + length > buffer.length) return null;
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      if (!width || !height) return null;
      return { width, height };
    }
    offset += 2 + length;
  }
  return null;
}

function resolveImageSourceToBuffer(src) {
  const value = String(src || "").trim();
  if (!value) return null;

  // data: URL
  if (value.startsWith("data:")) {
    const match = value.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
    if (!match) return null;
    const mime = (match[1] || "").toLowerCase();
    const isBase64 = !!match[2];
    const dataPart = match[3] || "";
    const buf = isBase64 ? Buffer.from(dataPart, "base64") : Buffer.from(decodeURIComponent(dataPart), "utf8");
    const kind = mime.includes("png") ? "png" : mime.includes("jpeg") || mime.includes("jpg") ? "jpeg" : mime.includes("gif") ? "gif" : sniffImageTypeFromBuffer(buf);
    return { buffer: buf, kind };
  }

  // file:// URL or raw path
  let filePath = value;
  try {
    if (value.startsWith("file://")) filePath = require("url").fileURLToPath(value);
  } catch (_) {}

  try {
    if (!fs.existsSync(filePath)) return null;
    const buf = fs.readFileSync(filePath);
    const kind = sniffImageTypeFromBuffer(buf) || path.extname(filePath).slice(1).toLowerCase();
    return { buffer: buf, kind };
  } catch (_) {
    return null;
  }
}

function imageContentType(kind) {
  const k = String(kind || "").toLowerCase();
  if (k === "png") return "image/png";
  if (k === "jpg" || k === "jpeg") return "image/jpeg";
  if (k === "gif") return "image/gif";
  return null;
}

function buildDocxBufferFromHtml(htmlContent) {
  const tokens = tokenizeHtml(htmlContent);
  const docRels = [];
  const mediaFiles = []; // { name, buffer, kind, contentType }
  const mediaByKey = new Map(); // src -> { relId, name, cx, cy }
  let nextRelId = 2; // rId1 reserved for numbering.xml
  let nextPicId = 1;
  const ensureHyperlinkRel = (url) => {
    const href = String(url || "").trim();
    if (!href) return null;
    const existing = docRels.find((r) => r.type === "hyperlink" && r.target === href);
    if (existing) return existing.id;
    const id = `rId${nextRelId++}`;
    docRels.push({ id, type: "hyperlink", target: href, mode: "External" });
    return id;
  };
  const ensureImageRel = (src, attrs = {}) => {
    const key = String(src || "").trim();
    if (!key) return null;
    const cached = mediaByKey.get(key);
    if (cached) return cached;

    const resolved = resolveImageSourceToBuffer(key);
    if (!resolved || !resolved.buffer) return null;

    const kind = resolved.kind === "jpg" ? "jpeg" : resolved.kind;
    const contentType = imageContentType(kind);
    if (!contentType) return null;

    const ext = kind === "jpeg" ? "jpg" : kind;
    const name = `image${mediaFiles.length + 1}.${ext}`;
    mediaFiles.push({ name, buffer: resolved.buffer, kind, contentType });

    const id = `rId${nextRelId++}`;
    docRels.push({ id, type: "image", target: `media/${name}`, mode: null });

    // Dimensions
    const pxToEmu = (px) => Math.max(1, Math.round(Number(px) * 9525));
    const pageWidthEmu = 5943600; // 6.5" @ 914400 EMU/in
    let widthPx = null;
    let heightPx = null;
    if (attrs.width) widthPx = Number(String(attrs.width).replace(/[^0-9.]/g, "")) || null;
    if (attrs.height) heightPx = Number(String(attrs.height).replace(/[^0-9.]/g, "")) || null;
    const style = parseInlineStyle(attrs.style);
    if (!widthPx && style.width && style.width.endsWith("px")) widthPx = Number(style.width.replace("px", "")) || null;
    if (!heightPx && style.height && style.height.endsWith("px")) heightPx = Number(style.height.replace("px", "")) || null;

    const dims = kind === "png" ? getPngDimensions(resolved.buffer) : kind === "jpeg" ? getJpegDimensions(resolved.buffer) : null;
    const intrinsicW = dims?.width || 800;
    const intrinsicH = dims?.height || 600;
    const aspect = intrinsicW > 0 ? intrinsicH / intrinsicW : 0.75;

    if (!widthPx && !heightPx) {
      widthPx = intrinsicW;
      heightPx = intrinsicH;
    } else if (widthPx && !heightPx) {
      heightPx = Math.round(widthPx * aspect);
    } else if (!widthPx && heightPx) {
      widthPx = Math.round(heightPx / aspect);
    }

    let cx = pxToEmu(widthPx);
    let cy = pxToEmu(heightPx);
    if (cx > pageWidthEmu) {
      const scale = pageWidthEmu / cx;
      cx = Math.round(cx * scale);
      cy = Math.round(cy * scale);
    }

    const info = { relId: id, name, cx, cy, picId: nextPicId++ };
    mediaByKey.set(key, info);
    return info;
  };

  const bodyBlocks = []; // paragraphs + tables
  let currentRuns = [];
  let currentPPr = null;
  let paragraphTextSeen = false;

  const styleStack = [{ bold: false, italic: false, underline: false, strike: false, code: false, linkRid: null, size: null }];
  const listStack = []; // { type: 'ul'|'ol', level }
  let activeTable = null; // { rows: [ { cells: [ { blocks: [] } ] } ] }
  let activeRow = null;
  let activeCell = null;
  let activeCellBlocks = null;

  const currentStyle = () => styleStack[styleStack.length - 1];

  const pushStyle = (partial) => {
    const prev = currentStyle();
    styleStack.push({ ...prev, ...partial });
  };
  const popStyle = () => {
    if (styleStack.length > 1) styleStack.pop();
  };

  const toWAlign = (cssAlign) => {
    const v = String(cssAlign || "").toLowerCase();
    if (v === "center") return "center";
    if (v === "right") return "right";
    if (v === "justify") return "both";
    return null;
  };

  const flushParagraph = () => {
    if (!currentPPr && !currentRuns.length && !paragraphTextSeen) return;
    const runsXml = currentRuns.length ? currentRuns.join("") : `<w:r><w:t xml:space="preserve"> </w:t></w:r>`;
    const pPrXml = currentPPr ? `<w:pPr>${currentPPr}</w:pPr>` : "";
    const paragraphXml = `<w:p>${pPrXml}${runsXml}</w:p>`;
    if (activeCellBlocks) activeCellBlocks.push(paragraphXml);
    else bodyBlocks.push(paragraphXml);
    currentRuns = [];
    currentPPr = null;
    paragraphTextSeen = false;
  };

  const startParagraph = (pPrXml) => {
    flushParagraph();
    currentPPr = pPrXml || null;
  };

  const runPropsXml = (s) => {
    const parts = [];
    if (s.bold) parts.push("<w:b/>");
    if (s.italic) parts.push("<w:i/>");
    if (s.underline) parts.push('<w:u w:val="single"/>');
    if (s.strike) parts.push("<w:strike/>");
    if (Number.isFinite(Number(s.size)) && Number(s.size) > 0) parts.push(`<w:sz w:val="${Number(s.size)}"/>`);
    if (s.code) {
      parts.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/>');
      if (!Number.isFinite(Number(s.size))) parts.push('<w:sz w:val="22"/>');
    }
    return parts.length ? `<w:rPr>${parts.join("")}</w:rPr>` : "";
  };

  const addTextRun = (text, extra = {}) => {
    const raw = decodeHtmlEntities(String(text || ""));
    if (!raw) return;
    if (!currentPPr) startParagraph(null);

    const s = { ...currentStyle(), ...extra };
    const segments = raw.split(/\r?\n/);
    segments.forEach((seg, idx) => {
      if (idx > 0) {
        currentRuns.push("<w:r><w:br/></w:r>");
      }
      if (seg === "") return;
      const safe = escapeXml(seg);
      const rPr = runPropsXml(s);
      if (s.linkRid) {
        const mergedRpr = rPr
          ? rPr.replace("<w:rPr>", "<w:rPr><w:color w:val=\"0563C1\"/><w:u w:val=\"single\"/>")
          : '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>';
        const linkRun = `<w:r>${mergedRpr}<w:t xml:space="preserve">${safe}</w:t></w:r>`;
        currentRuns.push(`<w:hyperlink r:id="${escapeXml(s.linkRid)}">${linkRun}</w:hyperlink>`);
      } else {
        currentRuns.push(`<w:r>${rPr}<w:t xml:space="preserve">${safe}</w:t></w:r>`);
      }
      paragraphTextSeen = true;
    });
  };

  const addBlockBreak = () => {
    flushParagraph();
  };

  const addImageRun = (attrs) => {
    const info = ensureImageRel(attrs?.src, attrs);
    if (!info) {
      const alt = attrs?.alt || "";
      addTextRun(`[Image${alt ? `: ${alt}` : ""}]`);
      return;
    }

    if (!currentPPr) startParagraph(null);
    const docPrId = info.picId;
    const rId = info.relId;
    const cx = info.cx;
    const cy = info.cy;
    const name = info.name;

    const drawing = `<w:r><w:drawing>
      <wp:inline distT="0" distB="0" distL="0" distR="0">
        <wp:extent cx="${cx}" cy="${cy}"/>
        <wp:docPr id="${docPrId}" name="${escapeXml(name)}"/>
        <a:graphic>
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic>
              <pic:nvPicPr>
                <pic:cNvPr id="${docPrId}" name="${escapeXml(name)}"/>
                <pic:cNvPicPr/>
              </pic:nvPicPr>
              <pic:blipFill>
                <a:blip r:embed="${escapeXml(rId)}"/>
                <a:stretch><a:fillRect/></a:stretch>
              </pic:blipFill>
              <pic:spPr>
                <a:xfrm>
                  <a:off x="0" y="0"/>
                  <a:ext cx="${cx}" cy="${cy}"/>
                </a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              </pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing></w:r>`;

    currentRuns.push(drawing);
    paragraphTextSeen = true;
  };

  const buildListPPr = (listType, level) => {
    const numId = listType === "ol" ? 2 : 1;
    const ilvl = Math.max(0, Math.min(8, Number(level) || 0));
    const left = 720 + ilvl * 360;
    const hanging = 360;
    return `<w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr><w:ind w:left="${left}" w:hanging="${hanging}"/>`;
  };

  const openTag = (name, attrs) => {
    if (name === "strong" || name === "b") pushStyle({ bold: true });
    else if (name === "em" || name === "i") pushStyle({ italic: true });
    else if (name === "u") pushStyle({ underline: true });
    else if (name === "s" || name === "strike" || name === "del") pushStyle({ strike: true });
    else if (name === "code") pushStyle({ code: true });
    else if (name === "a") {
      const rid = ensureHyperlinkRel(attrs?.href);
      pushStyle({ linkRid: rid });
    } else if (name === "br") {
      if (!currentPPr) startParagraph(null);
      currentRuns.push("<w:r><w:br/></w:r>");
      paragraphTextSeen = true;
    } else if (name === "p" || name === "div") {
      const style = parseInlineStyle(attrs?.style);
      const align = toWAlign(style["text-align"]);
      const pPr = [];
      if (align) pPr.push(`<w:jc w:val="${align}"/>`);
      startParagraph(pPr.join(""));
    } else if (name === "h1" || name === "h2" || name === "h3" || name === "h4") {
      const style = parseInlineStyle(attrs?.style);
      const align = toWAlign(style["text-align"]);
      const pPr = [];
      if (align) pPr.push(`<w:jc w:val="${align}"/>`);
      pPr.push('<w:spacing w:before="240" w:after="120"/>');
      startParagraph(pPr.join(""));
      const level = name === "h1" ? 1 : name === "h2" ? 2 : name === "h3" ? 3 : 4;
      const size = level === 1 ? 44 : level === 2 ? 36 : level === 3 ? 30 : 26;
      pushStyle({ bold: true, size, code: false });
    } else if (name === "blockquote") {
      startParagraph('<w:ind w:left="720"/><w:spacing w:before="120" w:after="120"/>');
      pushStyle({ italic: true });
    } else if (name === "pre") {
      startParagraph('<w:spacing w:before="120" w:after="120"/><w:ind w:left="360"/>');
      pushStyle({ code: true });
    } else if (name === "ul" || name === "ol") {
      listStack.push({ type: name, level: listStack.length });
    } else if (name === "li") {
      const top = listStack[listStack.length - 1];
      if (top) startParagraph(buildListPPr(top.type, top.level));
      else startParagraph(null);
    } else if (name === "hr") {
      addBlockBreak();
    } else if (name === "img") {
      addImageRun(attrs);
    } else if (name === "table") {
      flushParagraph();
      activeTable = { rows: [] };
      activeRow = null;
      activeCell = null;
      activeCellBlocks = null;
    } else if (name === "tr") {
      if (!activeTable) return;
      flushParagraph();
      activeRow = { cells: [] };
      activeTable.rows.push(activeRow);
      activeCell = null;
      activeCellBlocks = null;
    } else if (name === "td" || name === "th") {
      if (!activeRow) return;
      flushParagraph();
      activeCell = { blocks: [] };
      activeRow.cells.push(activeCell);
      activeCellBlocks = activeCell.blocks;
      if (name === "th") pushStyle({ bold: true });
    } else if (name === "dl" || name === "dt" || name === "dd" || name === "article" || name === "section" || name === "header" || name === "footer") {
      // treat as block boundaries when they start
      if (name === "dt") pushStyle({ bold: true });
    } else if (name === "span") {
      const style = parseInlineStyle(attrs?.style);
      const next = {};
      if (style["font-weight"] && (style["font-weight"] === "bold" || Number(style["font-weight"]) >= 600)) next.bold = true;
      if (style["font-style"] === "italic") next.italic = true;
      if (style["text-decoration"] && style["text-decoration"].includes("underline")) next.underline = true;
      if (style["text-decoration"] && style["text-decoration"].includes("line-through")) next.strike = true;
      pushStyle(next);
    }
  };

  const closeTag = (name) => {
    if (name === "p" || name === "div" || name === "li" || name === "pre" || name === "blockquote") {
      flushParagraph();
    } else if (name === "h1" || name === "h2" || name === "h3" || name === "h4") {
      flushParagraph();
      popStyle();
      return;
    } else if (name === "ul" || name === "ol") {
      listStack.pop();
    } else if (name === "dt") {
      popStyle();
      flushParagraph();
      return;
    } else if (name === "td" || name === "th") {
      flushParagraph();
      if (activeCellBlocks && activeCellBlocks.length === 0) {
        activeCellBlocks.push(`<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>`);
      }
      activeCell = null;
      activeCellBlocks = null;
      if (name === "th") popStyle();
      return;
    } else if (name === "tr") {
      flushParagraph();
      activeRow = null;
      activeCell = null;
      activeCellBlocks = null;
      return;
    } else if (name === "table") {
      flushParagraph();
      if (!activeTable) return;
      const rowsXml = activeTable.rows.map((row) => {
        const cellsXml = (row.cells || []).map((cell) => {
          const inner = (cell.blocks && cell.blocks.length) ? cell.blocks.join("") : `<w:p><w:r><w:t xml:space="preserve"> </w:t></w:r></w:p>`;
          return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${inner}</w:tc>`;
        }).join("");
        return `<w:tr>${cellsXml}</w:tr>`;
      }).join("");
      const tbl = `<w:tbl>
        <w:tblPr>
          <w:tblW w:w="0" w:type="auto"/>
          <w:tblBorders>
            <w:top w:val="single" w:sz="8" w:space="0" w:color="auto"/>
            <w:left w:val="single" w:sz="8" w:space="0" w:color="auto"/>
            <w:bottom w:val="single" w:sz="8" w:space="0" w:color="auto"/>
            <w:right w:val="single" w:sz="8" w:space="0" w:color="auto"/>
            <w:insideH w:val="single" w:sz="6" w:space="0" w:color="auto"/>
            <w:insideV w:val="single" w:sz="6" w:space="0" w:color="auto"/>
          </w:tblBorders>
        </w:tblPr>
        ${rowsXml}
      </w:tbl>`;
      bodyBlocks.push(tbl);
      activeTable = null;
      activeRow = null;
      activeCell = null;
      activeCellBlocks = null;
      return;
    }

    if (name === "strong" || name === "b" || name === "em" || name === "i" || name === "u" || name === "s" || name === "strike" || name === "del" || name === "code" || name === "a" || name === "span" || name === "blockquote" || name === "pre") {
      popStyle();
    }
  };

  let skipDepth = 0;
  tokens.forEach((tok) => {
    if (tok.type === "tag") {
      if (!tok.isClosing) {
        if (tok.name === "style" || tok.name === "script") {
          skipDepth += 1;
          return;
        }
        openTag(tok.name, tok.attrs);
        if (tok.selfClosing) {
          // For self closing, immediately close style changes if any
          if (tok.name === "a" || tok.name === "span") closeTag(tok.name);
        }
      } else {
        if (tok.name === "style" || tok.name === "script") {
          skipDepth = Math.max(0, skipDepth - 1);
          return;
        }
        closeTag(tok.name);
      }
      return;
    }

    if (tok.type === "text") {
      if (skipDepth > 0) return;
      const s = currentStyle();
      let text = String(tok.value || "");
      if (!s.code) {
        text = text.replace(/\s+/g, " ");
        if (!text.trim()) return;
      }
      addTextRun(text);
    }
  });
  flushParagraph();

  const paragraphXml = bodyBlocks.join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
 xmlns:v="urn:schemas-microsoft-com:vml"
 xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:w10="urn:schemas-microsoft-com:office:word"
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
 xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
 xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
 xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
 mc:Ignorable="w14 wp14">
  <w:body>
    ${paragraphXml}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
      <w:cols w:space="708"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="1">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1080" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="2"><w:numFmt w:val="bullet"/><w:lvlText w:val="▪"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="2">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1080" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="2"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%3."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>
</w:numbering>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="gif" ContentType="image/gif"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  ${docRels.map((r) => (
    r.type === "hyperlink"
      ? `<Relationship Id="${escapeXml(r.id)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(r.target)}" TargetMode="External"/>`
      : `<Relationship Id="${escapeXml(r.id)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${escapeXml(r.target)}"/>`
  )).join("\n  ")}
</Relationships>`;

  const zipEntries = [
    { name: "[Content_Types].xml", data: contentTypesXml },
    { name: "_rels/.rels", data: relsXml },
    { name: "word/document.xml", data: documentXml },
    { name: "word/numbering.xml", data: numberingXml },
    { name: "word/_rels/document.xml.rels", data: docRelsXml }
  ];
  mediaFiles.forEach((m) => {
    zipEntries.push({ name: `word/media/${m.name}`, data: m.buffer });
  });
  return createZipBuffer(zipEntries);
}

function buildDocxBuffer(textContent) {
  const text = String(textContent || "");
  const paragraphXml = text.split(/\r?\n/).map((line) => {
    const safe = escapeXml(line.length ? line : " ");
    return `<w:p><w:r><w:t xml:space="preserve">${safe}</w:t></w:r></w:p>`;
  }).join("");

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
 xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
 xmlns:v="urn:schemas-microsoft-com:vml"
 xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:w10="urn:schemas-microsoft-com:office:word"
 xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
 xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
 xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
 xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
 xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
 mc:Ignorable="w14 wp14">
  <w:body>
    ${paragraphXml}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
      <w:cols w:space="708"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  return createZipBuffer([
    { name: "[Content_Types].xml", data: contentTypesXml },
    { name: "_rels/.rels", data: relsXml },
    { name: "word/document.xml", data: documentXml },
    { name: "word/_rels/document.xml.rels", data: docRelsXml }
  ]);
}

function ensureFileExtension(filePath, format) {
  if (!filePath) return filePath;
  return path.extname(filePath) ? filePath : `${filePath}.${format}`;
}

async function writePdfFromHtml(filePath, html) {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: {
      sandbox: false,
      contextIsolation: true
    }
  });
  try {
    const url = `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
    await win.loadURL(url);
    const pdfData = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      landscape: false,
      marginsType: 0
    });
    fs.writeFileSync(filePath, pdfData);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

function stripHtmlToText(html) {
  const input = String(html || "");
  // Very lightweight: remove tags + decode basic entities handled by renderer; keep whitespace readable.
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<\/h[1-6]\s*>/gi, "\n\n")
    .replace(/<\/li\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildWritingManuscriptModel(writingMap, { scope = "project", chapterId = null, selectedIds = null, orderedSceneIds = null, includeChapterHeadings = true } = {}) {
  const nodes = Object.values(writingMap || {}).filter(Boolean);
  const chapters = nodes.filter((n) => n.kind === "chapter").slice().sort(sortByOrderThenName);
  const scenes = nodes.filter((n) => n.kind === "scene");
  const byParent = new Map();
  scenes.forEach((scene) => {
    const pid = scene.parentId || null;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(scene);
  });
  byParent.forEach((arr) => arr.sort(sortByOrderThenName));

  const selectionMode = String(scope || "project").toLowerCase() === "selection";
  const selectedSet = selectionMode && Array.isArray(selectedIds)
    ? new Set(selectedIds.map((v) => String(v)))
    : null;

  const selectedChapters = (String(scope || "project").toLowerCase() === "chapter" && chapterId)
    ? chapters.filter((c) => String(c.id) === String(chapterId))
    : (selectionMode ? chapters : chapters);

  const hasOrderedSceneIds = selectionMode && Array.isArray(orderedSceneIds) && orderedSceneIds.length > 0;
  const blocks = [];

  if (hasOrderedSceneIds) {
    const chapterById = new Map(chapters.map((c) => [String(c.id), c]));
    const sceneById = new Map(scenes.map((s) => [String(s.id), s]));
    let lastChapterKey = null;

    orderedSceneIds.forEach((sceneId) => {
      const scene = sceneById.get(String(sceneId));
      if (!scene) return;
      const chapId = scene.parentId ? String(scene.parentId) : null;
      const chapterTitle = chapId
        ? (chapterById.get(chapId)?.name || "Untitled Chapter")
        : "Scenes";

      if (includeChapterHeadings && chapterTitle !== lastChapterKey) {
        blocks.push({ type: "chapter", title: chapterTitle });
        lastChapterKey = chapterTitle;
      }

      blocks.push({ type: "scene", title: scene.name || "Untitled Scene", html: String(scene.content || "") });
    });
  } else {
    selectedChapters.forEach((chapter) => {
      const chapterScenes = byParent.get(chapter.id) || [];
      const includeAllScenes = !selectionMode || (selectedSet && selectedSet.has(String(chapter.id)));
      const includedScenes = includeAllScenes
        ? chapterScenes
        : chapterScenes.filter((s) => selectedSet && selectedSet.has(String(s.id)));
      if (selectionMode && !includeAllScenes && includedScenes.length === 0) return;
      if (includeChapterHeadings) blocks.push({ type: "chapter", title: chapter.name || "Untitled Chapter" });
      includedScenes.forEach((scene) => {
        blocks.push({ type: "scene", title: scene.name || "Untitled Scene", html: String(scene.content || "") });
      });
    });
  }

  if (!hasOrderedSceneIds && String(scope || "project").toLowerCase() !== "chapter") {
    const orphanScenes = byParent.get(null) || [];
    const includeOrphans = !selectionMode
      ? true
      : orphanScenes.some((s) => selectedSet && selectedSet.has(String(s.id)));
    if (orphanScenes.length && includeOrphans) {
      const includedOrphans = selectionMode
        ? orphanScenes.filter((s) => selectedSet && selectedSet.has(String(s.id)))
        : orphanScenes;
      if (includedOrphans.length) {
        if (includeChapterHeadings) blocks.push({ type: "chapter", title: "Scenes" });
        includedOrphans.forEach((scene) => {
          blocks.push({ type: "scene", title: scene.name || "Untitled Scene", html: String(scene.content || "") });
        });
      }
    }
  }

  const htmlBody = blocks.map((b) => {
    if (b.type === "chapter") return `<h2>${escapeHtml(b.title)}</h2>`;
    return `<h3>${escapeHtml(b.title)}</h3><div class="scene">${b.html || ""}</div>`;
  }).join("\n");

  const textBody = blocks.map((b) => {
    if (b.type === "chapter") return `\n\n${b.title}\n${"=".repeat(Math.min(80, (b.title || "").length || 10))}\n`;
    const sceneText = stripHtmlToText(b.html || "");
    return `\n${b.title}\n${"-".repeat(Math.min(80, (b.title || "").length || 10))}\n${sceneText}\n`;
  }).join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Writing Manuscript</title>
  <style>
    body { font-family: Georgia, "Times New Roman", serif; margin: 36px; line-height: 1.55; color: #111; }
    h2 { margin: 28px 0 10px 0; page-break-before: always; }
    h3 { margin: 18px 0 8px 0; }
    .scene img { max-width: 100%; height: auto; }
    .scene table { border-collapse: collapse; }
    .scene td, .scene th { border: 1px solid #ddd; padding: 6px 8px; }
  </style>
</head>
<body>
${htmlBody}
</body>
</html>`;

  return { html, text: textBody.trim() };
}

let mainWindow = null;
let helpWindow = null;

async function openHelpInAppWindow() {
  const outputPath = getStagedHelpFilePath();
  const helpUrl = pathToFileURL(outputPath).toString();

  if (helpWindow && !helpWindow.isDestroyed()) {
    await helpWindow.loadURL(helpUrl);
    helpWindow.show();
    helpWindow.focus();
    return outputPath;
  }

  helpWindow = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    title: 'User Guide',
    autoHideMenuBar: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  helpWindow.on('closed', () => {
    helpWindow = null;
  });

  helpWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  await helpWindow.loadURL(helpUrl);
  helpWindow.show();
  return outputPath;
}

function shouldUseInAppHelpWindow() {
  return process.platform === 'linux' && app.isPackaged;
}

async function openUserGuide() {
  if (shouldUseInAppHelpWindow()) {
    return openHelpInAppWindow();
  }

  try {
    return await openHelpInDefaultBrowser();
  } catch (error) {
    if (process.platform === 'linux') {
      return openHelpInAppWindow();
    }
    throw error;
  }
}

// ============================================================
// FONT WATCHER SETUP
// ============================================================
function initializeFontWatcher() {
  if (fontWatcherStarted) return;
  
  try {
    console.log("🔤 Initializing font watcher...");
    
    // Set up callback to notify renderer when fonts change
    setMainProcessCallback((fontsList) => {
      if (mainWindow && mainWindow.webContents) {
        const payload = Array.isArray(fontsList)
          ? { files: fontsList, families: [] }
          : fontsList;
        const count = payload.families && payload.families.length
          ? payload.families.length
          : (payload.files ? payload.files.length : 0);
        console.log(`📢 Notifying renderer: ${count} fonts available`);
        mainWindow.webContents.send('fonts-updated', payload);
      }
    });

    // Generate fonts.css on startup (in dev only; pre-generated in packaged apps)
    generateFontsCSS();
    
    // Start watching for new fonts (only works in dev, automatically skipped in packaged app)
    watchFontsDirectory();
    fontWatcherStarted = true;
    console.log("✅ Font system initialized");
  } catch (error) {
    console.warn("⚠️  Font initialization warning:", error.message);
    console.log("ℹ️  App will continue with available fonts");
    fontWatcherStarted = true;
  }
}

let fontWatcherStarted = false;

// ------------------------------------------------------------
// Create the main window
// ------------------------------------------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false,
    icon: path.join(__dirname, "frontend", "assets", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      devTools: true,
      enableRemoteModule: false,
      sandbox: false,
      enablePreferredSizeMode: false
    }
  });

  // Set Content-Security-Policy header
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline' file:; " +
          "font-src 'self' file:; " +
          "img-src 'self' data: blob: file:; " +
          "media-src 'self' data: blob: file: https:; " +
          "connect-src 'self'; " +
          "frame-ancestors 'none'; " +
          "base-uri 'self'"
        ]
      }
    });
  });

  win.loadFile("frontend/index.html");

  // Show the main window once content is ready.
  win.once('ready-to-show', () => {
    win.show();
  });

  mainWindow = win;

  // Optional: DevTools
  // win.webContents.openDevTools();

  // On packaged Linux, route the debug shortcut to the internal debug console
  // instead of Chromium DevTools, which fails to initialize on this machine.
  win.webContents.on('before-input-event', (event, input) => {
    if (!shouldUseEmbeddedDebugConsole()) return;
    const key = String(input.key || '').toUpperCase();
    const isDebugShortcut = key === 'F12' || ((input.control || input.meta) && input.shift && key === 'I');
    if (!isDebugShortcut) return;
    event.preventDefault();
    sendToMainWindow('menu-open-debug-console');
  });
  
  // Create application menu
  createMenu(win);
  
  // Initialize font watcher when window is ready
  win.webContents.on('did-finish-load', () => {
    initializeFontWatcher();
  });
}

// ------------------------------------------------------------
// Image Picker Handlers
// ------------------------------------------------------------
ipcMain.handle("pick-editor-image", async () => {
  const parent = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(parent, {
    properties: ["openFile"],
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]
      }
    ]
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle("pick-map-image", async () => {
  const parent = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(parent, {
    properties: ["openFile"],
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]
      }
    ]
  });

  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

// ------------------------------------------------------------
// Open Help In Default Browser
// ------------------------------------------------------------
function resolveHelpFilePath() {
  return resolveFrontendAssetPath("help.html");
}

function resolveFontsCssPath() {
  return resolveFrontendAssetPath("fonts.css");
}

function resolveUiCssPath() {
  return resolveFrontendAssetPath("ui.css");
}

function inlineCssLink(html, href, cssText) {
  if (!cssText) return html;
  const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(
    new RegExp(`<link[^>]+href=["']${escapedHref}["'][^>]*>\\s*`, "i"),
    `<style>\n${cssText}\n</style>\n`
  );
}

function loadHelpHtml() {
  const helpPath = resolveHelpFilePath();
  if (!helpPath) {
    throw new Error("Could not locate frontend/help.html");
  }
  let html = fs.readFileSync(helpPath, 'utf8');

  const fontsCssPath = resolveFontsCssPath();
  if (fontsCssPath) {
    const fontsCss = fs.readFileSync(fontsCssPath, 'utf8');
    html = inlineCssLink(html, "fonts.css", fontsCss);
  }

  const uiCssPath = resolveUiCssPath();
  if (uiCssPath) {
    const uiCss = fs.readFileSync(uiCssPath, 'utf8');
    html = inlineCssLink(html, "ui.css", uiCss);
  }

  return { helpPath, html };
}

function getExternalHelpOutputPath() {
  const helpDir = path.join(app.getPath("userData"), "help");
  fs.mkdirSync(helpDir, { recursive: true });
  return path.join(helpDir, "user-guide.html");
}

function getStagedHelpFilePath() {
  const { html } = loadHelpHtml();
  const outputPath = getExternalHelpOutputPath();
  fs.writeFileSync(outputPath, html, "utf8");
  return outputPath;
}

function showHelpOpenError(error) {
  const message = error && error.message ? error.message : String(error);
  console.error("Failed to open user guide:", error);
  dialog.showErrorBox("User Guide", `Failed to open user guide.\n\n${message}`);
}

function execFileChecked(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 15000 }, (error, stdout, stderr) => {
      const combinedOutput = [stderr, stdout].filter(Boolean).join("\n").trim();
      const launcherReportedFailure = /WSL Interop(?:erability)? is disabled|This protocol is not supported|\[error\]/i.test(combinedOutput);

      if (error) {
        const details = [combinedOutput, error.message].filter(Boolean).join("\n").trim();
        reject(new Error(`${command} failed${details ? `: ${details}` : ""}`));
        return;
      }

      if (launcherReportedFailure) {
        reject(new Error(`${command} reported failure: ${combinedOutput}`));
        return;
      }

      resolve();
    });
  });
}

function spawnDetachedChecked(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore"
    });

    child.once("error", (error) => {
      reject(new Error(`${command} failed: ${error.message || String(error)}`));
    });

    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function openHelpWithLinuxHandler(helpPath, helpUrl) {
  const launchers = [
    ["xdg-open", [helpPath]],
    ["gio", ["open", helpPath]],
    ["xdg-open", [helpUrl]],
    ["gio", ["open", helpUrl]]
  ];

  const directBrowsers = [
    "/usr/lib/firefox/firefox",
    "/usr/bin/firefox",
    "/usr/bin/firefox-esr",
    "/usr/lib/chromium/chromium",
    "/usr/lib/chromium-browser/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/opt/google/chrome/google-chrome",
    "/usr/share/iron/chrome"
  ];

  const failures = [];

  for (const [command, args] of launchers) {
    try {
      await execFileChecked(command, args);
      return;
    } catch (error) {
      failures.push(error && error.message ? error.message : String(error));
    }
  }

  for (const browserPath of directBrowsers) {
    if (!fs.existsSync(browserPath)) continue;
    try {
      await spawnDetachedChecked(browserPath, [helpPath]);
      return;
    } catch (error) {
      failures.push(error && error.message ? error.message : String(error));
    }
  }

  throw new Error(failures.join("\n"));
}

async function openHelpInDefaultBrowser() {
  const outputPath = getStagedHelpFilePath();
  const helpUrl = pathToFileURL(outputPath).toString();

  try {
    const openPathError = await shell.openPath(outputPath);
    if (!openPathError) {
      return outputPath;
    }

    if (process.platform === "linux") {
      await openHelpWithLinuxHandler(outputPath, helpUrl);
    } else {
      await shell.openExternal(helpUrl);
    }
    return outputPath;
  } catch (error) {
    const details = error && error.message ? error.message : "Failed to open user guide";
    throw new Error(`Help file: ${outputPath}\nURL: ${helpUrl}\n\n${details}`);
  }
}

function toggleDevToolsForWindow(targetWindow) {
  const target = targetWindow || BrowserWindow.getFocusedWindow() || mainWindow;
  if (!target || !target.webContents) return false;
  if (target.webContents.isDevToolsOpened()) {
    target.webContents.closeDevTools();
  } else {
    target.webContents.openDevTools({ mode: 'right', activate: true });
  }
  return true;
}

function shouldUseEmbeddedDebugConsole() {
  return process.platform === 'linux' && app.isPackaged;
}

function sendToMainWindow(channel, ...args) {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) {
    return false;
  }
  mainWindow.webContents.send(channel, ...args);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  return true;
}

function pushLanguageToolLog(line) {
  const text = String(line || "").trim();
  if (!text) return;
  languageToolLogs.push({ ts: Date.now(), line: text });
  if (languageToolLogs.length > 300) languageToolLogs = languageToolLogs.slice(-300);
}

function sendLanguageToolDownloadProgress(payload) {
  try {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) return;
    mainWindow.webContents.send("languagetool:download-progress", payload || {});
  } catch (_) {}
}

function isAllowedLocalUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:") return false;
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return false;
    return true;
  } catch (_) {
    return false;
  }
}

function formatLanguageToolHttpError(status, body) {
  return `LanguageTool HTTP ${status}: ${String(body || "").slice(0, 300)}`;
}

async function postLanguageToolCheck(url, language, text) {
  const params = new URLSearchParams();
  params.set("language", language);
  params.set("text", text);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString()
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      success: false,
      status: res.status,
      error: formatLanguageToolHttpError(res.status, body)
    };
  }

  const json = await res.json();
  return {
    success: true,
    matches: Array.isArray(json?.matches) ? json.matches : []
  };
}

function shiftLanguageToolMatches(matches, offsetShift) {
  const shift = Number(offsetShift || 0) || 0;
  return (Array.isArray(matches) ? matches : []).map((match) => {
    const currentOffset = Number(match?.offset || 0);
    return {
      ...match,
      offset: Number.isFinite(currentOffset) ? currentOffset + shift : shift
    };
  });
}

function chooseNearestLanguageToolBoundary(text, regex, midpoint) {
  const candidates = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const boundary = match.index + match[0].length;
    if (boundary > 0 && boundary < text.length) {
      candidates.push(boundary);
    }
  }
  if (!candidates.length) return -1;

  let best = candidates[0];
  let bestDistance = Math.abs(best - midpoint);
  for (let i = 1; i < candidates.length; i += 1) {
    const distance = Math.abs(candidates[i] - midpoint);
    if (distance < bestDistance) {
      best = candidates[i];
      bestDistance = distance;
    }
  }
  return best;
}

function findLanguageToolSplitPoint(text) {
  const value = String(text || "");
  if (value.length < 2) return -1;
  const midpoint = Math.floor(value.length / 2);
  const patterns = [/(?:\r?\n\s*\r?\n)+/g, /[.!?]["')\]]*\s+/g, /\r?\n/g, /\s+/g];

  for (const pattern of patterns) {
    const splitPoint = chooseNearestLanguageToolBoundary(value, pattern, midpoint);
    if (splitPoint > 0 && splitPoint < value.length) {
      return splitPoint;
    }
  }

  return -1;
}

function splitLanguageToolText(text, baseOffset) {
  const splitPoint = findLanguageToolSplitPoint(text);
  if (splitPoint <= 0 || splitPoint >= text.length) return [];

  const left = String(text.slice(0, splitPoint) || "");
  const right = String(text.slice(splitPoint) || "");
  const parts = [];

  if (left.trim()) {
    parts.push({ text: left, offset: baseOffset });
  }
  if (right.trim()) {
    parts.push({ text: right, offset: baseOffset + splitPoint });
  }

  return parts;
}

async function runRobustLanguageToolCheck(url, language, text, baseOffset = 0, depth = 0) {
  const result = await postLanguageToolCheck(url, language, text);
  if (result.success) {
    return {
      success: true,
      matches: shiftLanguageToolMatches(result.matches, baseOffset),
      warnings: []
    };
  }

  if (Number(result.status || 0) < 500) {
    return result;
  }

  const segments = splitLanguageToolText(text, baseOffset);
  if (!segments.length || depth >= 8) {
    const snippet = String(text || "").replace(/\s+/g, " ").trim().slice(0, 160);
    pushLanguageToolLog(`LanguageTool skipped span after repeated internal error at offset ${baseOffset}: ${snippet}`);
    return {
      success: true,
      matches: [],
      warnings: [{
        offset: baseOffset,
        length: text.length,
        error: result.error,
        snippet
      }]
    };
  }

  pushLanguageToolLog(`LanguageTool fallback retry at depth ${depth} for span offset=${baseOffset} length=${text.length}`);
  const aggregate = { success: true, matches: [], warnings: [] };
  for (const segment of segments) {
    const partial = await runRobustLanguageToolCheck(url, language, segment.text, segment.offset, depth + 1);
    if (!partial.success) {
      return partial;
    }
    aggregate.matches.push(...(partial.matches || []));
    aggregate.warnings.push(...(partial.warnings || []));
  }
  return aggregate;
}

function downloadUrlToFile(url, destPath, { maxRedirects = 3 } = {}) {
  return new Promise((resolve, reject) => {
    const https = require("https");
    const http = require("http");
    const { URL } = require("url");

    let currentUrl = String(url || "").trim();
    let redirectsLeft = maxRedirects;

    const doRequest = () => {
      let parsed;
      try { parsed = new URL(currentUrl); } catch (e) { reject(e); return; }
      const mod = parsed.protocol === "https:" ? https : parsed.protocol === "http:" ? http : null;
      if (!mod) { reject(new Error("Unsupported protocol")); return; }

      const req = mod.get(currentUrl, (res) => {
        const status = res.statusCode || 0;
        const loc = res.headers.location;
        if ([301, 302, 303, 307, 308].includes(status) && loc && redirectsLeft > 0) {
          redirectsLeft -= 1;
          currentUrl = new URL(loc, currentUrl).toString();
          res.resume();
          doRequest();
          return;
        }
        if (status < 200 || status >= 300) {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => reject(new Error(`HTTP ${status}: ${Buffer.concat(chunks).toString("utf8").slice(0, 400)}`)));
          return;
        }

        const total = Number(res.headers["content-length"] || 0) || null;
        let received = 0;
        fs.mkdirSync(path.dirname(destPath), { recursive: true });
        const file = fs.createWriteStream(destPath);
        res.on("data", (chunk) => {
          received += chunk.length;
          sendLanguageToolDownloadProgress({ stage: "download", received, total });
        });
        res.pipe(file);
        file.on("finish", () => file.close(() => resolve({ destPath, total, received })));
        file.on("error", (err) => {
          try { file.close(() => {}); } catch (_) {}
          reject(err);
        });
      });
      req.on("error", reject);
    };

    doRequest();
  });
}

function safeJoinUnder(baseDir, relativePath) {
  const rel = String(relativePath || "").replace(/\\/g, "/");
  const cleaned = rel.replace(/^\/+/, "");
  const out = path.resolve(baseDir, cleaned);
  const base = path.resolve(baseDir);
  if (!out.startsWith(base + path.sep) && out !== base) {
    throw new Error(`Zip path traversal blocked: ${relativePath}`);
  }
  return out;
}

function extractZip(zipPath, outDir) {
  const zlib = require("zlib");
  const data = fs.readFileSync(zipPath);
  const sigEOCD = 0x06054b50;
  const sigCD = 0x02014b50;
  const sigLFH = 0x04034b50;

  // Find EOCD (search backwards)
  let eocdOffset = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 66000); i -= 1) {
    if (data.readUInt32LE(i) === sigEOCD) { eocdOffset = i; break; }
  }
  if (eocdOffset < 0) throw new Error("Invalid zip: missing EOCD");

  const cdSize = data.readUInt32LE(eocdOffset + 12);
  const cdOffset = data.readUInt32LE(eocdOffset + 16);
  let ptr = cdOffset;
  const entries = [];
  while (ptr < cdOffset + cdSize) {
    if (data.readUInt32LE(ptr) !== sigCD) break;
    const compression = data.readUInt16LE(ptr + 10);
    const compSize = data.readUInt32LE(ptr + 20);
    const uncompSize = data.readUInt32LE(ptr + 24);
    const nameLen = data.readUInt16LE(ptr + 28);
    const extraLen = data.readUInt16LE(ptr + 30);
    const commentLen = data.readUInt16LE(ptr + 32);
    const lfhOffset = data.readUInt32LE(ptr + 42);
    const name = data.slice(ptr + 46, ptr + 46 + nameLen).toString("utf8");
    entries.push({ name, compression, compSize, uncompSize, lfhOffset });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  fs.mkdirSync(outDir, { recursive: true });

  let extractedFiles = 0;
  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, "/");
    if (!name || name.endsWith("/")) {
      const dirPath = safeJoinUnder(outDir, name);
      fs.mkdirSync(dirPath, { recursive: true });
      continue;
    }
    const lfh = entry.lfhOffset;
    if (data.readUInt32LE(lfh) !== sigLFH) throw new Error("Invalid zip: bad local header");
    const nameLen = data.readUInt16LE(lfh + 26);
    const extraLen = data.readUInt16LE(lfh + 28);
    const dataStart = lfh + 30 + nameLen + extraLen;
    const comp = data.slice(dataStart, dataStart + entry.compSize);
    let outBuf;
    if (entry.compression === 0) outBuf = comp;
    else if (entry.compression === 8) outBuf = zlib.inflateRawSync(comp);
    else continue;

    const outPath = safeJoinUnder(outDir, name);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, outBuf);
    extractedFiles += 1;
    if (extractedFiles % 50 === 0) {
      sendLanguageToolDownloadProgress({ stage: "extract", extractedFiles });
    }
  }

  sendLanguageToolDownloadProgress({ stage: "extract", extractedFiles, done: true });
  return { extractedFiles };
}

function findFileRecursive(rootDir, fileName, maxDepth = 5) {
  const target = String(fileName || "");
  const walk = (dir, depth) => {
    if (depth > maxDepth) return null;
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const full = path.join(dir, item.name);
      if (item.isFile() && item.name === target) return full;
      if (item.isDirectory()) {
        const found = walk(full, depth + 1);
        if (found) return found;
      }
    }
    return null;
  };
  try { return walk(rootDir, 0); } catch (_) { return null; }
}

ipcMain.handle("languagetool:pick-jar", async () => {
  try {
    const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() || mainWindow, {
      title: "Select LanguageTool server JAR",
      properties: ["openFile"],
      filters: [
        { name: "Java Archive", extensions: ["jar"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });
    if (result.canceled || !result.filePaths || !result.filePaths[0]) {
      return { success: false, cancelled: true };
    }
    return { success: true, path: result.filePaths[0] };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle("languagetool:download-latest", async () => {
  try {
    // Official snapshot package (large). Download only on explicit user action.
    const snapshotUrl = "https://languagetool.org/download/snapshots/LanguageTool-latest-snapshot.zip";
    const allowedHosts = new Set(["languagetool.org", "internal1.languagetool.org"]);
    const host = new URL(snapshotUrl).hostname;
    if (!allowedHosts.has(host)) return { success: false, error: "Blocked download host." };

    const toolsDir = path.join(app.getPath("userData"), "tools", "languagetool");
    fs.mkdirSync(toolsDir, { recursive: true });
    const zipPath = path.join(toolsDir, "LanguageTool-latest-snapshot.zip");
    const extractDir = path.join(toolsDir, "LanguageTool-latest-snapshot");

    sendLanguageToolDownloadProgress({ stage: "start", url: snapshotUrl });
    await downloadUrlToFile(snapshotUrl, zipPath);

    sendLanguageToolDownloadProgress({ stage: "extract", extractedFiles: 0 });
    // Clean extractDir to avoid mixed versions (best-effort).
    try { fs.rmSync(extractDir, { recursive: true, force: true }); } catch (_) {}
    extractZip(zipPath, extractDir);

    const jarPath = findFileRecursive(extractDir, "languagetool-server.jar", 6);
    if (!jarPath) {
      return { success: false, error: "Downloaded, but could not find languagetool-server.jar in the extracted files." };
    }

    return { success: true, jarPath, extractDir, zipPath };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle("languagetool:start", async (_event, payload) => {
  try {
    const jarPath = String(payload?.jarPath || "").trim();
    const port = Number(payload?.port || 8081) || 8081;
    if (!jarPath) return { success: false, error: "Missing jarPath." };
    if (!fs.existsSync(jarPath)) return { success: false, error: "LanguageTool jar not found at jarPath." };
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return { success: false, error: "Invalid port." };

    if (languageToolProcess && !languageToolProcess.killed) {
      return { success: true, alreadyRunning: true, port };
    }

    languageToolLogs = [];
    const { spawn } = require("child_process");
    const args = ["-jar", jarPath, "--port", String(port), "--allow-origin", "http://localhost"];
    const child = spawn("java", args, { stdio: ["ignore", "pipe", "pipe"] });
    languageToolProcess = child;
    languageToolLastStart = { jarPath, port, startedAt: Date.now() };

    child.stdout.on("data", (buf) => pushLanguageToolLog(buf.toString("utf8")));
    child.stderr.on("data", (buf) => pushLanguageToolLog(buf.toString("utf8")));
    child.on("exit", (code, signal) => {
      pushLanguageToolLog(`LanguageTool exited: code=${code} signal=${signal || ""}`);
      languageToolProcess = null;
    });
    child.on("error", (err) => {
      pushLanguageToolLog(`LanguageTool error: ${err?.message || String(err)}`);
      languageToolProcess = null;
    });

    return { success: true, port };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle("languagetool:stop", async () => {
  try {
    if (!languageToolProcess || languageToolProcess.killed) {
      return { success: true, stopped: false };
    }
    const proc = languageToolProcess;
    languageToolProcess = null;
    try {
      proc.kill();
    } catch (_) {}
    return { success: true, stopped: true };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle("languagetool:check", async (_event, payload) => {
  try {
    const port = Number(payload?.port || 8081) || 8081;
    const baseUrl = `http://127.0.0.1:${port}`;
    if (!isAllowedLocalUrl(baseUrl)) {
      return { success: false, error: "baseUrl must be http://127.0.0.1:<port> or http://localhost:<port>." };
    }
    const language = String(payload?.language || "en-US").trim() || "en-US";
    const text = String(payload?.text || "");
    if (!text.trim()) return { success: true, matches: [] };
    if (text.length > 200_000) return { success: false, error: "Text too long (limit: 200k chars)." };

    const url = new URL("/v2/check", baseUrl).toString();
    return await runRobustLanguageToolCheck(url, language, text, 0, 0);
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

async function openEmbeddedDebugConsole() {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) {
    return false;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  try {
    const result = await mainWindow.webContents.executeJavaScript(`
      (() => {
        try {
          if (typeof window !== 'undefined' && typeof window.openDebugConsole === 'function') {
            window.openDebugConsole();
            return { ok: true };
          }
          return { ok: false, error: 'window.openDebugConsole is not available' };
        } catch (error) {
          return {
            ok: false,
            error: error && (error.stack || error.message) ? (error.stack || error.message) : String(error)
          };
        }
      })();
    `, true);
    if (result && result.ok) return true;
    console.error('Failed to open embedded debug console:', result && result.error ? result.error : 'Unknown renderer error');
    return false;
  } catch (error) {
    console.error('Failed to open embedded debug console:', error);
    return false;
  }
}

// ------------------------------------------------------------
// Model Manager is now an embedded modal dialog in the main window

// ------------------------------------------------------------
// Create Application Menu
// ------------------------------------------------------------
function createMenu(win) {
  const exportFormatItems = (channel) => ([
    { label: 'HTML (.html)', click: () => win.webContents.send(channel, 'html') },
    { label: 'XML (.xml)', click: () => win.webContents.send(channel, 'xml') },
    { label: 'DOCX (.docx)', click: () => win.webContents.send(channel, 'docx') },
    { label: 'PDF (.pdf)', click: () => win.webContents.send(channel, 'pdf') }
  ]);

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Vault',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            win.webContents.send('menu-new-vault');
          }
        },
        {
          label: 'Open Vault',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            win.webContents.send('menu-open-vault');
          }
        },
        {
          label: 'Save Vault',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            win.webContents.send('menu-save-vault');
          }
        },
        {
          label: 'Save Vault As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            win.webContents.send('menu-save-vault-as');
          }
        },
        { type: 'separator' },
        {
          label: 'Find & Replace...',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => {
            win.webContents.send('menu-find-replace');
          }
        },
        {
          label: 'Rebuild Vault Index',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            win.webContents.send('menu-rebuild-index');
          }
        },
        { type: 'separator' },
        {
          label: 'Export Current Tab',
          submenu: exportFormatItems('menu-export-current')
        },
        {
          label: 'Export All Content',
          submenu: exportFormatItems('menu-export-all')
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: 'CmdOrCtrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        shouldUseEmbeddedDebugConsole()
          ? {
              label: 'Debug Console',
              click: async () => {
                await openEmbeddedDebugConsole();
              }
            }
          : { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'User Guide',
          accelerator: 'F1',
          click: async () => {
            try {
              await openUserGuide();
            } catch (error) {
              showHelpOpenError(error);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'About Extal World Builder',
          click: () => {
            dialog.showMessageBox(win, {
              type: 'info',
              title: 'About Extal World Builder',
              message: 'Extal World Builder',
              detail: 'Version 0.8c\n\nA comprehensive worldbuilding companion for writers, game masters, and storytellers.\n\nBuilt with Electron, featuring AI-powered entity extraction and rich cross-referencing.\n\n© 2026 Andrew D Nusz. All rights reserved.'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ------------------------------------------------------------
// App Ready
// ------------------------------------------------------------
app.whenReady().then(() => {
  ensureVaultExists();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit on all windows closed (except macOS)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  shutdownPiperWorker();
});

// ============================================================
//  IPC HANDLERS
// ============================================================

// ------------------------------------------------------------
// Pick Vault File to Load
// ------------------------------------------------------------
ipcMain.handle("pick-vault-file", async () => {
  const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() || mainWindow, {
    title: "Select Vault File",
    properties: ["openFile"],
    filters: [
      { name: "JSON Files", extensions: ["json"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { cancelled: true };
  }

  // Load and return the vault data from the selected file
  try {
    const raw = fs.readFileSync(result.filePaths[0], "utf8");
    const vaultData = JSON.parse(raw);
    
    // Return both the data and the file path
    return {
      data: vaultData,
      path: result.filePaths[0]
    };
  } catch (error) {
    console.error("Error loading vault file:", error);
    return { error: error.message };
  }
});

// ------------------------------------------------------------
// Load Vault from Specific Path
// ------------------------------------------------------------
ipcMain.handle("load-vault-from-path", async (event, vaultPath) => {
  try {
    if (!fs.existsSync(vaultPath)) {
      return null;
    }
    // Use async file read to avoid blocking the UI thread
    const raw = await fs.promises.readFile(vaultPath, "utf8");
    const vaultData = JSON.parse(raw);
    return {
      data: vaultData,
      path: vaultPath
    };
  } catch (error) {
    console.error("Error loading vault from path:", error);
    return null;
  }
});

// ------------------------------------------------------------
// Get Demo Vault Path
// ------------------------------------------------------------
ipcMain.handle("get-demo-vault-path", async () => {
  return path.join(__dirname, "backend", "demo_vault.json");
});

// ------------------------------------------------------------
// Open Help File
// ------------------------------------------------------------
ipcMain.on("open-help", (event) => {
  openUserGuide().catch((error) => {
    showHelpOpenError(error);
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow() || mainWindow;
    if (win && !win.isDestroyed()) {
      try {
        win.focus();
      } catch (_) {}
    }
  });
});

ipcMain.handle("toggle-devtools", () => {
  if (shouldUseEmbeddedDebugConsole()) {
    return openEmbeddedDebugConsole();
  }
  return toggleDevToolsForWindow();
});

ipcMain.handle("nudge-window-focus", async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow() || mainWindow;
    if (!win || win.isDestroyed()) return { success: false, error: "no-window" };
    win.blur();
    setTimeout(() => {
      try {
        if (win.isDestroyed()) return;
        win.show();
        win.focus();
        try { win.webContents && win.webContents.focus && win.webContents.focus(); } catch (_) {}
      } catch (_) {}
    }, 40);
    return { success: true };
  } catch (error) {
    return { success: false, error: error && error.message ? error.message : String(error) };
  }
});

// ------------------------------------------------------------
// Open External URL in default browser
// ------------------------------------------------------------
ipcMain.handle("open-external-url", async (event, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    await shell.openExternal(url);
    return { success: true };
  }
  return { success: false, error: 'Invalid URL' };
});

ipcMain.handle("tts:synthesize", async (_event, payload) => {
  try {
    const provider = String(payload?.provider || "piper").trim().toLowerCase();
    if (provider !== "piper") {
      throw new Error("Only bundled Piper synthesis is available in this build.");
    }
    return await synthesizePiperTts(payload || {}, resolveBundledPiperRuntime(payload || {}));
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
});

ipcMain.handle("tts:prewarm", async (_event, payload) => {
  try {
    const provider = String(payload?.provider || "piper").trim().toLowerCase();
    if (provider !== "piper") {
      throw new Error("Only bundled Piper prewarm is available in this build.");
    }
    return await prewarmPiperModel(payload || {}, resolveBundledPiperRuntime(payload || {}));
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
});

ipcMain.handle("tts:get-support", async () => {
  try {
    const piper = getBundledPiperSupport();

    return {
      ok: true,
      playback: {
        supported: piper.playback.supported,
        reason: piper.playback.reason
      },
      download: {
        supported: piper.download.supported,
        reason: piper.download.reason
      },
      piper: {
        playback: piper.playback,
        download: piper.download,
        models: piper.models.map((model) => ({ id: model.id, name: model.name })),
        binaryAvailable: !!piper.binaryPath
      }
    };
  } catch (error) {
    return {
      ok: false,
      playback: {
        supported: false,
        reason: error && error.message ? error.message : String(error)
      },
      download: {
        supported: false,
        reason: error && error.message ? error.message : String(error)
      },
      piper: {
        playback: {
          supported: false,
          reason: error && error.message ? error.message : String(error)
        },
        download: {
          supported: false,
          reason: error && error.message ? error.message : String(error)
        },
        models: [],
        binaryAvailable: false
      }
    };
  }
});

ipcMain.handle("tts:save", async (_event, payload) => {
  try {
    const provider = String(payload?.provider || "piper").trim().toLowerCase();
    if (provider !== "piper") {
      throw new Error("Only bundled Piper export is available in this build.");
    }
    return await savePiperTtsToFile(payload || {}, resolveBundledPiperRuntime(payload || {}));
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
});

ipcMain.handle("tts:save-with-dialog", async (_event, payload) => {
  try {
    const provider = String(payload?.provider || "piper").trim().toLowerCase();
    if (provider !== "piper") {
      throw new Error("Only bundled Piper export is available in this build.");
    }
    const suggestedName = String(payload?.filename || "extal-tts.wav").trim() || "extal-tts.wav";
    const result = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || mainWindow, {
      title: "Save TTS Audio",
      defaultPath: suggestedName,
      filters: [
        { name: "WAV Audio", extensions: ["wav"] },
        { name: "All Files", extensions: ["*"] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { ok: false, cancelled: true };
    }

    return await savePiperTtsToFile({ ...(payload || {}), outputPath: result.filePath }, resolveBundledPiperRuntime(payload || {}));
  } catch (error) {
    return {
      ok: false,
      error: error && error.message ? error.message : String(error)
    };
  }
});

// ------------------------------------------------------------
// Model Manager modal is embedded in main window - no IPC call needed
// This handler is kept only for backward compatibility
ipcMain.handle('open-model-manager', () => {
  log('[IPC] open-model-manager: using embedded modal only');
  return { success: true };
});

// ------------------------------------------------------------
// Load Vault (auto-load from default location)
// ------------------------------------------------------------
ipcMain.handle("elyria:load-vault", async () => {
  ensureVaultExists();
  try {
    const raw = fs.readFileSync(VAULT_PATH, "utf8");
    return {
      data: JSON.parse(raw),
      path: VAULT_PATH
    };
  } catch (error) {
    console.error("Error loading default vault:", error);
    return null;
  }
});

function tryWriteVaultBackup(savePath) {
  try {
    if (!savePath) return;
    if (!fs.existsSync(savePath)) return;
    const lastAt = lastVaultBackupAt.get(savePath) || 0;
    const now = Date.now();
    // Avoid copying the full vault file on every autosave tick.
    if (now - lastAt < 30_000) return;
    const backupPath = `${savePath}.bak`;
    fs.copyFileSync(savePath, backupPath);
    lastVaultBackupAt.set(savePath, now);
  } catch (error) {
    console.error("Error creating vault backup:", error);
  }
}

// ------------------------------------------------------------
// Save Vault (renderer sends full worldData + optional path)
// ------------------------------------------------------------
ipcMain.handle("elyria:save-vault", async (event, data, vaultPath) => {
  const savePath = vaultPath || VAULT_PATH;
  try {
    tryWriteVaultBackup(savePath);
    fs.writeFileSync(savePath, JSON.stringify(data, null, 2));
    return { success: true, path: savePath };
  } catch (error) {
    console.error("Error saving vault:", error);
    return { success: false, error: error.message || "Unknown save error", path: savePath };
  }
});

// ------------------------------------------------------------
// Save Vault As (show save dialog and save to new location)
// ------------------------------------------------------------
ipcMain.handle("elyria:save-vault-as", async (event, data) => {
  const result = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || mainWindow, {
    title: "Save Vault As",
    defaultPath: "elyria_vault.json",
    filters: [
      { name: "JSON Files", extensions: ["json"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  try {
    tryWriteVaultBackup(result.filePath);
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
    return {
      success: true,
      path: result.filePath
    };
  } catch (error) {
    console.error("Error saving vault:", error);
    return null;
  }
});

// ------------------------------------------------------------
// Compile Writing Manuscript (chapter or full project)
// ------------------------------------------------------------
ipcMain.handle("elyria:compile-writing", async (event, payload) => {
  try {
    const format = String(payload?.format || "docx").toLowerCase();
    if (!["html", "docx", "pdf"].includes(format)) {
      return { success: false, error: `Unsupported format: ${format}` };
    }

    const requestedScope = String(payload?.scope || "project").toLowerCase();
    const scope = requestedScope === "chapter" ? "chapter" : (requestedScope === "selection" ? "selection" : "project");
    const chapterId = payload?.chapterId || null;
    const selectedIds = Array.isArray(payload?.selectedIds) ? payload.selectedIds : null;
    const orderedSceneIds = Array.isArray(payload?.orderedSceneIds) ? payload.orderedSceneIds : null;
    const includeChapterHeadings = payload?.includeChapterHeadings === false ? false : true;
    const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
    const writingMap = data.writing || {};

    const manuscript = buildWritingManuscriptModel(writingMap, { scope, chapterId, selectedIds, orderedSceneIds, includeChapterHeadings });
    const baseName = scope === "chapter"
      ? "extal-writing-chapter"
      : (scope === "selection" ? "extal-writing-selection" : "extal-writing-manuscript");
    const defaultPath = path.join(app.getPath("documents"), `${baseName}.${format}`);

    const saveResult = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || mainWindow, {
      title: "Compile Writing",
      defaultPath,
      filters: [
        { name: `${format.toUpperCase()} Files`, extensions: [format] },
        { name: "All Files", extensions: ["*"] }
      ]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true };
    }

    const filePath = ensureFileExtension(saveResult.filePath, format);
    if (format === "html") {
      fs.writeFileSync(filePath, manuscript.html, "utf8");
    } else if (format === "docx") {
      const buf = buildDocxBufferFromHtml(manuscript.html);
      fs.writeFileSync(filePath, buf);
    } else if (format === "pdf") {
      await writePdfFromHtml(filePath, manuscript.html);
    }

    return { success: true, path: filePath };
  } catch (error) {
    console.error("Error compiling writing:", error);
    return { success: false, error: error.message || "Unknown compile error" };
  }
});

// ------------------------------------------------------------
// Export Content (current tab or all content as HTML/XML/DOCX/PDF)
// ------------------------------------------------------------
ipcMain.handle("elyria:export-content", async (event, payload) => {
  try {
    const format = String(payload?.format || "").toLowerCase();
    if (!EXPORT_FORMATS.has(format)) {
      return { success: false, error: `Unsupported export format: ${format}` };
    }

    const scope = String(payload?.scope || "all").toLowerCase() === "current" ? "current" : "all";
    const category = String(payload?.category || "").toLowerCase();
    const model = buildExportModel(payload?.data || {}, scope, category);

    const categorySlug = (CATEGORY_TO_SECTION_KEY[category] || category || "tab").replace(/[^a-z0-9_-]+/gi, "-");
    const baseName = scope === "current" ? `extal-${categorySlug}-export` : "extal-full-export";
    const defaultPath = path.join(app.getPath("documents"), `${baseName}.${format}`);

    const saveResult = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow() || mainWindow, {
      title: scope === "current" ? "Export Current Tab" : "Export Full Content",
      defaultPath,
      filters: [
        { name: `${format.toUpperCase()} Files`, extensions: [format] },
        { name: "All Files", extensions: ["*"] }
      ]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true };
    }

    const filePath = ensureFileExtension(saveResult.filePath, format);
    if (format === "html") {
      fs.writeFileSync(filePath, buildExportHtml(model), "utf8");
    } else if (format === "xml") {
      fs.writeFileSync(filePath, buildExportXml(model), "utf8");
    } else if (format === "docx") {
      fs.writeFileSync(filePath, buildDocxBufferFromHtml(buildExportHtml(model)));
    } else if (format === "pdf") {
      await writePdfFromHtml(filePath, buildExportHtml(model));
    }

    return { success: true, path: filePath };
  } catch (error) {
    console.error("Export failed:", error);
    return { success: false, error: error.message || "Unknown export error" };
  }
});

// ------------------------------------------------------------


// Model manager uses embedded modal - no active model sync needed

// ------------------------------------------------------------
// Pick Text File to Scan
// ------------------------------------------------------------
ipcMain.handle("pick-text-file", async () => {
  const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() || mainWindow, {
    title: "Select Text File to Scan",
    properties: ["openFile"],
    filters: [
      { name: "Text Files", extensions: ["txt", "md", "markdown"] },
      { name: "All Files", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  try {
    const text = fs.readFileSync(result.filePaths[0], "utf-8");
    return {
      text: text,
      path: result.filePaths[0],
      filename: path.basename(result.filePaths[0])
    };
  } catch (error) {
    console.error("Error reading file:", error);
    return null;
  }
});

// ------------------------------------------------------------
// Pick Folder and Scan All Text Files
// ------------------------------------------------------------
ipcMain.handle("pick-folder-to-scan", async () => {
  const result = await dialog.showOpenDialog(BrowserWindow.getFocusedWindow() || mainWindow, {
    title: "Select Folder to Scan",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const folderPath = result.filePaths[0];
  const files = [];

  try {
    // Read all files in the folder
    const readFolder = (dirPath) => {
      const items = fs.readdirSync(dirPath);
      
      for (const item of items) {
        const fullPath = path.join(dirPath, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          // Recursively read subdirectories
          readFolder(fullPath);
        } else if (stat.isFile()) {
          // Check if it's a text file
          const ext = path.extname(item).toLowerCase();
          if (['.txt', '.md', '.markdown'].includes(ext)) {
            try {
              const text = fs.readFileSync(fullPath, "utf-8");
              if (text.trim().length >= 50) { // Only include files with content
                files.push({
                  text: text,
                  path: fullPath,
                  filename: item,
                  relativePath: path.relative(folderPath, fullPath)
                });
              }
            } catch (err) {
              console.error(`Error reading file ${fullPath}:`, err);
            }
          }
        }
      }
    };

    readFolder(folderPath);

    return {
      folderPath: folderPath,
      folderName: path.basename(folderPath),
      files: files,
      fileCount: files.length
    };
  } catch (error) {
    console.error("Error reading folder:", error);
    return null;
  }
});

// ------------------------------------------------------------
// Scan Document Text for Worldbuilding Entities
// ------------------------------------------------------------
ipcMain.handle("scan-document-text", async (event, text, useAI = false, modelFilename = null) => {
  log('📡 Scan request received - AI enabled:', useAI, 'Model:', modelFilename);
  return new Promise((resolve, reject) => {
    const timestamp = Date.now();
    const tmpRoot = app.getPath("temp");
    const tempFile = path.join(tmpRoot, `extal_temp_scan_${timestamp}.txt`);
    const outputFile = path.join(tmpRoot, `extal_temp_results_${timestamp}.json`);
    
    try {
      // Write text to temporary file
      fs.writeFileSync(tempFile, text, "utf-8");
      
      // Build command
      const args = [
        resolveBackendScriptPath("auto_scanner.py"),
        tempFile,
        "--output", outputFile
      ];
      
      if (useAI) {
        args.push("--ai");
        log('✅ AI flag added to scanner command');
        if (modelFilename) {
          args.push("--model", modelFilename);
          log('✅ Model specified:', modelFilename);
        }
      }

      log('🐍 Running Python scanner with args:', args.join(' '));
      
      // Use bundled Python if present, otherwise venv
      const pythonCmd = getPythonCommand();
      if (!pythonCmd) {
        return resolve({ success: false, error: 'No bundled Python found. The portable distribution may be incomplete.' });
      }
      
      // Run Python scanner
      const python = spawn(pythonCmd, args);
      
      let stdout = "";
      let stderr = "";
      
      python.stdout.on("data", (data) => {
        stdout += data.toString();
      });
      
      python.stderr.on("data", (data) => {
        stderr += data.toString();
      });
      
      python.on("close", (code) => {
        // Clean up temp input file
        try { fs.unlinkSync(tempFile); } catch (e) {}
        
        log('📊 Scanner exited with code:', code);
        log('📄 stdout:', stdout.substring(0, 2000));
        log('⚠️ stderr:', stderr.substring(0, 500));
        
        if (code !== 0) {
          reject(new Error(`Scanner exited with code ${code}: ${stderr}`));
          return;
        }
        
        // Read results
        try {
          const results = JSON.parse(fs.readFileSync(outputFile, "utf-8"));
          log('✅ Results loaded, ai_enhanced:', results.ai_enhanced ? results.ai_enhanced.method : 'MISSING');
          
          // Clean up temp output file
          try { fs.unlinkSync(outputFile); } catch (e) {}
          
          resolve(results);
        } catch (e) {
          console.error('❌ Failed to read results:', e.message);
          reject(new Error(`Failed to read results: ${e.message}`));
        }
      });
      
    } catch (error) {
      reject(error);
    }
  });
});

// ============================================================
// AI MODEL MANAGEMENT
// ============================================================

// Get list of installed models
ipcMain.handle('get-installed-models', async () => {
  const modelsDir = USER_MODELS_DIR;
  
  // Create models directory if it doesn't exist
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
    return [];
  }
  
  // Return list of .gguf files
  const files = fs.readdirSync(modelsDir);
  return files.filter(f => f.endsWith('.gguf'));
});

function resolveLocalModelPath(modelFilename) {
  if (!modelFilename) return null;
  try {
    const asString = String(modelFilename);
    if (path.isAbsolute(asString) && fs.existsSync(asString)) return asString;
    const userPath = path.join(USER_MODELS_DIR, asString);
    if (fs.existsSync(userPath)) return userPath;
    const devFallback = path.join(__dirname, "backend", "models", asString);
    if (fs.existsSync(devFallback)) return devFallback;
  } catch (e) {}
  return null;
}

function getAiMemoryPath(vaultPath) {
  const targetVaultPath = String(vaultPath || VAULT_PATH || "").trim() || VAULT_PATH;
  const parsed = path.parse(targetVaultPath);
  return path.join(parsed.dir || path.dirname(targetVaultPath), `${parsed.name}.ai-memory.json`);
}

function readAiMemoryStore(vaultPath) {
  const memoryPath = getAiMemoryPath(vaultPath);
  try {
    if (!fs.existsSync(memoryPath)) {
      return { path: memoryPath, data: { version: 1, entries: [] } };
    }
    const raw = fs.readFileSync(memoryPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      path: memoryPath,
      data: {
        version: 1,
        entries: Array.isArray(parsed?.entries) ? parsed.entries : []
      }
    };
  } catch (error) {
    console.error("Error reading AI memory store:", error);
    return { path: memoryPath, data: { version: 1, entries: [] } };
  }
}

function writeAiMemoryStore(vaultPath, data) {
  const memoryPath = getAiMemoryPath(vaultPath);
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  fs.writeFileSync(memoryPath, JSON.stringify(data, null, 2), "utf8");
  return memoryPath;
}

// Local AI rewrite (offline; local model only)
ipcMain.handle("ai:rewrite-text", async (event, payload) => {
  try {
    const text = String(payload?.text || "");
    const mode = String(payload?.mode || "rewrite");
    const strength = payload?.strength;
    const temperature = payload?.temperature;
    const modelFilename = payload?.modelFilename || null;

    if (!text.trim()) return { success: false, error: "No text provided" };

    const pythonCmd = getPythonCommand();
    if (!pythonCmd) {
      return { success: false, error: "No bundled Python found. The portable distribution may be incomplete." };
    }

    const modelPath = resolveLocalModelPath(modelFilename);
    if (!modelPath) {
      return { success: false, error: "No local model selected or model not found." };
    }

    const tmpRoot = app.getPath("temp");
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const inputFile = path.join(tmpRoot, `extal_ai_rewrite_in_${id}.json`);
    const outputFile = path.join(tmpRoot, `extal_ai_rewrite_out_${id}.json`);
    fs.writeFileSync(inputFile, JSON.stringify({ text, mode, strength, temperature }), "utf-8");

    const args = [
      resolveBackendScriptPath("ai_rewrite.py"),
      "--model-path", modelPath,
      "--input", inputFile,
      "--output", outputFile
    ];

    return await new Promise((resolve) => {
      const python = spawn(pythonCmd, args);
      let stderr = "";
      python.stderr.on("data", (data) => { stderr += data.toString(); });
      python.on("close", (code) => {
        try { fs.unlinkSync(inputFile); } catch (e) {}
        let out = null;
        try {
          if (fs.existsSync(outputFile)) {
            out = JSON.parse(fs.readFileSync(outputFile, "utf-8"));
          }
        } catch (e) {
          out = null;
        }
        try { fs.unlinkSync(outputFile); } catch (e) {}

        if (code !== 0) {
          if (out && typeof out === "object") return resolve(out);
          return resolve({ success: false, error: `Rewrite failed (exit ${code})`, detail: stderr.substring(0, 2000) });
        }
        if (out && typeof out === "object") return resolve(out);
        return resolve({ success: false, error: "Rewrite failed (no output)" });
      });
      python.on("error", (err) => {
        try { fs.unlinkSync(inputFile); } catch (e) {}
        try { fs.unlinkSync(outputFile); } catch (e) {}
        resolve({ success: false, error: "Failed to start rewrite process", detail: err.message || String(err) });
      });
    });
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// Local AI consistency check (offline; local model only)
ipcMain.handle("ai:consistency-check", async (_event, payload) => {
  try {
    const scenes = Array.isArray(payload?.scenes) ? payload.scenes : [];
    const characters = Array.isArray(payload?.characters) ? payload.characters : [];
    const modelFilename = payload?.modelFilename || null;
    const maxClaimsPerScene = payload?.maxClaimsPerScene;
    const maxCharsPerScene = payload?.maxCharsPerScene;

    if (!scenes.length) return { success: false, error: "No scenes provided" };

    const pythonCmd = getPythonCommand();
    if (!pythonCmd) {
      return { success: false, error: "No bundled Python found. The portable distribution may be incomplete." };
    }

    const modelPath = resolveLocalModelPath(modelFilename);
    if (!modelPath) {
      return { success: false, error: "No local model selected or model not found." };
    }

    const tmpRoot = app.getPath("temp");
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const inputFile = path.join(tmpRoot, `extal_ai_consistency_in_${id}.json`);
    const outputFile = path.join(tmpRoot, `extal_ai_consistency_out_${id}.json`);
    fs.writeFileSync(
      inputFile,
      JSON.stringify({ scenes, characters, maxClaimsPerScene, maxCharsPerScene }),
      "utf-8"
    );

    const args = [
      resolveBackendScriptPath("ai_consistency.py"),
      "--model-path", modelPath,
      "--input", inputFile,
      "--output", outputFile
    ];

    return await new Promise((resolve) => {
      const python = spawn(pythonCmd, args);
      let stderr = "";
      python.stderr.on("data", (data) => { stderr += data.toString(); });
      python.on("close", (code) => {
        try { fs.unlinkSync(inputFile); } catch (e) {}
        let out = null;
        try {
          if (fs.existsSync(outputFile)) {
            out = JSON.parse(fs.readFileSync(outputFile, "utf-8"));
          }
        } catch (e) {
          out = null;
        }
        try { fs.unlinkSync(outputFile); } catch (e) {}

        if (code !== 0) {
          if (out && typeof out === "object") return resolve(out);
          return resolve({ success: false, error: `Consistency check failed (exit ${code})`, detail: stderr.substring(0, 2000) });
        }
        if (out && typeof out === "object") return resolve(out);
        return resolve({ success: false, error: "Consistency check failed (no output)" });
      });
      python.on("error", (err) => {
        try { fs.unlinkSync(inputFile); } catch (e) {}
        try { fs.unlinkSync(outputFile); } catch (e) {}
        resolve({ success: false, error: "Failed to start consistency check", detail: err.message || String(err) });
      });
    });
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("ai:memory-list", async (_event, payload) => {
  try {
    const vaultPath = payload?.vaultPath || VAULT_PATH;
    const store = readAiMemoryStore(vaultPath);
    const entries = [...(store.data.entries || [])]
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
      .slice(0, 200);
    return {
      success: true,
      path: store.path,
      entries
    };
  } catch (error) {
    return { success: false, error: error?.message || String(error), entries: [] };
  }
});

ipcMain.handle("ai:memory-save", async (_event, payload) => {
  try {
    const vaultPath = payload?.vaultPath || VAULT_PATH;
    const incoming = payload?.entry || {};
    const now = new Date().toISOString();
    const store = readAiMemoryStore(vaultPath);
    const entries = Array.isArray(store.data.entries) ? [...store.data.entries] : [];
    const entryId = String(incoming.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`);
    const cleaned = {
      id: entryId,
      title: String(incoming.title || "Project memory").trim() || "Project memory",
      text: String(incoming.text || "").trim(),
      tags: Array.isArray(incoming.tags)
        ? incoming.tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 12)
        : [],
      sourceType: incoming.sourceType ? String(incoming.sourceType) : "",
      sourceId: incoming.sourceId ? String(incoming.sourceId) : "",
      createdAt: incoming.createdAt ? String(incoming.createdAt) : now,
      updatedAt: now
    };

    if (!cleaned.text) {
      return { success: false, error: "Memory text is required." };
    }

    const existingIndex = entries.findIndex((entry) => String(entry?.id || "") === entryId);
    if (existingIndex >= 0) {
      entries[existingIndex] = { ...entries[existingIndex], ...cleaned, createdAt: entries[existingIndex].createdAt || cleaned.createdAt };
    } else {
      entries.unshift(cleaned);
    }

    const savedPath = writeAiMemoryStore(vaultPath, { version: 1, entries: entries.slice(0, 500) });
    return { success: true, path: savedPath, entry: cleaned };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("ai:memory-delete", async (_event, payload) => {
  try {
    const vaultPath = payload?.vaultPath || VAULT_PATH;
    const targetId = String(payload?.id || "").trim();
    if (!targetId) return { success: false, error: "Memory id is required." };

    const store = readAiMemoryStore(vaultPath);
    const savedPath = writeAiMemoryStore(
      vaultPath,
      {
        version: 1,
        entries: (store.data.entries || []).filter((entry) => String(entry?.id || "") !== targetId)
      }
    );
    return { success: true, path: savedPath };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("ai:memory-delete-by-source", async (_event, payload) => {
  try {
    const vaultPath = payload?.vaultPath || VAULT_PATH;
    const sourceType = String(payload?.sourceType || "").trim();
    const sourceId = String(payload?.sourceId || "").trim();
    const requiredTag = String(payload?.tag || "").trim();
    if (!sourceType || !sourceId) {
      return { success: false, error: "sourceType and sourceId are required." };
    }

    const store = readAiMemoryStore(vaultPath);
    const nextEntries = (store.data.entries || []).filter((entry) => {
      if (String(entry?.sourceType || "") !== sourceType) return true;
      if (String(entry?.sourceId || "") !== sourceId) return true;
      if (requiredTag) {
        const tags = Array.isArray(entry?.tags) ? entry.tags.map((tag) => String(tag || "")) : [];
        return !tags.includes(requiredTag);
      }
      return false;
    });
    const savedPath = writeAiMemoryStore(vaultPath, { version: 1, entries: nextEntries });
    return { success: true, path: savedPath };
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("ai:project-chat", async (_event, payload) => {
  try {
    const prompt = String(payload?.prompt || "");
    const context = (payload?.context && typeof payload.context === "object") ? payload.context : {};
    const modelFilename = payload?.modelFilename || null;

    if (!prompt.trim()) return { success: false, error: "No prompt provided" };

    const pythonCmd = getPythonCommand();
    if (!pythonCmd) {
      return { success: false, error: "No bundled Python found. The portable distribution may be incomplete." };
    }

    const modelPath = resolveLocalModelPath(modelFilename);
    if (!modelPath) {
      return { success: false, error: "No local model selected or model not found." };
    }

    const tmpRoot = app.getPath("temp");
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const inputFile = path.join(tmpRoot, `extal_ai_project_chat_in_${id}.json`);
    const outputFile = path.join(tmpRoot, `extal_ai_project_chat_out_${id}.json`);
    fs.writeFileSync(inputFile, JSON.stringify({ prompt, context }), "utf-8");

    const args = [
      resolveBackendScriptPath("ai_project_chat.py"),
      "--model-path", modelPath,
      "--input", inputFile,
      "--output", outputFile
    ];

    return await new Promise((resolve) => {
      const python = spawn(pythonCmd, args);
      let stderr = "";
      python.stderr.on("data", (data) => { stderr += data.toString(); });
      python.on("close", (code) => {
        try { fs.unlinkSync(inputFile); } catch (e) {}
        let out = null;
        try {
          if (fs.existsSync(outputFile)) {
            out = JSON.parse(fs.readFileSync(outputFile, "utf-8"));
          }
        } catch (e) {
          out = null;
        }
        try { fs.unlinkSync(outputFile); } catch (e) {}

        if (code !== 0) {
          if (out && typeof out === "object") return resolve(out);
          return resolve({ success: false, error: `Project chat failed (exit ${code})`, detail: stderr.substring(0, 2000) });
        }
        if (out && typeof out === "object") return resolve(out);
        return resolve({ success: false, error: "Project chat failed (no output)" });
      });
      python.on("error", (err) => {
        try { fs.unlinkSync(inputFile); } catch (e) {}
        try { fs.unlinkSync(outputFile); } catch (e) {}
        resolve({ success: false, error: "Failed to start project chat process", detail: err.message || String(err) });
      });
    });
  } catch (error) {
    return { success: false, error: error?.message || String(error) };
  }
});

// Download a model
ipcMain.handle('download-model', async (event, url, filename) => {
  const modelsDir = USER_MODELS_DIR;
  
  // Create models directory if it doesn't exist
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true });
  }
  
  const filePath = path.join(modelsDir, filename);
  const http = require('http');
  const https = require('https');

  const formatBytes = (bytes) => {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let unitIndex = 0;
    let size = value;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    const precision = unitIndex === 0 ? 0 : 1;
    return `${size.toFixed(precision)} ${units[unitIndex]}`;
  };
  
  return new Promise((resolve, reject) => {
    log('Downloading model from:', url);
    log('Saving to:', filePath);

    let lastProgress = 0;

    const cleanPartialDownload = () => {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (_) {}
    };

    const emitProgress = (downloadedBytes, totalBytes) => {
      const percent = totalBytes > 0
        ? Math.max(0, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)))
        : 0;

      if (percent === lastProgress && totalBytes > 0) return;
      lastProgress = percent;

      try {
        event.sender.send('download-progress', {
          filename,
          downloaded: formatBytes(downloadedBytes),
          total: totalBytes > 0 ? formatBytes(totalBytes) : 'Unknown',
          percent
        });
      } catch (e) {
        console.error('Error sending progress:', e);
      }
    };

    const downloadWithRedirects = (downloadUrl, redirectsRemaining = 5) => {
      const client = String(downloadUrl).startsWith('https:') ? https : http;
      const request = client.get(downloadUrl, {
        headers: {
          'User-Agent': 'ExtalWorldBuilder/0.8.0-c'
        }
      }, (response) => {
        const statusCode = Number(response.statusCode || 0);

        if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
          if (redirectsRemaining <= 0) {
            response.resume();
            reject(new Error('Too many redirects while downloading model.'));
            return;
          }

          const redirectedUrl = new URL(response.headers.location, downloadUrl).toString();
          log('Redirecting model download to:', redirectedUrl);
          response.resume();
          downloadWithRedirects(redirectedUrl, redirectsRemaining - 1);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Download failed with status code ${statusCode}`));
          return;
        }

        const totalBytes = Number.parseInt(response.headers['content-length'] || '0', 10) || 0;
        let downloadedBytes = 0;
        const fileStream = fs.createWriteStream(filePath);

        response.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          emitProgress(downloadedBytes, totalBytes);
        });

        response.on('error', (err) => {
          fileStream.destroy();
          cleanPartialDownload();
          reject(new Error(`Download stream failed: ${err.message}`));
        });

        fileStream.on('error', (err) => {
          response.destroy();
          cleanPartialDownload();
          reject(new Error(`Failed to write downloaded model: ${err.message}`));
        });

        fileStream.on('finish', () => {
          fileStream.close(() => {
            emitProgress(totalBytes || downloadedBytes, totalBytes || downloadedBytes);
            log('Download completed successfully');
            resolve({ success: true, path: filePath });
          });
        });

        response.pipe(fileStream);
      });

      request.on('error', (err) => {
        cleanPartialDownload();
        reject(new Error(`Model download failed: ${err.message}`));
      });
    };

    downloadWithRedirects(url);
  });
});

// Delete a model
ipcMain.handle('delete-model', async (event, filename) => {
  const modelsDir = USER_MODELS_DIR;
  const filePath = path.join(modelsDir, filename);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    return { success: true };
  } else {
    throw new Error('Model file not found');
  }
});

// Check if llama-cpp-python is installed
ipcMain.handle('check-llama-installed', async () => {
  const { spawn } = require('child_process');
  
  // Check bundled Python first, then venv
  const pythonCmd = getPythonCommand();
  
  if (!pythonCmd) {
    console.warn('[check-llama-installed] No Python command found');
    return false;
  }
  
  return new Promise((resolve) => {
    // Try to import llama_cpp and get its version to verify it's properly installed
    const python = spawn(pythonCmd, ['-c', 'import llama_cpp; print("installed")']);
    
    let output = '';
    
    python.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    python.on('close', (code) => {
      // Check if code is 0 AND we got the expected output
      resolve(code === 0 && output.includes('installed'));
    });
    
    python.on('error', (err) => {
      console.error('[check-llama-installed] Spawn error:', err.message);
      resolve(false);
    });
  });
});

// Install llama-cpp-python in a virtual environment
ipcMain.handle('install-llama-cpp', async () => {
  console.log('[install-llama-cpp] ========== INSTALLATION STARTED ==========');
  
  const { exec } = require('child_process');
  const util = require('util');
  const execPromise = util.promisify(exec);
  
  // Use user data directory for venv in packaged apps (app.asar is read-only)
  const venvDir = app.isPackaged
    ? path.join(USER_DATA_DIR, 'backend', 'venv')
    : path.join(__dirname, 'backend', 'venv');
  
  const pythonCmd = getPythonCommand();
  const bundledPython = getBundledPythonCommand();
  
  console.log('[install-llama-cpp] venvDir:', venvDir);
  console.log('[install-llama-cpp] pythonCmd:', pythonCmd);
  console.log('[install-llama-cpp] bundledPython:', bundledPython);
  
  // Helper function to recursively copy directory
  const copyDir = async (src, dest) => {
    try {
      console.log(`[copyDir] Creating destination: ${dest}`);
      await fs.promises.mkdir(dest, { recursive: true });
      
      console.log(`[copyDir] Reading source: ${src}`);
      const entries = await fs.promises.readdir(src, { withFileTypes: true });
      console.log(`[copyDir] Found ${entries.length} entries to copy`);
      
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        
        if (entry.isDirectory()) {
          console.log(`[copyDir] Recursing into directory: ${entry.name}`);
          await copyDir(srcPath, destPath);
        } else {
          console.log(`[copyDir] Copying file: ${entry.name}`);
          await fs.promises.copyFile(srcPath, destPath);
        }
      }
      console.log(`[copyDir] Successfully completed copy from ${src} to ${dest}`);
    } catch (err) {
      console.error(`[copyDir] Error: ${err.message}`);
      throw err;
    }
  };
  
  try {
    console.log('[install-llama-cpp] Starting main try block...');
    console.log('[install-llama-cpp] app.isPackaged:', app.isPackaged);
    
    if (bundledPython) {
      console.log('[install-llama-cpp] Bundled Python found, proceeding with installation...');
      
      // Path to pre-built llama_cpp package
      const sourcePackagePath = app.isPackaged
        ? path.join(process.resourcesPath, "app.asar.unpacked", "backend", "lib", "python", "llama_cpp")
        : path.join(__dirname, "backend", "lib", "python", "llama_cpp");
      
      console.log('[install-llama-cpp] sourcePackagePath:', sourcePackagePath);
      console.log('[install-llama-cpp] sourcePackagePath exists:', fs.existsSync(sourcePackagePath));
      
      // Get the site-packages directory for bundled Python
      let sitePackagesDirs = [];
      let sitePackagesDir;
      try {
        console.log('[install-llama-cpp] Getting site-packages directory...');
        const result = await execPromise(
          `"${bundledPython}" -c "import json, site; print(json.dumps(site.getsitepackages()))"`
        );
        sitePackagesDirs = JSON.parse(result.stdout.trim()).filter(Boolean);
        sitePackagesDir = sitePackagesDirs.find((dir) => /site-packages/i.test(dir)) || sitePackagesDirs[sitePackagesDirs.length - 1];
        console.log('[install-llama-cpp] sitePackagesDirs:', sitePackagesDirs);
        console.log('[install-llama-cpp] sitePackagesDir:', sitePackagesDir);
      } catch (err) {
        console.error('[install-llama-cpp] Failed to get site-packages:', err.message);
        console.error('[install-llama-cpp] Error code:', err.code);
        console.error('[install-llama-cpp] Error stderr:', err.stderr);
        return {
          success: false,
          error: 'Failed to determine Python site-packages directory: ' + err.message
        };
      }
      
      const resolveTargetPackagePath = () => {
        const candidatePaths = sitePackagesDirs.map((dir) => path.join(dir, 'llama_cpp'));
        return candidatePaths.find((candidatePath) => fs.existsSync(path.join(candidatePath, 'lib'))) ||
          candidatePaths.find((candidatePath) => fs.existsSync(candidatePath)) ||
          path.join(sitePackagesDir, 'llama_cpp');
      };

      let targetPackagePath = path.join(sitePackagesDir, "llama_cpp");
      console.log('[install-llama-cpp] targetPackagePath:', targetPackagePath);

      const legacyWheelName = 'llama-cpp-python.whl';
      const minimumWheelBytes = 1024;
      const platformWheelMatchers = {
        win32: [/win_amd64/i, /windows/i],
        linux: [/manylinux.*x86_64/i, /linux_x86_64/i, /linux/i],
        darwin: [/macosx/i, /macos/i, /darwin/i]
      };

      // Prefer installing from bundled wheel when available (platform-specific first, then legacy)
      const wheelBasePath = app.isPackaged
        ? path.join(process.resourcesPath, "app.asar.unpacked", "backend", "lib", "python")
        : path.join(__dirname, "backend", "lib", "python");
      
      const legacyWheelPath = path.join(wheelBasePath, legacyWheelName);
      const candidateWheelPaths = new Set([legacyWheelPath]);
      if (fs.existsSync(wheelBasePath)) {
        for (const entry of fs.readdirSync(wheelBasePath)) {
          if (String(entry).toLowerCase().endsWith('.whl')) {
            candidateWheelPaths.add(path.join(wheelBasePath, entry));
          }
        }
      }

      const wheelMatchers = platformWheelMatchers[process.platform] || [];
      const wheelInfos = Array.from(candidateWheelPaths)
        .filter((candidatePath) => fs.existsSync(candidatePath))
        .map((candidatePath) => {
          const stats = fs.statSync(candidatePath);
          const name = path.basename(candidatePath);
          const looksValid = stats.size > minimumWheelBytes;
          const score =
            (wheelMatchers.some((matcher) => matcher.test(name)) ? 6 : 0) +
            (candidatePath === legacyWheelPath ? 1 : 0) +
            (/cp312/i.test(name) ? 3 : 0) +
            (/cp311/i.test(name) ? 2 : 0) +
            (/cp310/i.test(name) ? 1 : 0) +
            (/^llama-cpp-python-(win64|linux64|macos)\.whl$/i.test(name) ? -4 : 0) +
            (/cp\d{2,3}|abi3/i.test(name) ? 1 : 0);

          return {
            path: candidatePath,
            name,
            size: stats.size,
            looksValid,
            score
          };
        })
        .sort((left, right) => right.score - left.score || right.size - left.size || left.name.localeCompare(right.name));

      const installableWheel =
        wheelInfos.find((info) => info.looksValid && wheelMatchers.some((matcher) => matcher.test(info.name))) ||
        wheelInfos.find((info) => info.looksValid && info.name === legacyWheelName) ||
        null;
      const localWheelPath = installableWheel ? installableWheel.path : null;

      console.log('[install-llama-cpp] Platform:', process.platform);
      console.log('[install-llama-cpp] Looking for platform wheel matchers:', wheelMatchers.map((matcher) => matcher.toString()));
      console.log('[install-llama-cpp] Available wheel candidates:', wheelInfos.map((info) => `${info.name} (${info.size} bytes)`));
      console.log('[install-llama-cpp] Using wheel:', localWheelPath);

      let wheelInstalled = false;
      if (localWheelPath && fs.existsSync(localWheelPath)) {
        try {
          const stats = fs.statSync(localWheelPath);
          if (stats.size > minimumWheelBytes) {
            console.log('[INSTALL] Installing bundled wheel:', localWheelPath);
            await execPromise(`"${bundledPython}" -m pip install "${localWheelPath}" --no-deps --quiet`);
            wheelInstalled = true;
          } else {
            console.warn('[INSTALL] Bundled wheel is too small to be a valid wheel:', localWheelPath, stats.size);
          }
        } catch (err) {
          console.warn('[INSTALL] Failed to install bundled wheel:', err.message);
        }
      } else {
        console.warn('[INSTALL] No installable bundled wheel found in', wheelBasePath);
      }
      
      let installedTargetReady = wheelInstalled;

      if (!installedTargetReady && fs.existsSync(sourcePackagePath)) {
        console.log('[INSTALL] Source package found, proceeding with copy...');

        if (fs.existsSync(targetPackagePath)) {
          console.log('[INSTALL] Removing existing package at', targetPackagePath);
          fs.rmSync(targetPackagePath, { recursive: true, force: true });
        }

        console.log('[INSTALL] Starting copy...');
        await copyDir(sourcePackagePath, targetPackagePath);
        console.log('[INSTALL] Copy complete');

        console.log('[INSTALL] Verifying copy succeeded...');
        const copyVerified = fs.existsSync(path.join(targetPackagePath, '__init__.py'));
        console.log('[INSTALL] Target __init__.py exists:', copyVerified);

        if (!copyVerified) {
          console.log('[install-llama-cpp] ========== COPY VERIFICATION FAILED ==========');
          const dirContents = fs.existsSync(targetPackagePath) ? await fs.promises.readdir(targetPackagePath) : [];
          console.log('[INSTALL] Target directory contents:', dirContents);
          return {
            success: false,
            error: 'Package files were not copied correctly to site-packages'
          };
        }

        installedTargetReady = true;
      }

      if (!installedTargetReady) {
        console.log('[install-llama-cpp] Pre-built package not found, attempting pip install from GitHub releases');
        
        // llama-cpp-python provides pre-built wheels on GitHub releases via a special index URL
        const extraIndexUrl = 'https://abetlen.github.io/llama-cpp-python/whl/cpu';
        
        try {
          // Try installing from the llama-cpp-python wheel index (CPU version)
          console.log('[install-llama-cpp] Trying GitHub release index (CPU)...');
          await execPromise(`"${bundledPython}" -m pip install llama-cpp-python --extra-index-url "${extraIndexUrl}" --prefer-binary --no-cache-dir --quiet`);
          installedTargetReady = true;
          console.log('[install-llama-cpp] ========== PIP INSTALLATION SUCCESSFUL (GitHub index) ==========');
        } catch (pipErr) {
          console.warn('[install-llama-cpp] GitHub index install failed:', pipErr.message);
          
          // Fallback: try standard pip install (requires build tools)
          try {
            console.log('[install-llama-cpp] Attempting standard pip install (may require C++ compiler)...');
            await execPromise(`"${bundledPython}" -m pip install llama-cpp-python --no-cache-dir`, { timeout: 600000 });
            installedTargetReady = true;
            console.log('[install-llama-cpp] ========== PIP INSTALLATION SUCCESSFUL (source build) ==========');
          } catch (buildErr) {
            console.error('[install-llama-cpp] All installation methods failed');
            console.error('[install-llama-cpp] GitHub index error:', pipErr.message);
            console.error('[install-llama-cpp] Source build error:', buildErr.message);
            return {
              success: false,
              error: 'Could not install llama-cpp-python. Pre-built wheels may not be available for your platform. ' +
                     'Try installing Visual Studio Build Tools (Windows) or build-essential (Linux) and retry.'
            };
          }
        }
      }

      if (!installedTargetReady) {
        return { success: false, error: 'Installation did not complete' };
      }

      // Ensure native library directory exists (Windows needs llama_cpp/lib with DLLs)
      targetPackagePath = resolveTargetPackagePath();
      let nativeLibDir = path.join(targetPackagePath, 'lib');
      console.log('[INSTALL] Checking for native lib directory:', nativeLibDir);
      console.log('[INSTALL] nativeLibDir exists:', fs.existsSync(nativeLibDir));
      
      if (fs.existsSync(targetPackagePath)) {
        console.log('[INSTALL] targetPackagePath exists:', targetPackagePath);
        const contents = fs.readdirSync(targetPackagePath);
        console.log('[INSTALL] targetPackagePath contents:', contents);
      } else {
        console.warn('[INSTALL] targetPackagePath does NOT exist:', targetPackagePath);
      }
      
      if (!fs.existsSync(nativeLibDir)) {
        console.warn('[INSTALL] Native lib directory missing:', nativeLibDir);
        console.warn('[INSTALL] Attempting to install llama-cpp-python wheel via pip (binary only)...');

        let pipInstalled = false;
        if (fs.existsSync(localWheelPath)) {
          try {
            const stats = fs.statSync(localWheelPath);
            if (stats.size > minimumWheelBytes) {
              console.log('[INSTALL] Installing from local wheel:', localWheelPath);
              await execPromise(`"${bundledPython}" -m pip install "${localWheelPath}" --no-deps --quiet`);
              pipInstalled = true;
            } else {
              console.warn('[INSTALL] Local wheel is too small to be valid, skipping:', localWheelPath, stats.size);
            }
          } catch (err) {
            console.warn('[INSTALL] Failed to install local wheel:', err.message);
          }
        }

        if (!pipInstalled) {
          try {
            const wheelDownloadDir = app.isPackaged
              ? path.join(USER_DATA_DIR, 'backend', 'wheels')
              : path.join(__dirname, 'backend', 'wheels');

            await fs.promises.mkdir(wheelDownloadDir, { recursive: true });

            console.log('[INSTALL] Downloading binary wheel to:', wheelDownloadDir);
            await execPromise(`"${bundledPython}" -m pip download llama-cpp-python --only-binary=:all: --no-deps --extra-index-url "https://abetlen.github.io/llama-cpp-python/whl/cpu" -d "${wheelDownloadDir}"`);

            const wheelFiles = (await fs.promises.readdir(wheelDownloadDir))
              .filter((name) => name.toLowerCase().endsWith('.whl'));

            if (wheelFiles.length === 0) {
              console.warn('[INSTALL] No wheel downloaded for current Python, trying win_amd64 cp311 wheel...');
              await execPromise(
                `"${bundledPython}" -m pip download llama-cpp-python ` +
                `--only-binary=:all: --no-deps --platform win_amd64 --python-version 311 ` +
                `--implementation cp --abi cp311 -d "${wheelDownloadDir}"`
              );
            }

            const updatedWheelFiles = (await fs.promises.readdir(wheelDownloadDir))
              .filter((name) => name.toLowerCase().endsWith('.whl'));

            if (updatedWheelFiles.length === 0) {
              throw new Error('No wheel files were downloaded');
            }

            const wheelPath = path.join(wheelDownloadDir, updatedWheelFiles[0]);
            console.log('[INSTALL] Installing downloaded wheel:', wheelPath);
            await execPromise(`"${bundledPython}" -m pip install "${wheelPath}" --no-deps --quiet`);
            pipInstalled = true;
            console.log('[INSTALL] Pip binary install completed');

            if (!fs.existsSync(nativeLibDir)) {
              console.log('[INSTALL] Attempting to extract DLLs from wheel...');
              const extractScript = [
                'import sys, zipfile, os, shutil, tempfile',
                'wheel_path = sys.argv[1]',
                'target_lib = sys.argv[2]',
                'tmp = tempfile.mkdtemp()',
                'zipfile.ZipFile(wheel_path).extractall(tmp)',
                'src_lib = os.path.join(tmp, "llama_cpp", "lib")',
                'os.makedirs(target_lib, exist_ok=True)',
                'assert os.path.isdir(src_lib), "NO_LIB_DIR"',
                'files = os.listdir(src_lib)',
                'for name in files: shutil.copy2(os.path.join(src_lib, name), os.path.join(target_lib, name))',
                'print("COPIED_LIBS")'
              ].join('; ');

              await execPromise(`"${bundledPython}" -c "${extractScript}" "${wheelPath}" "${nativeLibDir}"`);
            }
          } catch (err) {
            console.warn('[INSTALL] Pip binary install failed:', err.message);
          }
        }

        targetPackagePath = resolveTargetPackagePath();
        nativeLibDir = path.join(targetPackagePath, 'lib');

        if (!fs.existsSync(nativeLibDir)) {
          console.error('[INSTALL] Native lib directory still missing after pip attempt');
        } else {
          console.log('[INSTALL] Native lib directory found after pip install:', nativeLibDir);
        }
      }

      if (!fs.existsSync(nativeLibDir)) {
        return {
          success: false,
          error: 'Native library directory missing for llama_cpp (expected lib/ with DLLs). Ensure a valid llama-cpp-python wheel is bundled or available for download.'
        };
      }
      
      // Install dependencies that llama_cpp needs
      console.log('[INSTALL] Installing dependencies for llama_cpp...');
      const dependencies = ['typing_extensions', 'numpy', 'diskcache', 'jinja2', 'pydantic'];
      
      for (const dep of dependencies) {
        try {
          console.log(`[INSTALL] Installing ${dep}...`);
          await execPromise(`"${bundledPython}" -m pip install ${dep} --quiet`);
          console.log(`[INSTALL] ${dep} installed successfully`);
        } catch (err) {
          console.warn(`[INSTALL] Warning: Failed to install ${dep}: ${err.message}`);
          // Continue anyway, might not be critical
        }
      }
      
      // Verify the installation
      console.log('[INSTALL] Verifying installation...');
      
      // List what was copied
      try {
        const copiedFiles = await fs.promises.readdir(targetPackagePath);
        console.log('[INSTALL] Files in copied package:', copiedFiles.slice(0, 10), copiedFiles.length > 10 ? `... and ${copiedFiles.length - 10} more` : '');
      } catch (err) {
        console.error('[INSTALL] Could not list copied files:', err.message);
      }
      
      const verifyResult = await new Promise((resolve) => {
        const { spawn } = require('child_process');
        const python = spawn(bundledPython, ['-c', 'import llama_cpp; print("verified")']);
        let stdout = '';
        let stderr = '';
        
        python.stdout.on('data', (data) => {
          stdout += data.toString();
          console.log('[INSTALL] Python stdout:', data.toString());
        });
        
        python.stderr.on('data', (data) => {
          stderr += data.toString();
          console.error('[INSTALL] Python stderr:', data.toString());
        });
        
        python.on('close', (code) => {
          console.log('[INSTALL] Verify process closed with code:', code);
          console.log('[INSTALL] Full stdout:', stdout);
          console.log('[INSTALL] Full stderr:', stderr);
          const verified = code === 0 && stdout.includes('verified');
          console.log('[INSTALL] Verification result:', verified);
          
          if (!verified) {
            console.log('[INSTALL] Verification failed details - Code:', code, 'Has verified:', stdout.includes('verified'), 'Error output:', stderr);
          }
          resolve({ verified, code, stderr });
        });
        
        python.on('error', (err) => {
          console.error('[INSTALL] Verify process spawn error:', err.message);
          resolve({ verified: false, code: -1, stderr: err.message });
        });
      });
      
      if (verifyResult.verified) {
        console.log('[install-llama-cpp] ========== INSTALLATION SUCCESSFUL ==========');
        return { success: true, target: 'bundled' };
      } else {
        console.log('[install-llama-cpp] ========== VERIFICATION FAILED ==========');
        const errorDetail = verifyResult.stderr || 'No error output';
        console.log('[install-llama-cpp] Verification error detail:', errorDetail);
        return { 
          success: false, 
          error: `Installation verification failed: ${errorDetail}` 
        };
      }
    } else {
      // No bundled Python
      console.warn('[install-llama-cpp] No bundled Python found');
    }
    // end if (bundledPython)

    // Venv fallback only works in dev mode
    if (!bundledPython && !app.isPackaged) {
      console.log('[install-llama-cpp] Falling back to venv creation (dev mode)...');
      // Fallback: create virtual environment if no bundled runtime (dev mode only)
      log('Creating virtual environment...');
      // Ensure venv directory exists
      if (!fs.existsSync(path.dirname(venvDir))) {
        fs.mkdirSync(path.dirname(venvDir), { recursive: true });
      }
      await execPromise(`"${pythonCmd}" -m venv "${venvDir}"`);

      log('Installing llama-cpp-python...');
      const pythonPath = process.platform === 'win32'
        ? path.join(venvDir, 'Scripts', 'python.exe')
        : path.join(venvDir, 'bin', 'python');
      
      const sourcePackagePath = path.join(__dirname, "backend", "lib", "python", "llama_cpp");
      
      const { stdout } = await execPromise(
        `"${pythonPath}" -c "import site; print(site.getsitepackages()[0])"`
      );
      const sitePackagesDir = stdout.trim();
      const targetPackagePath = path.join(sitePackagesDir, "llama_cpp");
      
      if (fs.existsSync(sourcePackagePath)) {
        log(`Copying pre-built package from ${sourcePackagePath} to ${targetPackagePath}`);
        
        if (fs.existsSync(targetPackagePath)) {
          fs.rmSync(targetPackagePath, { recursive: true, force: true });
        }
        
        await copyDir(sourcePackagePath, targetPackagePath);
        log('Successfully installed llama-cpp-python');
      } else {
        log(`Pre-built package not found at ${sourcePackagePath}, attempting pip install`);
        const pipPath = process.platform === 'win32'
          ? path.join(venvDir, 'Scripts', 'pip.exe')
          : path.join(venvDir, 'bin', 'pip');
        await execPromise(`"${pipPath}" install llama-cpp-python`);
      }

      console.log('[install-llama-cpp] ========== INSTALLATION SUCCESSFUL ==========');
      return { success: true, target: 'venv' };
    } else if (!bundledPython) {
      // No bundled Python and packaged app
      return { 
        success: false, 
        error: 'Bundled Python not found. Please install Python or use a dev build.'
      };
    }
  } catch (error) {
    console.error('[install-llama-cpp] ========== INSTALLATION FAILED ==========');
    console.error('[install-llama-cpp] Raw error:', error);
    console.error('[install-llama-cpp] Error type:', typeof error);
    console.error('[install-llama-cpp] Error constructor:', error?.constructor?.name);
    console.error('[install-llama-cpp] Error keys:', error ? Object.keys(error) : 'null');
    console.error('[install-llama-cpp] Error stack:', error?.stack);
    console.error('[install-llama-cpp] Error message:', error?.message);
    console.error('[install-llama-cpp] Error stderr:', error?.stderr);
    
    let errorMsg = 'Installation failed for unknown reason';
    
    if (error && typeof error === 'object') {
      if (error.message) {
        errorMsg = String(error.message);
      } else if (error.stderr) {
        errorMsg = 'Installation error: ' + String(error.stderr);
      } else if (error.stdout) {
        errorMsg = String(error.stdout);
      } else if (error.code) {
        errorMsg = `Process exited with code ${error.code}`;
      } else {
        try {
          errorMsg = JSON.stringify(error);
        } catch (e) {
          errorMsg = 'Installation error (could not serialize error object)';
        }
      }
    } else if (error) {
      errorMsg = String(error);
    }
    
    console.error('[install-llama-cpp] Formatted error message:', errorMsg);
    
    return { 
      success: false, 
      error: errorMsg
    };
  }
});
