// Settings UI System
// Provides modal for theme customization

const TOPIC_TEMPLATE_CUSTOM_STORAGE_KEY = 'extal.topicTemplates.custom.v1';
const TOPIC_TEMPLATE_DEFAULT_STORAGE_KEY = 'extal.topicTemplates.default.v1';
const CHARACTER_TEMPLATE_CUSTOM_STORAGE_KEY = 'extal.characterTemplates.custom.v1';
const CHARACTER_TEMPLATE_DEFAULT_STORAGE_KEY = 'extal.characterTemplates.default.v1';

const BUILT_IN_TOPIC_TEMPLATES = [
    {
        id: 'blank',
        name: 'Blank Topic',
        description: 'Starts with an empty topic body.',
        content: ''
    },
    {
        id: 'dragonblood-3cell',
        name: 'Dragonblood 3-Cell',
        description: 'Three-column encyclopedia layout: linked items, article body, and related notes.',
        content: `<p><strong style="font-size:20px;">Dragonblood Encyclopedia • Topic Frame</strong></p>
<p><em>Template Card: {{TOPIC_NAME}}</em></p>
<table style="border-collapse:collapse;table-layout:fixed;width:100%;border:2px solid #c8a24a;background:#1a1d22;">
  <tbody>
    <tr>
      <td contenteditable="true" tabindex="0" role="textbox" style="width:23%;vertical-align:top;border:1px solid #6d5530;background:#222831;padding:10px;">
        <h3 style="margin:0 0 8px 0;color:#f0d78a;">Linked Items</h3>
        <p><strong>Topics</strong></p>
        <ul>
          <li>Primary Parent Topic</li>
          <li>Supporting Subtopic</li>
        </ul>
        <p><strong>Characters</strong></p>
        <ul>
          <li>Lead Character</li>
          <li>Supporting Character</li>
        </ul>
        <p><strong>Timeline</strong></p>
        <ul>
          <li>Anchor Event</li>
        </ul>
        <p><strong>Markers</strong></p>
        <ul>
          <li>Map Marker</li>
        </ul>
      </td>
      <td contenteditable="true" tabindex="0" role="textbox" style="width:54%;vertical-align:top;border:1px solid #6d5530;background:#1f242b;padding:12px;">
        <h1 style="margin-top:0;color:#f5e7b2;">{{TOPIC_NAME}}</h1>
        <p><strong>Summary:</strong> Add the core concept for this topic and why it matters.</p>
        <h2>Current Story State</h2>
        <p>Describe the current status, conflicts, and active arc hooks.</p>
        <h2>Operational Hooks</h2>
        <ul>
          <li>Hook 1 for gameplay or narrative progression.</li>
          <li>Hook 2 tied to a character or location.</li>
          <li>Hook 3 that points to the next linked topic/event.</li>
        </ul>
      </td>
      <td contenteditable="true" tabindex="0" role="textbox" style="width:23%;vertical-align:top;border:1px solid #6d5530;background:#222831;padding:10px;">
        <h3 style="margin:0 0 8px 0;color:#f0d78a;">Related Elements</h3>
        <p><strong>Character:</strong> One-line role summary.</p>
        <p><strong>Event:</strong> One-line timeline impact.</p>
        <p><strong>Map Zone:</strong> One-line location context.</p>
        <p><strong>Template Note:</strong> Replace bullets with live links and concise references.</p>
      </td>
    </tr>
  </tbody>
</table>
<p><br></p>`
    }
];

const CHARACTER_TEMPLATE_FIELD_KEYS = [
    'race',
    'age',
    'gender',
    'class',
    'personality',
    'background',
    'motivations',
    'bio',
    'notes'
];

const BUILT_IN_CHARACTER_TEMPLATES = [
    {
        id: 'blank-character',
        name: 'Blank Character',
        description: 'Starts with empty character profile and biography fields.',
        fields: {
            race: '',
            age: '',
            gender: '',
            class: '',
            personality: '',
            background: '',
            motivations: '',
            bio: '',
            notes: ''
        }
    },
    {
        id: 'lore-biography',
        name: 'Lore Biography',
        description: 'Structured profile for character lore, hooks, and references.',
        fields: {
            race: '',
            age: '',
            gender: '',
            class: '',
            personality: 'Temperament, strengths, flaws, and how they handle pressure.',
            background: 'Origin, formative events, and ties to major world factions.',
            motivations: 'Primary goal, current obstacle, and what they fear losing.',
            bio: `<h1>{{CHARACTER_NAME}}</h1>
<p><strong>Role:</strong> Add this character's narrative function in one sentence.</p>
<h2>Biography</h2>
<p>Write a concise backstory with major turning points and current status.</p>
<h2>Current Arc</h2>
<ul>
  <li>Active objective tied to a topic/event.</li>
  <li>Immediate conflict or rival pressure.</li>
  <li>Next decision point that changes stakes.</li>
</ul>
<h2>Connections</h2>
<p>List linked topics, events, maps, and characters that define this biography.</p>`,
            notes: `<p><strong>Reference Notes for {{CHARACTER_NAME}}</strong></p>
<ul>
  <li>Voice and speech style cues.</li>
  <li>Visual markers, gear, or motifs.</li>
  <li>Open questions to resolve in future sessions.</li>
</ul>`
        }
    }
];

function escapeTemplateHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function safeLocalStorageGet(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : raw;
    } catch (_) {
        return fallback;
    }
}

function safeLocalStorageSet(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (_) {}
}

function normalizeTemplateId(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return `tpl-${Date.now().toString(36)}`;
    const cleaned = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/(^-|-$)/g, '');
    return cleaned || `tpl-${Date.now().toString(36)}`;
}

function loadCustomTopicTemplates() {
    const raw = safeLocalStorageGet(TOPIC_TEMPLATE_CUSTOM_STORAGE_KEY, '[]');
    let parsed = [];
    try {
        parsed = JSON.parse(raw);
    } catch (_) {
        parsed = [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
        .filter((tpl) => tpl && typeof tpl === 'object')
        .map((tpl, idx) => ({
            id: normalizeTemplateId(tpl.id || `custom-${idx + 1}`),
            name: String(tpl.name || `Custom Template ${idx + 1}`),
            description: String(tpl.description || 'Custom topic template.'),
            content: String(tpl.content || ''),
            kind: 'custom'
        }));
}

function saveCustomTopicTemplates(templates) {
    const normalized = (Array.isArray(templates) ? templates : []).map((tpl) => ({
        id: normalizeTemplateId(tpl.id),
        name: String(tpl.name || 'Custom Template'),
        description: String(tpl.description || 'Custom topic template.'),
        content: String(tpl.content || '')
    }));
    safeLocalStorageSet(TOPIC_TEMPLATE_CUSTOM_STORAGE_KEY, JSON.stringify(normalized));
}

function getAllTopicTemplates() {
    const builtIn = BUILT_IN_TOPIC_TEMPLATES.map((tpl) => ({ ...tpl, kind: 'built-in' }));
    return [...builtIn, ...loadCustomTopicTemplates()];
}

function getTopicTemplateById(templateId) {
    const target = String(templateId || '').trim();
    if (!target) return null;
    return getAllTopicTemplates().find((tpl) => tpl.id === target) || null;
}

function getDefaultTopicTemplateId() {
    const all = getAllTopicTemplates();
    const saved = safeLocalStorageGet(TOPIC_TEMPLATE_DEFAULT_STORAGE_KEY, 'dragonblood-3cell');
    if (all.some((tpl) => tpl.id === saved)) return saved;
    const fallback = all.some((tpl) => tpl.id === 'dragonblood-3cell') ? 'dragonblood-3cell' : (all[0] ? all[0].id : 'blank');
    safeLocalStorageSet(TOPIC_TEMPLATE_DEFAULT_STORAGE_KEY, fallback);
    return fallback;
}

function setDefaultTopicTemplateId(templateId) {
    const target = String(templateId || '').trim();
    const all = getAllTopicTemplates();
    if (!all.some((tpl) => tpl.id === target)) return false;
    safeLocalStorageSet(TOPIC_TEMPLATE_DEFAULT_STORAGE_KEY, target);
    return true;
}

function applyTopicTemplatePlaceholders(content, topicName) {
    const name = escapeTemplateHtml(topicName || 'Untitled Topic');
    return String(content || '').replace(/\{\{\s*TOPIC_NAME\s*\}\}/g, name);
}

function getNewTopicTemplateContent(topicName, fallbackContent = '') {
    const tpl = getTopicTemplateById(getDefaultTopicTemplateId());
    if (!tpl) return String(fallbackContent || '');
    return applyTopicTemplatePlaceholders(tpl.content, topicName);
}

window.getNewTopicTemplateContent = getNewTopicTemplateContent;

function populateTopicTemplateSettingsUI() {
    const selector = document.getElementById('topic-template-default-selector');
    const descriptionEl = document.getElementById('topic-template-description');
    const deleteBtn = document.getElementById('btn-delete-topic-template');
    if (!selector) return;

    const allTemplates = getAllTopicTemplates();
    const currentDefaultId = getDefaultTopicTemplateId();

    selector.innerHTML = '';
    allTemplates.forEach((tpl) => {
        const option = document.createElement('option');
        option.value = tpl.id;
        option.textContent = `${tpl.kind === 'custom' ? 'Custom' : 'Built-in'}: ${tpl.name}`;
        option.selected = tpl.id === currentDefaultId;
        selector.appendChild(option);
    });

    if (!selector.value && allTemplates.length > 0) {
        selector.value = allTemplates[0].id;
        setDefaultTopicTemplateId(selector.value);
    }

    const selected = getTopicTemplateById(selector.value);
    if (descriptionEl) {
        descriptionEl.textContent = selected ? selected.description : 'No template selected.';
    }
    if (deleteBtn) {
        deleteBtn.disabled = !(selected && selected.kind === 'custom');
    }
}

function getCurrentTopicContentFromEditorState() {
    if (typeof UIState === 'undefined' || !UIState || UIState.selectedItemType !== 'topic' || !UIState.selectedItemId) return null;
    if (typeof worldData === 'undefined' || !worldData || !worldData.topics) return null;
    const topic = worldData.topics[UIState.selectedItemId];
    if (!topic) return null;

    if (typeof getEd === 'function') {
        const ed = getEd();
        if (ed && ed.root && typeof ed.root.innerHTML === 'string') {
            return String(ed.root.innerHTML || '');
        }
    }
    return String(topic.content || '');
}

function applySelectedTopicTemplateToCurrentTopic() {
    if (typeof UIState === 'undefined' || !UIState || UIState.selectedItemType !== 'topic' || !UIState.selectedItemId) {
        alert('Select a topic first, then apply a template.');
        return;
    }
    if (typeof worldData === 'undefined' || !worldData || !worldData.topics) return;

    const selector = document.getElementById('topic-template-default-selector');
    const templateId = selector ? selector.value : getDefaultTopicTemplateId();
    const template = getTopicTemplateById(templateId);
    if (!template) {
        alert('Selected template was not found.');
        return;
    }

    const topic = worldData.topics[UIState.selectedItemId];
    if (!topic) return;

    if (!confirm(`Apply template "${template.name}" to "${topic.name || 'Untitled Topic'}"? This replaces current topic content.`)) {
        return;
    }

    const content = applyTopicTemplatePlaceholders(template.content, topic.name || 'Untitled Topic');
    topic.content = content;

    if (typeof loadEditorContent === 'function') loadEditorContent(content);
    if (typeof syncEditorToData === 'function') syncEditorToData();
    if (typeof scheduleVaultSave === 'function') scheduleVaultSave();
}

function saveCurrentTopicAsCustomTemplate() {
    const content = getCurrentTopicContentFromEditorState();
    if (content == null) {
        alert('Select a topic first. Custom topic templates are saved from topic editor content.');
        return;
    }

    const askName = (onName) => {
        if (typeof openInputModal === 'function') {
            openInputModal('Enter template name', (name) => onName(String(name || '').trim()));
            return;
        }
        const raw = window.prompt('Enter template name:', '');
        onName(String(raw || '').trim());
    };

    askName((templateName) => {
        if (!templateName) return;

        const templates = loadCustomTopicTemplates();
        const baseId = normalizeTemplateId(templateName);
        let templateId = baseId;
        let suffix = 2;
        const existingIds = new Set(getAllTopicTemplates().map((tpl) => tpl.id));
        while (existingIds.has(templateId)) {
            templateId = `${baseId}-${suffix}`;
            suffix += 1;
        }

        templates.push({
            id: templateId,
            name: templateName,
            description: `Custom template saved on ${new Date().toLocaleDateString()}.`,
            content,
            kind: 'custom'
        });
        saveCustomTopicTemplates(templates);
        setDefaultTopicTemplateId(templateId);
        populateTopicTemplateSettingsUI();
        alert(`Custom template "${templateName}" saved.`);
    });
}

function deleteSelectedCustomTopicTemplate() {
    const selector = document.getElementById('topic-template-default-selector');
    if (!selector) return;
    const selected = getTopicTemplateById(selector.value);
    if (!selected || selected.kind !== 'custom') {
        alert('Select a custom template to delete.');
        return;
    }

    if (!confirm(`Delete custom template "${selected.name}"?`)) return;
    const currentDefaultId = getDefaultTopicTemplateId();
    const remaining = loadCustomTopicTemplates().filter((tpl) => tpl.id !== selected.id);
    saveCustomTopicTemplates(remaining);

    if (currentDefaultId === selected.id) {
        const available = getAllTopicTemplates();
        const preferredFallback = available.some((tpl) => tpl.id === 'dragonblood-3cell')
            ? 'dragonblood-3cell'
            : (available[0] ? available[0].id : 'blank');
        setDefaultTopicTemplateId(preferredFallback);
    }
    populateTopicTemplateSettingsUI();
}

function normalizeCharacterTemplateFields(fields) {
    const source = fields && typeof fields === 'object' ? fields : {};
    const normalized = {};
    CHARACTER_TEMPLATE_FIELD_KEYS.forEach((key) => {
        normalized[key] = String(source[key] || '');
    });
    return normalized;
}

function loadCustomCharacterTemplates() {
    const raw = safeLocalStorageGet(CHARACTER_TEMPLATE_CUSTOM_STORAGE_KEY, '[]');
    let parsed = [];
    try {
        parsed = JSON.parse(raw);
    } catch (_) {
        parsed = [];
    }
    if (!Array.isArray(parsed)) return [];
    return parsed
        .filter((tpl) => tpl && typeof tpl === 'object')
        .map((tpl, idx) => ({
            id: normalizeTemplateId(tpl.id || `character-custom-${idx + 1}`),
            name: String(tpl.name || `Character Template ${idx + 1}`),
            description: String(tpl.description || 'Custom character biography template.'),
            fields: normalizeCharacterTemplateFields(tpl.fields),
            kind: 'custom'
        }));
}

function saveCustomCharacterTemplates(templates) {
    const normalized = (Array.isArray(templates) ? templates : []).map((tpl) => ({
        id: normalizeTemplateId(tpl.id),
        name: String(tpl.name || 'Custom Character Template'),
        description: String(tpl.description || 'Custom character biography template.'),
        fields: normalizeCharacterTemplateFields(tpl.fields)
    }));
    safeLocalStorageSet(CHARACTER_TEMPLATE_CUSTOM_STORAGE_KEY, JSON.stringify(normalized));
}

function getAllCharacterTemplates() {
    const builtIn = BUILT_IN_CHARACTER_TEMPLATES.map((tpl) => ({
        ...tpl,
        fields: normalizeCharacterTemplateFields(tpl.fields),
        kind: 'built-in'
    }));
    return [...builtIn, ...loadCustomCharacterTemplates()];
}

function getCharacterTemplateById(templateId) {
    const target = String(templateId || '').trim();
    if (!target) return null;
    return getAllCharacterTemplates().find((tpl) => tpl.id === target) || null;
}

function getDefaultCharacterTemplateId() {
    const all = getAllCharacterTemplates();
    const saved = safeLocalStorageGet(CHARACTER_TEMPLATE_DEFAULT_STORAGE_KEY, 'lore-biography');
    if (all.some((tpl) => tpl.id === saved)) return saved;
    const fallback = all.some((tpl) => tpl.id === 'lore-biography') ? 'lore-biography' : (all[0] ? all[0].id : 'blank-character');
    safeLocalStorageSet(CHARACTER_TEMPLATE_DEFAULT_STORAGE_KEY, fallback);
    return fallback;
}

function setDefaultCharacterTemplateId(templateId) {
    const target = String(templateId || '').trim();
    const all = getAllCharacterTemplates();
    if (!all.some((tpl) => tpl.id === target)) return false;
    safeLocalStorageSet(CHARACTER_TEMPLATE_DEFAULT_STORAGE_KEY, target);
    return true;
}

function applyCharacterTemplatePlaceholders(value, characterName) {
    const safeName = escapeTemplateHtml(characterName || 'Unnamed Character');
    const firstName = safeName.split(/\s+/).filter(Boolean)[0] || safeName;
    return String(value || '')
        .replace(/\{\{\s*CHARACTER_NAME\s*\}\}/g, safeName)
        .replace(/\{\{\s*FIRST_NAME\s*\}\}/g, firstName);
}

function applyCharacterTemplateFieldPlaceholders(fields, characterName) {
    const normalized = normalizeCharacterTemplateFields(fields);
    const output = {};
    CHARACTER_TEMPLATE_FIELD_KEYS.forEach((key) => {
        output[key] = applyCharacterTemplatePlaceholders(normalized[key], characterName);
    });
    return output;
}

function getNewCharacterTemplateData(characterName, fallbackFields = {}) {
    const fallback = normalizeCharacterTemplateFields(fallbackFields);
    const template = getCharacterTemplateById(getDefaultCharacterTemplateId());
    if (!template) return fallback;
    const applied = applyCharacterTemplateFieldPlaceholders(template.fields, characterName);
    return { ...fallback, ...applied };
}

window.getNewCharacterTemplateData = getNewCharacterTemplateData;

function populateCharacterTemplateSettingsUI() {
    const selector = document.getElementById('character-template-default-selector');
    const descriptionEl = document.getElementById('character-template-description');
    const deleteBtn = document.getElementById('btn-delete-character-template');
    if (!selector) return;

    const allTemplates = getAllCharacterTemplates();
    const currentDefaultId = getDefaultCharacterTemplateId();

    selector.innerHTML = '';
    allTemplates.forEach((tpl) => {
        const option = document.createElement('option');
        option.value = tpl.id;
        option.textContent = `${tpl.kind === 'custom' ? 'Custom' : 'Built-in'}: ${tpl.name}`;
        option.selected = tpl.id === currentDefaultId;
        selector.appendChild(option);
    });

    if (!selector.value && allTemplates.length > 0) {
        selector.value = allTemplates[0].id;
        setDefaultCharacterTemplateId(selector.value);
    }

    const selected = getCharacterTemplateById(selector.value);
    if (descriptionEl) {
        descriptionEl.textContent = selected ? selected.description : 'No template selected.';
    }
    if (deleteBtn) {
        deleteBtn.disabled = !(selected && selected.kind === 'custom');
    }
}

function getCurrentCharacterTemplateSource() {
    if (typeof UIState === 'undefined' || !UIState || UIState.selectedItemType !== 'character' || !UIState.selectedItemId) return null;
    if (typeof worldData === 'undefined' || !worldData || !worldData.characters) return null;
    if (typeof syncEditorToData === 'function') syncEditorToData();
    const character = worldData.characters[UIState.selectedItemId];
    if (!character) return null;
    return {
        race: String(character.race || ''),
        age: String(character.age || ''),
        gender: String(character.gender || ''),
        class: String(character.class || ''),
        personality: String(character.personality || ''),
        background: String(character.background || ''),
        motivations: String(character.motivations || ''),
        bio: String(character.bio || ''),
        notes: String(character.notes || '')
    };
}

function applySelectedCharacterTemplateToCurrentCharacter() {
    if (typeof UIState === 'undefined' || !UIState || UIState.selectedItemType !== 'character' || !UIState.selectedItemId) {
        alert('Select a character first, then apply a template.');
        return;
    }
    if (typeof worldData === 'undefined' || !worldData || !worldData.characters) return;

    const selector = document.getElementById('character-template-default-selector');
    const templateId = selector ? selector.value : getDefaultCharacterTemplateId();
    const template = getCharacterTemplateById(templateId);
    if (!template) {
        alert('Selected template was not found.');
        return;
    }

    const character = worldData.characters[UIState.selectedItemId];
    if (!character) return;

    if (!confirm(`Apply template "${template.name}" to "${character.name || 'Unnamed Character'}"? This replaces biography/profile text fields.`)) {
        return;
    }

    const fields = applyCharacterTemplateFieldPlaceholders(template.fields, character.name || 'Unnamed Character');
    character.race = fields.race;
    character.age = fields.age;
    character.gender = fields.gender;
    character.class = fields.class;
    character.personality = fields.personality;
    character.background = fields.background;
    character.motivations = fields.motivations;
    character.bio = fields.bio;
    character.notes = fields.notes;

    if (typeof loadCharacterMetadata === 'function') {
        loadCharacterMetadata(character);
    }
    if (UIState.activeCharTab === 'bio' && typeof loadEditorContent === 'function') {
        loadEditorContent(character.bio || '');
        window._bioEditorCharacterId = character.id;
    }
    if (typeof scheduleVaultSave === 'function') scheduleVaultSave();
}

function saveCurrentCharacterAsCustomTemplate() {
    const fields = getCurrentCharacterTemplateSource();
    if (fields == null) {
        alert('Select a character first. Custom character templates are saved from current character fields.');
        return;
    }

    const askName = (onName) => {
        if (typeof openInputModal === 'function') {
            openInputModal('Enter character template name', (name) => onName(String(name || '').trim()));
            return;
        }
        const raw = window.prompt('Enter character template name:', '');
        onName(String(raw || '').trim());
    };

    askName((templateName) => {
        if (!templateName) return;

        const templates = loadCustomCharacterTemplates();
        const baseId = normalizeTemplateId(templateName);
        let templateId = baseId;
        let suffix = 2;
        const existingIds = new Set(getAllCharacterTemplates().map((tpl) => tpl.id));
        while (existingIds.has(templateId)) {
            templateId = `${baseId}-${suffix}`;
            suffix += 1;
        }

        templates.push({
            id: templateId,
            name: templateName,
            description: `Custom character template saved on ${new Date().toLocaleDateString()}.`,
            fields,
            kind: 'custom'
        });
        saveCustomCharacterTemplates(templates);
        setDefaultCharacterTemplateId(templateId);
        populateCharacterTemplateSettingsUI();
        alert(`Custom character template "${templateName}" saved.`);
    });
}

function deleteSelectedCustomCharacterTemplate() {
    const selector = document.getElementById('character-template-default-selector');
    if (!selector) return;
    const selected = getCharacterTemplateById(selector.value);
    if (!selected || selected.kind !== 'custom') {
        alert('Select a custom character template to delete.');
        return;
    }

    if (!confirm(`Delete custom character template "${selected.name}"?`)) return;
    const currentDefaultId = getDefaultCharacterTemplateId();
    const remaining = loadCustomCharacterTemplates().filter((tpl) => tpl.id !== selected.id);
    saveCustomCharacterTemplates(remaining);

    if (currentDefaultId === selected.id) {
        const available = getAllCharacterTemplates();
        const preferredFallback = available.some((tpl) => tpl.id === 'lore-biography')
            ? 'lore-biography'
            : (available[0] ? available[0].id : 'blank-character');
        setDefaultCharacterTemplateId(preferredFallback);
    }
    populateCharacterTemplateSettingsUI();
}

function getFontFamilyString(fontName) {
    if (!fontName || fontName === 'System Default') {
        return '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif';
    }
    const fontMap = {
        'Inter': '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
        'Roboto': '"Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif',
        'Lora': '"Lora", "Times New Roman", serif',
        'Fira Sans': '"Fira Sans", "Segoe UI", "Helvetica Neue", sans-serif',
        'Source Sans 3': '"Source Sans 3", "Segoe UI", "Helvetica Neue", sans-serif',
        'Source Serif 4': '"Source Serif 4", "Times New Roman", serif',
        'Playfair Display': '"Playfair Display", "Times New Roman", serif',
        'Oswald': '"Oswald", "Segoe UI", "Helvetica Neue", sans-serif',
        'Bebas Neue': '"Bebas Neue", "Segoe UI", "Helvetica Neue", sans-serif',
        'Rubik': '"Rubik", "Segoe UI", "Helvetica Neue", sans-serif',
        'JetBrains Mono': '"JetBrains Mono", monospace'
    };
    if (fontMap[fontName]) return fontMap[fontName];
    // Fallback for dynamically discovered fonts
    return `"${fontName}", -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue", sans-serif`;
}

function normalizeFontKey(fontName) {
    return fontName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

function getFontKey(fontName) {
    const map = {
        'System Default': '',
        'Inter': 'inter',
        'Roboto': 'roboto',
        'Lora': 'lora',
        'Fira Sans': 'fira-sans',
        'Source Sans 3': 'source-sans-3',
        'Source Serif 4': 'source-serif-4',
        'Playfair Display': 'playfair-display',
        'Oswald': 'oswald',
        'Bebas Neue': 'bebas-neue',
        'Rubik': 'rubik',
        'JetBrains Mono': 'jetbrains-mono'
    };
    return map[fontName] || normalizeFontKey(fontName);
}
// Backward-compat alias (referenced by index.html inline scripts)
window.getQuillFontKey = getFontKey;

function isWriterEditor(editor) {
    return !!(
        editor
        && window.editor
        && editor === window.editor
        && document.body
        && document.body.classList
        && document.body.classList.contains('writing-mode')
    );
}

// Backward-compat alias (referenced by index.html inline scripts)
window.isWriterQuillEditor = isWriterEditor;

function applyBaseTypography(editor, fontName = null, sizePx = null) {
    if (!editor || !editor.root || !editor.root.style) return false;
    const writerEditor = isWriterEditor(editor);

    const resolvedFont = writerEditor
        ? 'System Default'
        : fontName == null
        ? (window.ThemeManager && typeof window.ThemeManager.getEditorFont === 'function'
            ? window.ThemeManager.getEditorFont()
            : 'System Default')
        : fontName;
    const fontKey = getFontKey(resolvedFont);
    const fontFamily = getFontFamilyString(resolvedFont);

    if (!fontKey) {
        editor.root.style.removeProperty('font-family');
        editor.__lastAppliedFontKey = null;
    } else {
        editor.root.style.setProperty('font-family', fontFamily, 'important');
        editor.__lastAppliedFontKey = fontKey;
    }

    if (writerEditor) {
        editor.root.style.removeProperty('font-size');
        editor.__lastAppliedSizeKey = null;
        return true;
    }

    const resolvedSize = sizePx == null
        ? (window.ThemeManager && typeof window.ThemeManager.getEditorFontSize === 'function'
            ? window.ThemeManager.getEditorFontSize()
            : null)
        : sizePx;
    const numericSize = Number.parseInt(resolvedSize, 10);
    if (Number.isFinite(numericSize) && numericSize > 0) {
        const sizeValue = `${numericSize}px`;
        editor.root.style.setProperty('font-size', sizeValue);
        editor.__lastAppliedSizeKey = sizeValue;
    } else {
        editor.root.style.removeProperty('font-size');
        editor.__lastAppliedSizeKey = null;
    }

    return true;
}

// Backward-compat aliases
window.applyBaseTypographyToQuill = applyBaseTypography;
window.applyBaseTypography = applyBaseTypography;

function getActiveEditor() {
    if (window.Editor && typeof window.Editor.getActive === 'function') {
        return window.Editor.getActive();
    }
    return window.activeEditor || window.editor || null;
}

function getFormattingRange(quill) {
    if (!quill) return null;
    const toolbarSnapshot = window.__extalToolbarSelectionSnapshot;
    if (
        toolbarSnapshot &&
        toolbarSnapshot.editor === quill &&
        toolbarSnapshot.contextKey === (quill.__lastLoadContextKey || "") &&
        toolbarSnapshot.range &&
        Number.isInteger(toolbarSnapshot.range.index) &&
        Number.isInteger(toolbarSnapshot.range.length)
    ) {
        const snapshotAgeMs = Math.max(0, Date.now() - Number(toolbarSnapshot.at || 0));
        if (snapshotAgeMs <= 5000) {
            window.__extalToolbarSelectionSnapshot = null;
            return {
                index: toolbarSnapshot.range.index,
                length: toolbarSnapshot.range.length
            };
        }
        window.__extalToolbarSelectionSnapshot = null;
    }

    const liveRange = quill.getSelection ? quill.getSelection() : null;
    if (liveRange && Number.isInteger(liveRange.index) && Number.isInteger(liveRange.length)) {
        return { index: liveRange.index, length: liveRange.length };
    }

    const lastRange = quill.__lastRange;
    if (lastRange && Number.isInteger(lastRange.index) && Number.isInteger(lastRange.length)) {
        try {
            if (quill.root && typeof quill.root.focus === 'function') {
                quill.root.focus({ preventScroll: true });
            }
        } catch (_) {
            try {
                if (quill.root && typeof quill.root.focus === 'function') quill.root.focus();
            } catch (_) {}
        }
        try {
            if (typeof quill.focus === 'function') quill.focus();
        } catch (_) {}
        try {
            if (typeof quill.setSelection === 'function') {
                quill.setSelection(lastRange.index, lastRange.length, 'silent');
            }
        } catch (_) {}
        return { index: lastRange.index, length: lastRange.length };
    }

    return null;
}

function applyFontToActiveEditor(fontName) {
    const quill = getActiveEditor();
    if (!quill) return;

    const range = getFormattingRange(quill);

    if (isWriterEditor(quill)) {
        if (range && range.length > 0) {
            quill.formatText(range.index, range.length, 'font', false, 'user');
        } else {
            quill.format('font', false, 'user');
        }
        applyBaseTypography(quill, 'System Default', quill.__lastAppliedSizeKey || null);
        if (range && typeof quill.setSelection === 'function') {
            try { quill.setSelection(range.index, range.length, 'silent'); } catch (_) {}
        }
        if (typeof window.syncToolbarFontSelectorState === 'function') {
            window.syncToolbarFontSelectorState(quill);
        }
        return;
    }

    const fontKey = getFontKey(fontName);
    const fontFamily = getFontFamilyString(fontName);
    if (!fontKey) {
        if (range && range.length > 0) {
            quill.formatText(range.index, range.length, 'font', false, 'user');
        } else {
            quill.format('font', false, 'user');
        }
    } else {
        if (range && range.length > 0) {
            quill.formatText(range.index, range.length, 'font', fontFamily, 'user');
        } else {
            quill.format('font', fontFamily, 'user');
        }
    }

    applyBaseTypography(quill, fontName, quill.__lastAppliedSizeKey || null);
    if (range && typeof quill.setSelection === 'function') {
        try { quill.setSelection(range.index, range.length, 'silent'); } catch (_) {}
    }
}

function applyStoredEditorTypographyToEditors() {
    const editors = [];
    if (window.Editor && Array.isArray(window.Editor.all)) {
        window.Editor.all.forEach((q) => {
            if (q) editors.push(q);
        });
    }
    ['editor', 'bioEditor', 'notesEditor', 'eventDescriptionEditor'].forEach((key) => {
        const q = window[key];
        if (q && !editors.includes(q)) editors.push(q);
    });
    editors.forEach((q) => applyBaseTypography(q));
    if (typeof window.syncToolbarFontSelectorState === 'function') {
        window.syncToolbarFontSelectorState(getActiveEditor());
    }
    if (typeof window.syncToolbarFontSizeState === 'function') {
        window.syncToolbarFontSizeState(getActiveEditor());
    }
    return editors.length;
}

window.applyStoredEditorTypographyToEditors = applyStoredEditorTypographyToEditors;

function applySizeToActiveEditor(sizePx) {
    const quill = getActiveEditor();
    if (!quill) return;

    const sizeValue = sizePx + 'px';
    const range = quill.getSelection ? quill.getSelection() : null;
    if (range && range.length > 0) {
        quill.formatText(range.index, range.length, 'size', sizeValue, 'user');
    } else {
        quill.format('size', sizeValue, 'user');
    }
    // Store the last applied size so toolbar-sync can read it back for unformatted text
    quill.__lastAppliedSizeKey = sizeValue;
}

function openSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        if (window.activeEditor) window.activeEditor.blur();
        if (window.editor) window.editor.blur();
        if (window.personalityEditor) window.personalityEditor.blur();
        if (window.backgroundEditor) window.backgroundEditor.blur();
        if (window.motivationsEditor) window.motivationsEditor.blur();
        if (window.bioEditor) window.bioEditor.blur();
        if (window.notesEditor) window.notesEditor.blur();
        modal.style.display = 'flex';
        populateSettingsUI();
    }
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    try {
        if (typeof window.restoreEditorAfterModalClose === 'function') {
            window.restoreEditorAfterModalClose('settings-close');
        }
    } catch (_) {}
}

function populateToolbarFontSelector() {
    const toolbarFontSelector = document.getElementById('toolbar-font-selector');
    if (!toolbarFontSelector) return;

    toolbarFontSelector.innerHTML = '';
    const fonts = ThemeManager.getEditorFonts();
    const currentFont = ThemeManager.getEditorFont();
    const selectedFont = fonts.includes(currentFont) ? currentFont : 'System Default';
    if (selectedFont !== currentFont && typeof ThemeManager.setEditorFont === 'function') {
        ThemeManager.setEditorFont(selectedFont);
    }
    
    fonts.forEach(fontName => {
        const option = document.createElement('option');
        option.value = fontName;
        option.textContent = fontName;
        option.selected = fontName === selectedFont;
        toolbarFontSelector.appendChild(option);
    });

    if (typeof window.syncToolbarFontSelectorState === 'function') {
        window.syncToolbarFontSelectorState(getActiveEditor());
    }
}

function syncToolbarFontSelectorState(quill = null) {
    const toolbarFontSelector = document.getElementById('toolbar-font-selector');
    if (!toolbarFontSelector) return;
    const targetEditor = quill || getActiveEditor();
    const lockToDefault = isWriterEditor(targetEditor);
    toolbarFontSelector.disabled = lockToDefault;
    toolbarFontSelector.title = lockToDefault
        ? 'Writer editor uses the default font.'
        : 'Change editor font';
    if (lockToDefault) {
        toolbarFontSelector.value = 'System Default';
    }
}

window.syncToolbarFontSelectorState = syncToolbarFontSelectorState;

// Expose for font watcher updates
window.populateToolbarFontSelector = populateToolbarFontSelector;

const EDITOR_FONT_SIZE_MIN = 1;
const EDITOR_FONT_SIZE_MAX = 512;

function normalizeToolbarFontSize(value, fallback = null) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return fallback;
    const numeric = parseInt(raw.replace(/px$/i, ''), 10);
    if (!Number.isFinite(numeric)) return fallback;
    const clamped = Math.max(EDITOR_FONT_SIZE_MIN, Math.min(EDITOR_FONT_SIZE_MAX, numeric));
    return clamped;
}

function ensureToolbarFontSizeOption(size) {
    const toolbarFontSize = document.getElementById('toolbar-font-size');
    if (!toolbarFontSize) return null;
    const normalized = normalizeToolbarFontSize(size, null);
    if (normalized == null) return null;
    const value = String(normalized);

    let option = toolbarFontSize.querySelector(`option[value="${value}"]`);
    if (option) return option;

    option = document.createElement('option');
    option.value = value;
    option.textContent = `${value}px`;
    option.dataset.dynamicSize = '1';

    const customOption = toolbarFontSize.querySelector('option[value="__custom__"]');
    const numericOptions = Array.from(toolbarFontSize.querySelectorAll('option'))
        .filter((opt) => opt.value !== '__custom__')
        .map((opt) => ({ opt, size: normalizeToolbarFontSize(opt.value, null) }))
        .filter((entry) => entry.size != null);

    const insertionPoint = numericOptions.find((entry) => entry.size > normalized);
    if (insertionPoint && insertionPoint.opt.parentNode === toolbarFontSize) {
        toolbarFontSize.insertBefore(option, insertionPoint.opt);
    } else {
        toolbarFontSize.appendChild(option);
    }

    return option;
}

function syncToolbarFontSizeSelection(size) {
    const toolbarFontSize = document.getElementById('toolbar-font-size');
    if (!toolbarFontSize) return;
    const normalized = normalizeToolbarFontSize(size, 14);
    ensureToolbarFontSizeOption(normalized);
    toolbarFontSize.value = String(normalized);
}

window.syncToolbarFontSizeSelection = syncToolbarFontSizeSelection;

function syncToolbarFontSizeState(quill = null) {
    const toolbarFontSize = document.getElementById('toolbar-font-size');
    if (!toolbarFontSize) return;
    const targetEditor = quill || getActiveEditor();
    const lockToWritingTools = isWriterEditor(targetEditor);
    toolbarFontSize.disabled = lockToWritingTools;
    toolbarFontSize.title = lockToWritingTools
        ? 'Writer editor uses Writing Tools typography.'
        : 'Change font size';
}

window.syncToolbarFontSizeState = syncToolbarFontSizeState;

function populateSettingsUI() {
    const schemeSelector = document.getElementById('theme-scheme-selector');
    const colorPickers = document.getElementById('theme-color-pickers');

    if (!schemeSelector || !colorPickers) return;

    // Clear and populate scheme selector
    schemeSelector.innerHTML = '';
    const schemes = ThemeManager.getSchemeNames();
    schemes.forEach(schemeName => {
        const option = document.createElement('option');
        option.value = schemeName;
        option.textContent = ThemeManager.getSchemeName(schemeName);
        option.selected = schemeName === ThemeManager.currentScheme;
        schemeSelector.appendChild(option);
    });

    // Populate color pickers
    colorPickers.innerHTML = '';
    const colorKeys = ThemeManager.getColorKeys();
    const colors = ThemeManager.getColors();

    const parseHexColor = (hex) => {
        if (!hex || typeof hex !== 'string') return null;
        const normalized = hex.trim();
        if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) return null;
        const value = normalized.length === 4
            ? normalized.replace(/^#(.)(.)(.)$/i, '#$1$1$2$2$3$3')
            : normalized;
        const r = parseInt(value.slice(1, 3), 16);
        const g = parseInt(value.slice(3, 5), 16);
        const b = parseInt(value.slice(5, 7), 16);
        return { r, g, b };
    };

    const relativeLuminance = ({ r, g, b }) => {
        const toLinear = (channel) => {
            const c = channel / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };
        const R = toLinear(r);
        const G = toLinear(g);
        const B = toLinear(b);
        return 0.2126 * R + 0.7152 * G + 0.0722 * B;
    };

    const pickReadableTextColor = (bgHex, preferredHex) => {
        const bg = parseHexColor(bgHex);
        const preferred = parseHexColor(preferredHex);
        if (!bg || !preferred) return preferredHex || '#ffffff';

        const bgLum = relativeLuminance(bg);
        const prefLum = relativeLuminance(preferred);
        const contrast = (Math.max(bgLum, prefLum) + 0.05) / (Math.min(bgLum, prefLum) + 0.05);
        if (contrast >= 3) return preferredHex;

        const white = { r: 255, g: 255, b: 255 };
        const black = { r: 0, g: 0, b: 0 };
        const whiteContrast = (Math.max(bgLum, relativeLuminance(white)) + 0.05) / (Math.min(bgLum, relativeLuminance(white)) + 0.05);
        const blackContrast = (Math.max(bgLum, relativeLuminance(black)) + 0.05) / (Math.min(bgLum, relativeLuminance(black)) + 0.05);
        return whiteContrast >= blackContrast ? '#ffffff' : '#000000';
    };

    const readableTextColor = pickReadableTextColor(colors['bg-primary'], colors['text-primary']);

    const colorLabels = {
        'editor-bg': 'Editor Background',
        'writing-canvas-bg': 'Writing Canvas Background',
        'writing-paper-bg': 'Writing Paper Background',
        'writing-paper-text': 'Writing Paper Text',
        'writing-paper-link': 'Writing Paper Link'
    };

    colorKeys.forEach(colorKey => {
        const colorValue = colors[colorKey];
        const container = document.createElement('div');
        container.style.cssText = 'display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding: 8px; background: var(--bg-secondary); border-radius: 4px;';

        const label = document.createElement('label');
        label.textContent = colorLabels[colorKey] || colorKey.replace(/-/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        label.style.cssText = 'flex: 0 0 140px; font-size: 12px; color: var(--text-secondary);';

        const input = document.createElement('input');
        input.type = 'color';
        input.value = colorValue;
        input.style.cssText = 'width: 40px; height: 40px; border: 1px solid var(--border-color); border-radius: 4px; cursor: pointer;';
        const isValidHex = (value) => /^#[0-9a-f]{6}$/i.test(value) || /^#[0-9a-f]{3}$/i.test(value);

        input.addEventListener('input', (e) => {
            const val = e.target.value;
            ThemeManager.setColor(colorKey, val);
            textInput.value = val;
        });

        input.addEventListener('change', (e) => {
            const val = e.target.value;
            ThemeManager.setColor(colorKey, val);
            textInput.value = val;
        });

        const textInput = document.createElement('input');
        textInput.type = 'text';
        textInput.value = colorValue;
        textInput.style.cssText = `flex: 1; padding: 6px 8px; background: var(--bg-primary); color: ${readableTextColor}; caret-color: ${readableTextColor}; border: 1px solid var(--border-color); border-radius: 4px; font-size: 12px; font-family: monospace;`;
        textInput.addEventListener('focus', () => {
            if (window.activeEditor) window.activeEditor.blur();
            if (window.editor) window.editor.blur();
            if (window.personalityEditor) window.personalityEditor.blur();
            if (window.backgroundEditor) window.backgroundEditor.blur();
            if (window.motivationsEditor) window.motivationsEditor.blur();
            if (window.bioEditor) window.bioEditor.blur();
            if (window.notesEditor) window.notesEditor.blur();
        });
        textInput.addEventListener('keydown', (e) => e.stopPropagation());
        textInput.addEventListener('keypress', (e) => e.stopPropagation());
        textInput.addEventListener('keyup', (e) => e.stopPropagation());
        textInput.addEventListener('change', (e) => {
            const val = e.target.value.trim();
            if (isValidHex(val)) {
                ThemeManager.setColor(colorKey, val);
                input.value = val;
                textInput.value = val;
            } else {
                alert('Invalid color format. Use hex colors like #ffffff');
                textInput.value = input.value;
            }
        });
        textInput.addEventListener('input', (e) => {
            const val = e.target.value.trim();
            if (isValidHex(val)) {
                input.value = val;
                ThemeManager.setColor(colorKey, val);
            }
        });

        container.appendChild(label);
        container.appendChild(input);
        container.appendChild(textInput);
        colorPickers.appendChild(container);
    });

    populateTopicTemplateSettingsUI();
    populateCharacterTemplateSettingsUI();
    if (typeof window.syncToolbarTtsSettingsUI === 'function') {
        window.syncToolbarTtsSettingsUI();
    }
}

// Event listeners for settings modal
document.addEventListener('DOMContentLoaded', () => {
    const schemeSelector = document.getElementById('theme-scheme-selector');
    if (schemeSelector) {
        schemeSelector.addEventListener('change', (e) => {
            ThemeManager.setScheme(e.target.value);
            populateSettingsUI();
        });
    }


    // Toolbar font controls
    const toolbarFontSelector = document.getElementById('toolbar-font-selector');
    if (toolbarFontSelector) {
        populateToolbarFontSelector();
        toolbarFontSelector.addEventListener('change', (e) => {
            ThemeManager.setEditorFont(e.target.value);
            // Formatting is handled by the main toolbar logic in index.html.
            // Keep this listener for persistence only.
        });
    }

    const toolbarFontSize = document.getElementById('toolbar-font-size');
    if (toolbarFontSize) {
        const currentSize = ThemeManager.getEditorFontSize();
        syncToolbarFontSizeSelection(currentSize);
        toolbarFontSize.addEventListener('change', (e) => {
            const raw = String(e.target.value || '').trim();
            if (!raw || raw === '__custom__') return;
            const size = normalizeToolbarFontSize(raw, null);
            if (size == null) return;
            ThemeManager.setEditorFontSize(size);
            syncToolbarFontSizeSelection(size);
            // Formatting is handled by the main toolbar logic in index.html.
        });
    }

    const resetBtn = document.getElementById('btn-reset-theme');
    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            if (confirm('Reset all colors to the default scheme?')) {
                ThemeManager.resetToDefaults();
                populateSettingsUI();
            }
        });
    }

    const exportBtn = document.getElementById('btn-export-theme');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const themeData = {
                scheme: ThemeManager.currentScheme,
                name: ThemeManager.getSchemeName(ThemeManager.currentScheme),
                custom: ThemeManager.getColors()
            };
            try {
                const dataStr = JSON.stringify(themeData, null, 2);
                const dataBlob = new Blob([dataStr], { type: 'application/json' });
                const url = URL.createObjectURL(dataBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `extal-theme-${ThemeManager.currentScheme}.json`;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                a.remove();
                // Revoke asynchronously so the save operation can start reliably.
                setTimeout(() => URL.revokeObjectURL(url), 0);
            } catch (err) {
                console.error('Theme export failed:', err);
                alert('Failed to export theme: ' + err.message);
            }
        });
    }

    const importBtn = document.getElementById('btn-import-theme');
    if (importBtn) {
        importBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'application/json';
            input.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const themeData = JSON.parse(event.target.result);
                        const importedColors = themeData.custom && typeof themeData.custom === 'object'
                            ? themeData.custom
                            : null;

                        if (importedColors) {
                            const rawName = themeData.name || themeData.scheme || 'Imported Theme';
                            const sanitizeKey = (value) => value
                                .toLowerCase()
                                .replace(/[^a-z0-9]+/g, '-')
                                .replace(/(^-|-$)/g, '');
                            let schemeKey = themeData.scheme || sanitizeKey(rawName) || `imported-${Date.now()}`;
                            if (ThemeManager.builtInSchemeKeys.includes(schemeKey) || ThemeManager.schemes[schemeKey]) {
                                schemeKey = `${sanitizeKey(rawName) || 'imported'}-${Date.now()}`;
                            }
                            const schemeName = rawName;
                            const baseColors = ThemeManager.schemes.dark.colors;
                            const mergedColors = { ...baseColors, ...importedColors };
                            ThemeManager.registerScheme(schemeKey, schemeName, mergedColors);
                            ThemeManager.customColors = {};
                            ThemeManager.setScheme(schemeKey);
                        }

                        ThemeManager.saveTheme();
                        ThemeManager.applyTheme();
                        populateSettingsUI();
                        alert('Theme imported successfully!');
                    } catch (err) {
                        alert('Failed to import theme: ' + err.message);
                    }
                };
                reader.readAsText(file);
            });
            input.click();
        });
    }

    const topicTemplateSelector = document.getElementById('topic-template-default-selector');
    if (topicTemplateSelector) {
        topicTemplateSelector.addEventListener('change', (e) => {
            setDefaultTopicTemplateId(e.target.value);
            populateTopicTemplateSettingsUI();
        });
    }

    const applyTemplateBtn = document.getElementById('btn-apply-topic-template');
    if (applyTemplateBtn) {
        applyTemplateBtn.addEventListener('click', () => applySelectedTopicTemplateToCurrentTopic());
    }

    const saveTemplateBtn = document.getElementById('btn-save-topic-template');
    if (saveTemplateBtn) {
        saveTemplateBtn.addEventListener('click', () => saveCurrentTopicAsCustomTemplate());
    }

    const deleteTemplateBtn = document.getElementById('btn-delete-topic-template');
    if (deleteTemplateBtn) {
        deleteTemplateBtn.addEventListener('click', () => deleteSelectedCustomTopicTemplate());
    }

    const characterTemplateSelector = document.getElementById('character-template-default-selector');
    if (characterTemplateSelector) {
        characterTemplateSelector.addEventListener('change', (e) => {
            setDefaultCharacterTemplateId(e.target.value);
            populateCharacterTemplateSettingsUI();
        });
    }

    const applyCharacterTemplateBtn = document.getElementById('btn-apply-character-template');
    if (applyCharacterTemplateBtn) {
        applyCharacterTemplateBtn.addEventListener('click', () => applySelectedCharacterTemplateToCurrentCharacter());
    }

    const saveCharacterTemplateBtn = document.getElementById('btn-save-character-template');
    if (saveCharacterTemplateBtn) {
        saveCharacterTemplateBtn.addEventListener('click', () => saveCurrentCharacterAsCustomTemplate());
    }

    const deleteCharacterTemplateBtn = document.getElementById('btn-delete-character-template');
    if (deleteCharacterTemplateBtn) {
        deleteCharacterTemplateBtn.addEventListener('click', () => deleteSelectedCustomCharacterTemplate());
    }

    const ttsProviderSelector = document.getElementById('tts-settings-provider');
    if (ttsProviderSelector) {
        ttsProviderSelector.addEventListener('change', (e) => {
            if (typeof window.updateToolbarTtsSettings === 'function') {
                window.updateToolbarTtsSettings({ provider: e.target.value });
            }
        });
    }

    const ttsSystemVoiceSelector = document.getElementById('tts-settings-system-voice');
    if (ttsSystemVoiceSelector) {
        ttsSystemVoiceSelector.addEventListener('change', (e) => {
            if (typeof window.updateToolbarTtsSettings === 'function') {
                window.updateToolbarTtsSettings({ systemVoiceURI: e.target.value || '' });
            }
        });
    }

    const ttsPiperModelSelector = document.getElementById('tts-settings-piper-model');
    if (ttsPiperModelSelector) {
        ttsPiperModelSelector.addEventListener('change', (e) => {
            if (typeof window.updateToolbarTtsSettings === 'function') {
                window.updateToolbarTtsSettings({ piperModelId: e.target.value || '' });
            }
        });
    }

    const ttsDeliverySelector = document.getElementById('tts-settings-delivery');
    if (ttsDeliverySelector) {
        ttsDeliverySelector.addEventListener('change', (e) => {
            if (typeof window.updateToolbarTtsSettings === 'function') {
                window.updateToolbarTtsSettings({ delivery: e.target.value || 'natural' });
            }
        });
    }

    const ttsGrammarCleanupSelector = document.getElementById('tts-settings-grammar-cleanup');
    if (ttsGrammarCleanupSelector) {
        ttsGrammarCleanupSelector.addEventListener('change', (e) => {
            if (typeof window.updateToolbarTtsSettings === 'function') {
                window.updateToolbarTtsSettings({ grammarCleanup: e.target.value || 'off' });
            }
        });
    }

    const ttsPauseStrengthSlider = document.getElementById('tts-settings-pause-strength');
    if (ttsPauseStrengthSlider) {
        ttsPauseStrengthSlider.addEventListener('input', (e) => {
            if (typeof window.updateToolbarTtsSettings === 'function') {
                window.updateToolbarTtsSettings({ pauseStrength: Number(e.target.value || 35) || 35 });
            }
        });
    }

    const ttsSpeedSelector = document.getElementById('tts-settings-speed');
    if (ttsSpeedSelector) {
        ttsSpeedSelector.addEventListener('input', (e) => {
            if (typeof window.updateToolbarTtsSettings === 'function') {
                window.updateToolbarTtsSettings({ speed: Number(e.target.value || 1) || 1 });
            }
        });
    }

    const ttsPitchSlider = document.getElementById('tts-settings-pitch');
    if (ttsPitchSlider) {
        ttsPitchSlider.addEventListener('input', (e) => {
            if (typeof window.updateToolbarTtsSettings === 'function') {
                window.updateToolbarTtsSettings({ pitch: Number(e.target.value || 0) || 0 });
            }
        });
    }

    populateTopicTemplateSettingsUI();
    populateCharacterTemplateSettingsUI();
    if (typeof window.syncToolbarTtsSettingsUI === 'function') {
        window.syncToolbarTtsSettingsUI();
    }

    // Close modal when clicking outside
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeSettingsModal();
            }
        });
    }

});
