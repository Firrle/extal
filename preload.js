// ============================================================
// PRELOAD SCRIPT — SAFE BRIDGE
// ============================================================

const { contextBridge, ipcRenderer, shell } = require("electron");

// ------------------------------------------------------------
// IMAGE PICKERS
// ------------------------------------------------------------
contextBridge.exposeInMainWorld("api", {
    runtimeInfo: {
        platform: process.platform,
        packaged: !process.defaultApp
    },
    nudgeWindowFocus: () => ipcRenderer.invoke("nudge-window-focus"),
    pickMapImage: () => ipcRenderer.invoke("pick-map-image"),
    pickEditorImage: () => ipcRenderer.invoke("pick-editor-image"),
    pickVaultFile: () => ipcRenderer.invoke("pick-vault-file"),
    loadVaultFromPath: (vaultPath) => ipcRenderer.invoke("load-vault-from-path", vaultPath),
    getDemoVaultPath: () => ipcRenderer.invoke("get-demo-vault-path"),
    openHelp: () => ipcRenderer.send("open-help"),
    toggleDevTools: () => ipcRenderer.invoke("toggle-devtools"),
    openExternal: (url) => ipcRenderer.invoke("open-external-url", url),
    scanDocument: (text, useAI, modelFilename) => ipcRenderer.invoke("scan-document-text", text, useAI, modelFilename),
    pickTextFile: () => ipcRenderer.invoke("pick-text-file"),
    pickFolderToScan: () => ipcRenderer.invoke("pick-folder-to-scan"),
    // AI Model Management
    getInstalledModels: () => ipcRenderer.invoke("get-installed-models"),
    downloadModel: (url, filename) => ipcRenderer.invoke("download-model", url, filename),
    deleteModel: (filename) => ipcRenderer.invoke("delete-model", filename),
    checkLlamaInstalled: () => ipcRenderer.invoke("check-llama-installed"),
    installLlamaCpp: () => ipcRenderer.invoke("install-llama-cpp"),
    aiRewriteText: (payload) => ipcRenderer.invoke("ai:rewrite-text", payload),
    aiConsistencyCheck: (payload) => ipcRenderer.invoke("ai:consistency-check", payload),
    aiProjectChat: (payload) => ipcRenderer.invoke("ai:project-chat", payload),
    aiMemoryList: (payload) => ipcRenderer.invoke("ai:memory-list", payload),
    aiMemorySave: (payload) => ipcRenderer.invoke("ai:memory-save", payload),
    aiMemoryDelete: (payload) => ipcRenderer.invoke("ai:memory-delete", payload),
    aiMemoryDeleteBySource: (payload) => ipcRenderer.invoke("ai:memory-delete-by-source", payload),
    ttsGetSupport: () => ipcRenderer.invoke("tts:get-support"),
    ttsPrewarm: (payload) => ipcRenderer.invoke("tts:prewarm", payload),
    ttsSynthesize: (payload) => ipcRenderer.invoke("tts:synthesize", payload),
    ttsSave: (payload) => ipcRenderer.invoke("tts:save", payload),
    ttsSaveWithDialog: (payload) => ipcRenderer.invoke("tts:save-with-dialog", payload),
    // Listen for download progress
    onDownloadProgress: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on("download-progress", listener);
        return () => ipcRenderer.removeListener("download-progress", listener);
    },
    // Font management
    onFontsUpdated: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on("fonts-updated", listener);
        return () => ipcRenderer.removeListener("fonts-updated", listener);
    },
    // Menu event listeners
    onMenuNewVault: (callback) => ipcRenderer.on('menu-new-vault', callback),
    onMenuOpenVault: (callback) => ipcRenderer.on('menu-open-vault', callback),
    onMenuSaveVault: (callback) => ipcRenderer.on('menu-save-vault', callback),
    onMenuSaveVaultAs: (callback) => ipcRenderer.on('menu-save-vault-as', callback),
    onMenuFindReplace: (callback) => ipcRenderer.on('menu-find-replace', callback),
    onMenuOpenDebugConsole: (callback) => ipcRenderer.on('menu-open-debug-console', callback),
    onMenuRebuildIndex: (callback) => ipcRenderer.on('menu-rebuild-index', callback),
    onMenuExportCurrent: (callback) => ipcRenderer.on('menu-export-current', (_event, format) => callback(format)),
    onMenuExportAll: (callback) => ipcRenderer.on('menu-export-all', (_event, format) => callback(format))
    ,
    languageToolStart: (payload) => ipcRenderer.invoke("languagetool:start", payload),
    languageToolStop: () => ipcRenderer.invoke("languagetool:stop"),
    languageToolCheck: (payload) => ipcRenderer.invoke("languagetool:check", payload),
    languageToolPickJar: () => ipcRenderer.invoke("languagetool:pick-jar"),
    languageToolDownloadLatest: (payload) => ipcRenderer.invoke("languagetool:download-latest", payload),
    onLanguageToolDownloadProgress: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on("languagetool:download-progress", listener);
        return () => ipcRenderer.removeListener("languagetool:download-progress", listener);
    }
});

// ------------------------------------------------------------
// VAULT LOADING & SAVING
// ------------------------------------------------------------
contextBridge.exposeInMainWorld("elyriaAPI", {
    loadVault: () => ipcRenderer.invoke("elyria:load-vault"),
    saveVault: (data, vaultPath) => ipcRenderer.invoke("elyria:save-vault", data, vaultPath),
    saveVaultAs: (data) => ipcRenderer.invoke("elyria:save-vault-as", data),
    exportContent: (payload) => ipcRenderer.invoke("elyria:export-content", payload)
});
