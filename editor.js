// Centralized editor initializer and helpers (TinyMCE adapter)
// NOTE: The app entry point is frontend/index.html; this root copy is kept in sync with
// frontend/editor.js for reference. Changes should be made to frontend/editor.js first.
(function(window){
    const Editor = {};

    Editor.editors = {};
    Editor.all = [];

    Editor.registerWhitelists = function() {
        // TinyMCE path: no global format registration needed.
    };

    Editor.registerDynamicFonts = function(fontKeys) {
        if (!Array.isArray(fontKeys) || !fontKeys.length) return;
        try { window.__extalDynamicFonts = Array.from(new Set(fontKeys.map((x) => String(x || '').trim()).filter(Boolean))); } catch (_) {}
    };

    Editor.create = function(selector, opts){
        const container = document.querySelector(selector);
        if (!container) return null;
        if (container.__editor) return container.__editor;
        if (container.__editorInstance) return container.__editorInstance;
        if (!window.TinyMCEAdapter || typeof window.TinyMCEAdapter.create !== 'function') {
            console.error('TinyMCE adapter is unavailable; editor cannot be initialized.');
            return null;
        }

        const tiny = window.TinyMCEAdapter.create(container, opts || {});
        if (!tiny) return null;

        container.__editor = tiny;
        container.__editorInstance = tiny;
        Editor.all.push(tiny);
        return tiny;
    };

    Editor.initEditors = function(){
        Editor.registerWhitelists();

        // Main editor
        window.editor = Editor.create('#editor-content-wrapper', { placeholder: 'Start writing...' });
        window.bioEditor = Editor.create('#char-bio-editor', { placeholder: 'Character biography...' });
        window.notesEditor = Editor.create('#char-notes-editor', { placeholder: 'Character notes...' });
        
        window.eventDescriptionEditor = Editor.create('#event-description-editor', { placeholder: 'Event description...' });

        // Build list of editors (character editors will be added when initialized)
        Editor.editors.main = window.editor;
        Editor.editors.bio = window.bioEditor;
        Editor.editors.notes = window.notesEditor;
        Editor.editors.event = window.eventDescriptionEditor;

        const ensureResizableImages = (q) => {
            if (!q || !q.root || typeof window.makeImageResizable !== 'function') return;
            q.root.querySelectorAll('img').forEach((img) => {
                if (img.dataset.resizable) return;
                img.dataset.resizable = 'true';
                window.makeImageResizable(img);
            });
        };

        // Track active editor and wire autosave
        Editor.all.forEach((q) => {
            if (!q) return;
            q.on('selection-change', (range) => {
                if (typeof window.isNativeTableCellEditingActive === 'function' && window.isNativeTableCellEditingActive()) {
                    return;
                }
                if (range && Number.isInteger(range.index) && Number.isInteger(range.length)) {
                    q.__lastRange = { index: range.index, length: range.length };
                    window.activeEditor = q;
                    if (typeof window.syncToolbarToEditorFormat === 'function') {
                        window.syncToolbarToEditorFormat(q, range);
                    }
                }
            });
            if (q.root) {
                q.root.addEventListener('click', (e) => {
                    if (e.target && e.target.tagName === 'IMG' && !e.target.dataset.resizable && typeof window.makeImageResizable === 'function') {
                        e.target.dataset.resizable = 'true';
                        window.makeImageResizable(e.target);
                    }
                    setTimeout(() => {
                        if (typeof window.syncToolbarToEditorFormat !== 'function') return;
                        if (typeof window.isNativeTableCellEditingActive === 'function' && window.isNativeTableCellEditingActive(e.target)) return;
                        const sel = q.getSelection ? q.getSelection() : null;
                        if (sel) {
                            window.activeEditor = q;
                            window.syncToolbarToEditorFormat(q, sel);
                        }
                    }, 0);
                });
            }
            // generic text-change autosave hooks
            q.on('text-change', (delta, oldDelta, source) => {
                if (window._suppressEditorAutosave) {
                    return;
                }
                try {
                    if (source === 'user' && typeof window.scheduleAutoOutlineNormalization === 'function') {
                        window.scheduleAutoOutlineNormalization(q);
                    }
                    ensureResizableImages(q);

                    if (source && source !== 'user') {
                        return;
                    }
                    window.__anyEditorDirty = true;
                    
                    if (window.UIState && window.UIState.selectedItemId) {
                        if (q === window.editor) {
                            if (window.UIState.selectedItemType === 'character' && window.UIState.activeCharTab === 'bio') {
                                if (typeof window.saveCharacterData === 'function') window.saveCharacterData();
                            } else {
                                if (typeof window.syncEditorToData === 'function') window.syncEditorToData();
                            }
                        }
                        else if (q === window.notesEditor && window.UIState.selectedItemType === 'character' && window.UIState.activeCharTab === 'notes') {
                            if (typeof window.saveCharacterData === 'function') window.saveCharacterData();
                        }
                        else if (q === window.eventDescriptionEditor) {
                            if (typeof window.scheduleVaultSave === 'function') window.scheduleVaultSave();
                        }
                    }
                } catch(e){ console.warn('Autosave hook failed', e); }
            });
        });

        Editor.all.forEach((q) => ensureResizableImages(q));

        // Set initial active editor
        window.activeEditor = window.editor || Editor.all[0] || null;
    };

    Editor.initCharacterEditors = function(){
        // No character editors, they are simple textareas
    };

    Editor.getActive = function(){ return window.activeEditor || null; };

    Editor.insertImage = function(url, opts){
        const ed = Editor.getActive() || window.editor;
        if (!ed) return false;
        const imagePath = (url && (url.startsWith('/') || /^[a-zA-Z]:/.test(url))) ? new URL('file://' + url).href : url;
        const sel = ed.getSelection();
        const idx = sel ? sel.index : (ed.getLength ? ed.getLength() : 0);
        ed.insertEmbed(idx, 'image', imagePath, 'user');
        ed.setSelection(idx + 1, 0, 'silent');
        if (typeof window.syncEditorToData === 'function') window.syncEditorToData();
        
        setTimeout(() => {
            if (ed.root && typeof window.makeImageResizable === 'function') {
                const imgs = ed.root.querySelectorAll('img');
                imgs.forEach(img => {
                    if (!img.dataset.resizable) {
                        img.dataset.resizable = 'true';
                        window.makeImageResizable(img);
                    }
                });
            }
        }, 0);
        
        return true;
    };

    window.Editor = Editor;
})(window);
