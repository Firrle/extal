(function (window) {
    function escapeHtml(text) {
        return String(text || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function normalize(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/['"]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function textNodes(root) {
        const nodes = [];
        if (!root || !root.ownerDocument) return nodes;
        const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let node = walker.nextNode();
        while (node) {
            nodes.push(node);
            node = walker.nextNode();
        }
        return nodes;
    }

    function rangeFromOffsets(root, startIndex, length) {
        if (!root || !root.ownerDocument) return null;
        const doc = root.ownerDocument;
        const selection = doc.getSelection ? doc.getSelection() : null;
        if (!selection) return null;

        const clamp = (value) => Math.max(0, Math.min(Number(value) || 0, String(root.textContent || '').length));
        const start = clamp(startIndex);
        const end = clamp(start + Math.max(0, Number(length) || 0));

        const resolve = (offset) => {
            let remaining = offset;
            for (const node of textNodes(root)) {
                const len = String(node.nodeValue || '').length;
                if (remaining <= len) return { node, offset: remaining };
                remaining -= len;
            }
            return { node: root, offset: root.childNodes.length };
        };

        const range = doc.createRange();
        const startPos = resolve(start);
        const endPos = resolve(end);
        try {
            range.setStart(startPos.node, startPos.offset);
            range.setEnd(endPos.node, endPos.offset);
        } catch (_) {
            try {
                range.selectNodeContents(root);
                range.collapse(false);
            } catch (_) {}
        }
        selection.removeAllRanges();
        selection.addRange(range);
        return range;
    }

    function offsetsFromRange(root, range) {
        if (!root || !range || !root.ownerDocument) return { index: 0, length: 0 };
        const doc = root.ownerDocument;
        const beforeStart = doc.createRange();
        const beforeEnd = doc.createRange();
        beforeStart.selectNodeContents(root);
        beforeEnd.selectNodeContents(root);
        try { beforeStart.setEnd(range.startContainer, range.startOffset); } catch (_) {}
        try { beforeEnd.setEnd(range.endContainer, range.endOffset); } catch (_) {}
        return {
            index: beforeStart.toString().length,
            length: Math.max(0, beforeEnd.toString().length - beforeStart.toString().length)
        };
    }

    function matchToolbarFontValue(family) {
        const fontSelector = document.getElementById('toolbar-font-selector');
        if (!fontSelector) return '';
        const normalizedFamily = normalize(family);
        for (const option of Array.from(fontSelector.options || [])) {
            const optionValue = String(option.value || '');
            if (optionValue === 'System Default') continue;
            const normalizedOption = normalize(optionValue);
            if (normalizedFamily && normalizedFamily.includes(normalizedOption)) return optionValue;
        }
        return '';
    }

    function applyEditorViewportStyles(editor, container) {
        const targets = [];
        if (container) targets.push(container);
        try { if (editor && typeof editor.getElement === 'function') targets.push(editor.getElement()); } catch (_) {}
        try { if (editor && typeof editor.getBody === 'function') targets.push(editor.getBody()); } catch (_) {}

        targets.filter(Boolean).forEach((el) => {
            try {
                el.style.display = 'block';
                el.style.height = '100%';
                el.style.maxHeight = '100%';
                el.style.minHeight = '0';
                el.style.overflowY = 'auto';
                el.style.overflowX = 'hidden';
                el.style.boxSizing = 'border-box';
                el.style.width = '100%';
                el.style.position = 'relative';
                el.style.scrollbarGutter = 'stable';
            } catch (_) {}
        });
    }

    function getSelectedElement(root) {
        if (!root || !root.ownerDocument) return null;
        const selection = root.ownerDocument.getSelection ? root.ownerDocument.getSelection() : null;
        if (!selection || !selection.rangeCount) return null;
        const range = selection.getRangeAt(0);
        const node = range.startContainer;
        return node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    }

    function execCommand(editor, command, value) {
        if (editor && typeof editor.execCommand === 'function') {
            try {
                editor.execCommand(command, false, value);
                return true;
            } catch (_) {}
        }
        try {
            return document.execCommand ? document.execCommand(command, false, value) : false;
        } catch (_) {
            return false;
        }
    }

    function toCssSize(value) {
        const raw = String(value || '').trim();
        if (!raw) return '';
        if (/^\d+$/.test(raw)) return `${raw}px`;
        if (/^\d+(?:\.\d+)?(px|em|rem|pt|%)$/i.test(raw)) return raw;
        return '';
    }

    function applyInsertFormats(htmlText, formats) {
        if (!formats || typeof formats !== 'object') return htmlText;
        let inner = htmlText;

        if (formats.bold) inner = `<strong>${inner}</strong>`;
        if (formats.italic) inner = `<em>${inner}</em>`;
        if (formats.underline) inner = `<u>${inner}</u>`;
        if (formats.strike || formats.strikethrough) inner = `<s>${inner}</s>`;

        const spanStyles = [];
        if (typeof formats.color === 'string' && formats.color.trim()) {
            spanStyles.push(`color:${escapeHtml(formats.color.trim())}`);
        }
        if (typeof formats.background === 'string' && formats.background.trim()) {
            spanStyles.push(`background-color:${escapeHtml(formats.background.trim())}`);
        }
        if (typeof formats.font === 'string' && formats.font.trim()) {
            spanStyles.push(`font-family:${escapeHtml(formats.font.trim())}`);
        }
        const size = toCssSize(formats.size);
        if (size) spanStyles.push(`font-size:${escapeHtml(size)}`);
        if (spanStyles.length) {
            inner = `<span style="${spanStyles.join(';')}">${inner}</span>`;
        }

        if (formats.code) {
            inner = `<code>${inner}</code>`;
        }

        if (typeof formats.link === 'string' && formats.link.trim()) {
            inner = `<a href="${escapeHtml(formats.link.trim())}">${inner}</a>`;
        }

        return inner;
    }

    function placeTinyMCECaret(editor, root, preferEnd = false) {
        if (!editor || !root || !root.ownerDocument) return false;

        const doc = root.ownerDocument;
        const body = (typeof editor.getBody === 'function' && editor.getBody()) ? editor.getBody() : root;
        const targetNode = preferEnd ? (body.lastChild || body) : (body.firstChild || body);

        try {
            if (editor.selection && typeof editor.selection.setCursorLocation === 'function') {
                const offset = (targetNode && targetNode.nodeType === Node.TEXT_NODE)
                    ? (preferEnd ? String(targetNode.nodeValue || '').length : 0)
                    : 0;
                editor.selection.setCursorLocation(targetNode, offset);
                return true;
            }
        } catch (_) {}

        try {
            const selection = doc.getSelection ? doc.getSelection() : null;
            if (!selection) return false;

            const range = doc.createRange();
            if (targetNode && targetNode.nodeType === Node.TEXT_NODE) {
                const offset = preferEnd ? String(targetNode.nodeValue || '').length : 0;
                range.setStart(targetNode, offset);
            } else {
                range.selectNodeContents(body);
                range.collapse(!preferEnd);
            }
            selection.removeAllRanges();
            selection.addRange(range);
            return true;
        } catch (_) {
            return false;
        }
    }

    const TinyMCEAdapter = {
        create(container, opts) {
            if (!container || typeof window.tinymce === 'undefined' || !window.tinymce) return null;

            try {
                container.setAttribute('data-extal-editor', 'tinymce');
                container.classList.add('editor-surface');
                container.classList.add('editor-host');
            } catch (_) {}

            const adapter = {
                isTinyMCE: true,
                root: container,
                container,
                scrollingContainer: container,
                __editor: null,
                __ready: false,
                __pendingHtml: null,
                __lastLoadedHtml: '',
                __lastRange: null,
                __handlers: Object.create(null),
                on(eventName, handler) {
                    if (!this.__handlers[eventName]) this.__handlers[eventName] = [];
                    this.__handlers[eventName].push(handler);
                    if (this.__editor) bindEditorEvent(this.__editor, eventName, handler, this);
                },
                off(eventName, handler) {
                    const list = this.__handlers[eventName];
                    if (!list) return;
                    const index = list.indexOf(handler);
                    if (index >= 0) list.splice(index, 1);
                },
                emit(eventName, ...args) {
                    (this.__handlers[eventName] || []).forEach((handler) => {
                        try { handler(...args); } catch (error) { console.warn('TinyMCE adapter handler failed', error); }
                    });
                },
                focus() {
                    try { this.__editor && this.__editor.focus(); } catch (_) {}
                    try { this.root && this.root.focus && this.root.focus(); } catch (_) {}
                    try {
                        const domSelection = this.root && this.root.ownerDocument ? this.root.ownerDocument.getSelection() : null;
                        const hasActiveSelection = !!(
                            domSelection &&
                            domSelection.rangeCount &&
                            this.root &&
                            this.root.contains(domSelection.anchorNode) &&
                            this.root.contains(domSelection.focusNode)
                        );
                        if (!hasActiveSelection) {
                            const preferEnd = !!(this.__lastRange && Number.isInteger(this.__lastRange.index) && this.__lastRange.index > 0);
                            placeTinyMCECaret(this.__editor, this.root, preferEnd);
                        }
                    } catch (_) {}
                },
                blur() {
                    try { this.__editor && this.__editor.blur(); } catch (_) {}
                    try { this.root && this.root.blur && this.root.blur(); } catch (_) {}
                },
                enable(shouldEnable = true) {
                    const enabled = shouldEnable !== false;
                    try {
                        if (this.__editor && this.__editor.mode && typeof this.__editor.mode.set === 'function') {
                            this.__editor.mode.set(enabled ? 'design' : 'readonly');
                        }
                    } catch (_) {}
                    try {
                        if (this.root) this.root.contentEditable = enabled ? 'true' : 'false';
                    } catch (_) {}
                },
                disable() {
                    this.enable(false);
                },
                getLength() {
                    return Math.max(1, String(this.root && this.root.textContent || '').length + 1);
                },
                getContents() {
                    return [{ insert: this.getText(0) || '\n' }];
                },
                setText(text) {
                    const plain = String(text || '');
                    this.setContent(escapeHtml(plain).replace(/\n/g, '<br>'));
                },
                getText(index, length) {
                    const text = String(this.root && this.root.textContent || '');
                    const start = Math.max(0, Number(index) || 0);
                    const end = length == null
                        ? text.length
                        : Math.max(start, start + Math.max(0, Number(length) || 0));
                    return text.slice(start, end);
                },
                getSelection() {
                    let range = null;
                    try {
                        if (this.__editor && this.__editor.selection && typeof this.__editor.selection.getRng === 'function') {
                            range = this.__editor.selection.getRng();
                        }
                    } catch (_) {
                        range = null;
                    }
                    if (!range && this.root && this.root.ownerDocument) {
                        const selection = this.root.ownerDocument.getSelection ? this.root.ownerDocument.getSelection() : null;
                        if (selection && selection.rangeCount) {
                            range = selection.getRangeAt(0);
                        }
                    }
                    if (!range || !this.root || !this.root.contains(range.startContainer)) return this.__lastRange;
                    this.__lastRange = offsetsFromRange(this.root, range);
                    return this.__lastRange;
                },
                setSelection(index, length) {
                    const range = rangeFromOffsets(this.root, index, length);
                    if (range) {
                        this.__lastRange = { index: Math.max(0, Number(index) || 0), length: Math.max(0, Number(length) || 0) };
                        try {
                            if (this.__editor && this.__editor.selection && typeof this.__editor.selection.setRng === 'function') {
                                this.__editor.selection.setRng(range);
                                if (typeof this.__editor.focus === 'function') this.__editor.focus();
                            } else if (this.__editor) {
                                placeTinyMCECaret(this.__editor, this.root, Math.max(0, Number(index) || 0) > 0);
                            }
                        } catch (_) {}
                    }
                    return range;
                },
                getBounds(index) {
                    if (!this.root || !this.root.ownerDocument) return { left: 0, top: 0, height: 0, width: 0 };
                    const pos = Math.max(0, Number(index) || 0);
                    let range = null;
                    try {
                        if (this.__editor && this.__editor.selection && typeof this.__editor.selection.getRng === 'function') {
                            range = this.__editor.selection.getRng();
                        }
                    } catch (_) {}
                    if (!range || !this.root.contains(range.startContainer)) {
                        range = rangeFromOffsets(this.root, pos, 0);
                    }
                    if (!range) return { left: 0, top: 0, height: 0, width: 0 };
                    const rect = range.getBoundingClientRect ? range.getBoundingClientRect() : null;
                    const rootRect = this.root.getBoundingClientRect ? this.root.getBoundingClientRect() : { left: 0, top: 0 };
                    const style = this.root.ownerDocument.defaultView ? this.root.ownerDocument.defaultView.getComputedStyle(this.root) : null;
                    const lineHeight = style ? parseFloat(style.lineHeight || '0') : 0;
                    const height = rect && Number.isFinite(rect.height) && rect.height > 0 ? rect.height : (Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : 20);
                    return {
                        left: rect ? rect.left - rootRect.left : 0,
                        top: rect ? rect.top - rootRect.top : 0,
                        width: rect && Number.isFinite(rect.width) ? rect.width : 0,
                        height
                    };
                },
                getLeaf(index) {
                    if (!this.root || !this.root.ownerDocument) return [null, 0];
                    const pos = Math.max(0, Number(index) || 0);
                    let range = null;
                    try {
                        if (this.__editor && this.__editor.selection && typeof this.__editor.selection.getRng === 'function') {
                            range = this.__editor.selection.getRng();
                        }
                    } catch (_) {}
                    if (!range || !this.root.contains(range.startContainer)) {
                        range = rangeFromOffsets(this.root, pos, 0);
                    }
                    if (!range) return [null, 0];
                    const node = range.startContainer;
                    const domNode = node && node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
                    return [{ domNode: domNode || this.root }, range.startOffset || 0];
                },
                getFormat() {
                    const root = this.root;
                    if (!root || !root.ownerDocument) return {};
                    const element = getSelectedElement(root) || root;
                    const styles = root.ownerDocument.defaultView ? root.ownerDocument.defaultView.getComputedStyle(element) : null;
                    const formats = {};
                    try { formats.bold = !!root.ownerDocument.queryCommandState('bold'); } catch (_) {}
                    try { formats.italic = !!root.ownerDocument.queryCommandState('italic'); } catch (_) {}
                    try { formats.underline = !!root.ownerDocument.queryCommandState('underline'); } catch (_) {}
                    try { formats.strike = !!root.ownerDocument.queryCommandState('strikeThrough'); } catch (_) {}
                    if (styles) {
                        const font = matchToolbarFontValue(styles.fontFamily);
                        if (font) formats.font = font;
                        const size = parseInt(String(styles.fontSize || '').replace(/px$/i, ''), 10);
                        if (Number.isFinite(size)) formats.size = `${size}px`;
                        if (styles.color) formats.color = styles.color;
                        if (styles.backgroundColor) formats.background = styles.backgroundColor;
                        if (styles.textAlign) formats.align = styles.textAlign;
                    }
                    const block = element.closest ? element.closest('h1,h2,h3,h4,h5,h6,blockquote,ol,ul,p,div') : null;
                    if (block) {
                        const tag = String(block.tagName || '').toLowerCase();
                        if (/^h[1-6]$/.test(tag)) formats.header = Number(tag.substring(1));
                        if (tag === 'blockquote') formats.blockquote = true;
                        if (tag === 'ol') formats.list = 'ordered';
                        if (tag === 'ul') formats.list = 'bullet';
                    }
                    const link = element.closest ? element.closest('a[href]') : null;
                    if (link) formats.link = link.getAttribute('href') || '';
                    return formats;
                },
                _exec(command, value) {
                    return execCommand(this.__editor, command, value);
                },
                format(name, value) {
                    const key = String(name || '').toLowerCase();
                    let changed = false;
                    if (key === 'list') {
                        changed = this._exec(value === 'ordered' ? 'InsertOrderedList' : 'InsertUnorderedList', null);
                    } else if (key === 'header') {
                        const level = Math.min(6, Math.max(1, Number(value) || 1));
                        changed = this._exec('FormatBlock', `h${level}`);
                    } else if (key === 'align') {
                        const command = {
                            left: 'JustifyLeft',
                            center: 'JustifyCenter',
                            right: 'JustifyRight',
                            justify: 'JustifyFull'
                        }[String(value || '').toLowerCase()] || 'JustifyLeft';
                        changed = this._exec(command, null);
                    } else if (key === 'font') {
                        changed = this._exec('FontName', value);
                    } else if (key === 'size') {
                        changed = this._exec('FontSize', value);
                    } else if (key === 'color') {
                        changed = this._exec('ForeColor', value);
                    } else if (key === 'background') {
                        changed = this._exec('HiliteColor', value);
                    } else if (key === 'bold') {
                        changed = this._exec('Bold', null);
                    } else if (key === 'italic') {
                        changed = this._exec('Italic', null);
                    } else if (key === 'underline') {
                        changed = this._exec('Underline', null);
                    } else if (key === 'strike' || key === 'strikethrough') {
                        changed = this._exec('StrikeThrough', null);
                    } else if (key === 'blockquote') {
                        changed = this._exec('FormatBlock', 'blockquote');
                    } else if (key === 'code') {
                        changed = this._exec('FormatBlock', 'pre');
                    } else {
                        changed = false;
                    }
                    if (changed) this.emit('text-change', null, null, 'user');
                    return changed;
                },
                formatText(index, length, name, value) {
                    if (name && typeof name === 'object' && !Array.isArray(name)) {
                        const formats = name;
                        const selection = this.getSelection();
                        const start = Number.isInteger(index) ? index : (selection && Number.isInteger(selection.index) ? selection.index : 0);
                        const rangeLength = Number.isInteger(length) ? length : (selection && Number.isInteger(selection.length) ? selection.length : 0);
                        if (rangeLength > 0) this.setSelection(start, rangeLength);
                        Object.entries(formats).forEach(([formatName, formatValue]) => {
                            this.format(formatName, formatValue);
                        });
                        return true;
                    }
                    this.setSelection(index, length);
                    return this.format(name, value);
                },
                formatLine(index, length, name, value) {
                    const key = String(name || '').toLowerCase();
                    this.setSelection(index, length);
                    let changed = false;
                    if (key === 'list') {
                        changed = !value ? this._exec('RemoveList', null) : this._exec(value === 'ordered' ? 'InsertOrderedList' : 'InsertUnorderedList', null);
                        if (changed) this.emit('text-change', null, null, 'user');
                    } else if (key === 'indent') {
                        const level = Math.max(0, Number(value) || 0);
                        if (!level) {
                            changed = this._exec('Outdent', null);
                        } else {
                            changed = true;
                            for (let i = 0; i < level; i += 1) this._exec('Indent', null);
                        }
                        if (changed) this.emit('text-change', null, null, 'user');
                    } else if (key === 'align') {
                        changed = this.format('align', value);
                    } else if (key === 'header') {
                        changed = this.format('header', value);
                    } else if (key === 'blockquote') {
                        changed = this.format('blockquote', value);
                    } else {
                        changed = this.format(key, value);
                    }
                    return changed;
                },
                deleteText(index, length) {
                    const range = rangeFromOffsets(this.root, index, length);
                    if (!range) return;
                    try { range.deleteContents(); } catch (_) {}
                    this.__lastRange = { index: Math.max(0, Number(index) || 0), length: 0 };
                    this.emit('text-change', null, null, 'user');
                },
                insertText(index, text, formatsOrSource, source) {
                    const plain = String(text || '');
                    const formats = (formatsOrSource && typeof formatsOrSource === 'object' && !Array.isArray(formatsOrSource))
                        ? formatsOrSource
                        : null;
                    const htmlText = escapeHtml(plain).replace(/\n/g, '<br>');
                    const html = applyInsertFormats(htmlText, formats);

                    this.setSelection(index, 0);
                    if (this.__editor && typeof this.__editor.insertContent === 'function') {
                        this.__editor.insertContent(html);
                    } else {
                        execCommand(null, 'insertHTML', html);
                    }
                    this.__lastRange = { index: Math.max(0, Number(index) || 0) + plain.length, length: 0 };
                    this.emit('text-change', null, null, 'user');
                },
                insertEmbed(index, type, value) {
                    this.setSelection(index, 0);
                    let html = '';
                    if (type === 'image') {
                        html = `<img src="${escapeHtml(String(value || ''))}" />`;
                    } else {
                        html = String(value || '');
                    }
                    if (this.__editor && typeof this.__editor.insertContent === 'function') {
                        this.__editor.insertContent(html);
                    } else {
                        execCommand(null, 'insertHTML', html);
                    }
                    this.emit('text-change', null, null, 'user');
                    if (type === 'table') {
                        const tables = Array.from(this.root.querySelectorAll('table'));
                        return tables[tables.length - 1] || null;
                    }
                    return null;
                },
                setContents(contents) {
                    if (!Array.isArray(contents)) {
                        this.setContent(String(contents || ''));
                        return;
                    }
                    const text = contents
                        .filter((item) => item && typeof item.insert === 'string')
                        .map((item) => item.insert)
                        .join('');
                    this.setContent(text === '\n' ? '' : escapeHtml(text).replace(/\n/g, '<br>'));
                },
                setContent(html) {
                    const next = String(html || '');
                    this.__lastLoadedHtml = next;
                    if (this.__editor && typeof this.__editor.setContent === 'function') {
                        try { this.__editor.setContent(next); } catch (_) { this.root.innerHTML = next; }
                    } else {
                        this.root.innerHTML = next;
                    }
                    this.emit('text-change', null, null, 'api');
                },
                getContent() {
                    return this.root ? this.root.innerHTML : '';
                },
                clipboard: {
                    dangerouslyPasteHTML: (html) => {
                        adapter.setContent(html);
                    }
                },
                history: {
                    undo: () => {
                        if (adapter.__editor && adapter.__editor.undoManager && typeof adapter.__editor.undoManager.undo === 'function') {
                            adapter.__editor.undoManager.undo();
                            return;
                        }
                        execCommand(null, 'undo', null);
                    },
                    redo: () => {
                        if (adapter.__editor && adapter.__editor.undoManager && typeof adapter.__editor.undoManager.redo === 'function') {
                            adapter.__editor.undoManager.redo();
                            return;
                        }
                        execCommand(null, 'redo', null);
                    }
                },
                undo() {
                    this.history.undo();
                },
                redo() {
                    this.history.redo();
                },
                undoManager: {
                    undo: () => adapter.history.undo(),
                    redo: () => adapter.history.redo()
                }
            };

            adapter.__selectionRefreshTimer = null;
            adapter.refreshSelectionState = function() {
                const range = this.getSelection();
                if (range && Number.isInteger(range.index) && Number.isInteger(range.length)) {
                    this.__lastRange = { index: range.index, length: range.length };
                    this.emit('selection-change', range);
                }
            };
            adapter.scheduleSelectionRefresh = function(delayMs = 0) {
                if (this.__selectionRefreshTimer) clearTimeout(this.__selectionRefreshTimer);
                this.__selectionRefreshTimer = setTimeout(() => {
                    this.__selectionRefreshTimer = null;
                    try { this.refreshSelectionState(); } catch (_) {}
                }, Math.max(0, Number(delayMs) || 0));
            };

            function bindEditorEvent(editor, eventName, handler, state) {
                if (!editor || !handler) return;
                const emitSelection = () => {
                    const range = state.getSelection();
                    if (range && Number.isInteger(range.index) && Number.isInteger(range.length)) {
                        handler(range);
                    }
                };
                const emitText = (source) => handler(null, null, source || 'user');
                if (eventName === 'selection-change') {
                    editor.on('SelectionChange', emitSelection);
                    editor.on('NodeChange', emitSelection);
                    editor.on('click', emitSelection);
                    editor.on('keyup', emitSelection);
                    editor.on('input', emitSelection);
                    return;
                }
                if (eventName === 'text-change') {
                    editor.on('input', () => emitText('user'));
                    editor.on('change', () => emitText('user'));
                    editor.on('Change', () => emitText('user'));
                    editor.on('ExecCommand', () => emitText('user'));
                    editor.on('Undo', () => emitText('user'));
                    editor.on('Redo', () => emitText('user'));
                    editor.on('SetContent', () => emitText('api'));
                    return;
                }
                editor.on(eventName, handler);
            }

            if (container.ownerDocument) {
                try {
                    container.ownerDocument.addEventListener('selectionchange', () => {
                        try {
                            if (!adapter.__editor) return;
                            adapter.scheduleSelectionRefresh(0);
                        } catch (_) {}
                    });
                } catch (_) {}
            }
            if (container.ownerDocument) {
                try {
                    container.ownerDocument.addEventListener('keyup', (event) => {
                        try {
                            if (!adapter.__editor || !container.contains(event.target)) return;
                            const key = String(event.key || '');
                            if (key === 'Enter' || key === 'Backspace' || key === 'Delete' || key === 'Tab' || key.startsWith('Arrow')) {
                                adapter.scheduleSelectionRefresh(0);
                            }
                        } catch (_) {}
                    }, true);
                    container.ownerDocument.addEventListener('keydown', (event) => {
                        try {
                            if (!adapter.__editor || !container.contains(event.target)) return;
                            const key = String(event.key || '');
                            if (key === 'Enter' || key === 'Backspace' || key === 'Delete' || key === 'Tab' || key.startsWith('Arrow')) {
                                adapter.scheduleSelectionRefresh(0);
                            }
                        } catch (_) {}
                    }, true);
                } catch (_) {}
            }

            const initOptions = Object.assign({}, opts || {}, {
                target: container,
                inline: true,
                license_key: (opts && typeof opts.license_key === 'string' && opts.license_key.trim()) ? opts.license_key : 'gpl',
                menubar: false,
                toolbar: false,
                statusbar: false,
                branding: false,
                promotion: false,
                resize: false,
                convert_urls: false,
                relative_urls: false,
                remove_script_host: false,
                plugins: 'lists link image table code',
                valid_elements: '*[*]',
                extended_valid_elements: 'table[contenteditable|style|class],tbody,thead,tfoot,tr[style],td[contenteditable|tabindex|role|style|colspan|rowspan],th[contenteditable|tabindex|role|style|colspan|rowspan],img[src|alt|title|style|data-shape-image|data-shape-resize-mode|data-shape-stroke-color],a[href|target|rel|class],span[style],p[style],div[style],br',
                setup: (editor) => {
                    adapter.__editor = editor;
                    adapter.__ready = true;
                    try {
                        container.setAttribute('data-extal-editor', 'tinymce');
                        container.classList.add('editor-surface');
                        container.classList.add('editor-host');
                    } catch (_) {}
                    editor.on('init', () => {
                        applyEditorViewportStyles(editor, container);
                        if (adapter.__pendingHtml != null) {
                            try { editor.setContent(adapter.__pendingHtml); } catch (_) { container.innerHTML = adapter.__pendingHtml; }
                            adapter.__pendingHtml = null;
                        }
                    });
                    editor.on('keydown', (event) => {
                        try {
                            if (!opts || !opts.captureTabKey) return;
                            if (event.defaultPrevented) return;
                            if (String(event.key || '') !== 'Tab') return;
                            if (event.ctrlKey || event.metaKey || event.altKey) return;
                            if (window._entityAssistState && window._entityAssistState.editor) return;
                            if (typeof window.getTableCellFromNode === 'function' && window.getTableCellFromNode(event.target)) return;

                            event.preventDefault();
                            event.stopPropagation();

                            if (event.shiftKey) {
                                editor.execCommand('Outdent');
                                return;
                            }

                            editor.insertContent('&nbsp;&nbsp;&nbsp;&nbsp;');
                        } catch (_) {}
                    });
                    editor.on('SetContent', () => applyEditorViewportStyles(editor, container));
                    editor.on('SkinLoaded', () => applyEditorViewportStyles(editor, container));
                }
            });

            const initResult = window.tinymce.init(initOptions);
            if (initResult && typeof initResult.then === 'function') {
                initResult.catch((error) => console.warn('TinyMCE init failed', error));
            }

            return adapter;
        }
    };

    window.TinyMCEAdapter = TinyMCEAdapter;
})(window);
