// ============================================================================
// INTEGRATION EXAMPLE: Add Auto-Scanning to Your Electron App
// ============================================================================
// This file shows how to integrate the auto-scanner into your Extal app

// ----------------------------------------------------------------------------
// 1. ADD TO main.js (Electron main process)
// ----------------------------------------------------------------------------

const { ipcMain } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// IPC handler for scanning text
ipcMain.handle('scan-document-text', async (event, text, useAI = false) => {
    return new Promise((resolve, reject) => {
        const timestamp = Date.now();
        const tempFile = path.join(__dirname, `backend/temp_scan_${timestamp}.txt`);
        const outputFile = path.join(__dirname, `backend/temp_results_${timestamp}.json`);
        
        try {
            // Write text to temporary file
            fs.writeFileSync(tempFile, text, 'utf-8');
            
            // Build command
            const args = [
                path.join(__dirname, 'backend/auto_scanner.py'),
                tempFile,
                '--output', outputFile
            ];
            
            if (useAI) {
                args.push('--ai');
            }
            
            // Run Python scanner
            const python = spawn('python3', args);
            
            let stdout = '';
            let stderr = '';
            
            python.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            python.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            python.on('close', (code) => {
                // Clean up temp input file
                try { fs.unlinkSync(tempFile); } catch (e) {}
                
                if (code !== 0) {
                    reject(new Error(`Scanner exited with code ${code}: ${stderr}`));
                    return;
                }
                
                // Read results
                try {
                    const results = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
                    
                    // Clean up temp output file
                    try { fs.unlinkSync(outputFile); } catch (e) {}
                    
                    resolve(results);
                } catch (e) {
                    reject(new Error(`Failed to read results: ${e.message}`));
                }
            });
            
        } catch (error) {
            reject(error);
        }
    });
});


// ----------------------------------------------------------------------------
// 2. ADD TO index.html (UI Elements)
// ----------------------------------------------------------------------------

/*
<!-- Add this to your HTML where you want the scan button -->
<button id="scan-document-btn" class="fancy-button">
    🔍 Auto-Scan Document
</button>

<!-- Modal for showing scan results -->
<div id="scan-results-modal" class="modal" style="display:none;">
    <div class="modal-content">
        <h2>Scan Results</h2>
        <div id="scan-results-content"></div>
        <button id="close-scan-results">Close</button>
    </div>
</div>
*/


// ----------------------------------------------------------------------------
// 3. ADD TO YOUR RENDERER SCRIPT (frontend JavaScript)
// ----------------------------------------------------------------------------

// Example: Add to your main editor or document viewer
class DocumentScanner {
    constructor() {
        this.currentResults = null;
    }
    
    // Scan the current document/text
    async scanCurrentDocument(useAI = false) {
        // Get text from your editor (CodeMirror or wherever)
        const text = this.getCurrentDocumentText();
        
        if (!text || text.trim().length < 50) {
            alert('Document too short to scan. Please add more content.');
            return;
        }
        
        try {
            // Show loading indicator
            this.showLoading('Scanning document...');
            
            // Call the scanner via IPC
            const results = await window.api.scanDocument(text, useAI);
            
            this.currentResults = results;
            
            // Display results
            this.displayResults(results);
            
        } catch (error) {
            console.error('Scan failed:', error);
            alert('Scan failed: ' + error.message);
        } finally {
            this.hideLoading();
        }
    }
    
    // Get text from your editor
    getCurrentDocumentText() {
        // Example for CodeMirror
        if (window.currentEditor && window.currentEditor.getValue) {
            return window.currentEditor.getValue();
        }
        
        // Example for textarea
        const textarea = document.querySelector('#content-area');
        if (textarea) {
            return textarea.value;
        }
        
        // Example for contenteditable
        const editor = document.querySelector('[contenteditable="true"]');
        if (editor) {
            return editor.innerText;
        }
        
        return '';
    }
    
    // Display scan results in a modal or panel
    displayResults(results) {
        const modal = document.getElementById('scan-results-modal');
        const content = document.getElementById('scan-results-content');
        
        let html = '<div class="scan-results">';
        
        // Show suggestions for new characters
        if (results.suggestions.new_characters.length > 0) {
            html += '<h3>📝 Suggested New Characters</h3>';
            html += '<ul class="suggestion-list">';
            results.suggestions.new_characters.forEach((char, idx) => {
                html += `
                    <li class="suggestion-item">
                        <input type="checkbox" id="char-${idx}" checked>
                        <label for="char-${idx}">
                            <strong>${char.name}</strong>
                            ${char.titles.length > 0 ? `(${char.titles.join(', ')})` : ''}
                            <br>
                            <small>Confidence: ${(char.confidence * 100).toFixed(0)}% | 
                                   Mentions: ${char.mentions}</small>
                        </label>
                        <button onclick="scanner.addCharacter(${idx})">Add Now</button>
                    </li>
                `;
            });
            html += '</ul>';
        }
        
        // Show suggestions for new events
        if (results.suggestions.new_events.length > 0) {
            html += '<h3>📅 Suggested New Events</h3>';
            html += '<ul class="suggestion-list">';
            results.suggestions.new_events.forEach((event, idx) => {
                html += `
                    <li class="suggestion-item">
                        <input type="checkbox" id="event-${idx}" checked>
                        <label for="event-${idx}">
                            <strong>${event.name}</strong>
                            ${event.date ? `[${event.date}]` : ''}
                            <br>
                            <small>Confidence: ${(event.confidence * 100).toFixed(0)}%</small>
                        </label>
                        <button onclick="scanner.addEvent(${idx})">Add Now</button>
                    </li>
                `;
            });
            html += '</ul>';
        }
        
        // Show suggestions for new topics
        if (results.suggestions.new_topics.length > 0) {
            html += '<h3>🏷️ Suggested Topics</h3>';
            html += '<ul class="suggestion-list">';
            results.suggestions.new_topics.forEach((topic, idx) => {
                html += `
                    <li class="suggestion-item">
                        <input type="checkbox" id="topic-${idx}" checked>
                        <label for="topic-${idx}">
                            <strong>${topic.name}</strong>
                            <br>
                            <small>Keywords: ${topic.keywords.slice(0, 3).join(', ')}</small>
                        </label>
                        <button onclick="scanner.addTopic(${idx})">Add Now</button>
                    </li>
                `;
            });
            html += '</ul>';
        }
        
        // Show link suggestions for existing entities
        if (results.suggestions.link_suggestions.length > 0) {
            html += '<h3>🔗 Link to Existing Entities</h3>';
            html += '<ul class="suggestion-list">';
            results.suggestions.link_suggestions.forEach((link, idx) => {
                html += `
                    <li class="suggestion-item">
                        <input type="checkbox" id="link-${idx}" checked>
                        <label for="link-${idx}">
                            Link to <strong>${link.name}</strong> (${link.type})
                            <br>
                            <small>${link.reason}</small>
                        </label>
                    </li>
                `;
            });
            html += '</ul>';
        }
        
        if (results.suggestions.new_characters.length === 0 &&
            results.suggestions.new_events.length === 0 &&
            results.suggestions.new_topics.length === 0) {
            html += '<p>No new suggestions found. Try scanning more detailed text.</p>';
        }
        
        html += `
            <div class="scan-actions">
                <button onclick="scanner.applyAllSuggestions()">Apply All Checked</button>
                <button onclick="scanner.closeResults()">Cancel</button>
            </div>
        `;
        
        html += '</div>';
        
        content.innerHTML = html;
        modal.style.display = 'block';
    }
    
    // Add a single character suggestion
    addCharacter(index) {
        const char = this.currentResults.suggestions.new_characters[index];
        
        // Generate ID
        const id = 'id-' + Math.random().toString(36).substr(2, 9);
        
        // Add to vault
        vault.characters[id] = {
            id: id,
            name: char.name,
            type: 'character',
            portrait: '👤',
            firstName: char.firstName || '',
            lastName: char.lastName || '',
            race: '',
            age: '',
            gender: char.gender || '',
            class: '',
            personality: '',
            background: '',
            motivations: '',
            tags: [],
            bio: `# ${char.name}\n\n**Race:** \n**Age:** \n**Gender:** ${char.gender}\n**Class:** \n\n## Biography\n\nDescribe the character here...`,
            notes: `Auto-detected from document scan (${char.mentions} mentions)`,
            relationships: []
        };
        
        // Save vault
        saveVault();
        
        // Refresh character list UI
        if (typeof loadCharacterList === 'function') {
            loadCharacterList();
        }
        
        alert(`Character "${char.name}" added successfully!`);
    }
    
    // Apply all checked suggestions
    async applyAllSuggestions() {
        let added = 0;
        
        // Add checked characters
        this.currentResults.suggestions.new_characters.forEach((char, idx) => {
            const checkbox = document.getElementById(`char-${idx}`);
            if (checkbox && checkbox.checked) {
                this.addCharacter(idx);
                added++;
            }
        });
        
        // Add checked events
        this.currentResults.suggestions.new_events.forEach((event, idx) => {
            const checkbox = document.getElementById(`event-${idx}`);
            if (checkbox && checkbox.checked) {
                this.addEvent(idx);
                added++;
            }
        });
        
        // Add checked topics
        this.currentResults.suggestions.new_topics.forEach((topic, idx) => {
            const checkbox = document.getElementById(`topic-${idx}`);
            if (checkbox && checkbox.checked) {
                this.addTopic(idx);
                added++;
            }
        });
        
        alert(`Added ${added} new entities to your vault!`);
        this.closeResults();
    }
    
    closeResults() {
        document.getElementById('scan-results-modal').style.display = 'none';
    }
    
    showLoading(message) {
        // Implement your loading indicator
        console.log(message);
    }
    
    hideLoading() {
        // Hide loading indicator
    }
}

// Initialize scanner
const scanner = new DocumentScanner();

// Add event listener to scan button
document.getElementById('scan-document-btn')?.addEventListener('click', () => {
    // Ask user if they want AI enhancement
    const useAI = confirm('Use AI enhancement? (requires setup)\nClick OK for AI, Cancel for rule-based only');
    scanner.scanCurrentDocument(useAI);
});


// ----------------------------------------------------------------------------
// 4. ADD TO preload.js (if using contextBridge)
// ----------------------------------------------------------------------------

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // ... your existing API methods ...
    
    scanDocument: (text, useAI) => ipcRenderer.invoke('scan-document-text', text, useAI),
});


// ----------------------------------------------------------------------------
// 5. STYLING (Add to your CSS)
// ----------------------------------------------------------------------------

/*
.scan-results {
    padding: 20px;
    max-height: 600px;
    overflow-y: auto;
}

.suggestion-list {
    list-style: none;
    padding: 0;
}

.suggestion-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px;
    margin: 5px 0;
    background: var(--parchment-light);
    border: 1px solid var(--gold);
    border-radius: 4px;
}

.suggestion-item label {
    flex: 1;
    cursor: pointer;
}

.suggestion-item button {
    background: var(--gold);
    border: none;
    padding: 5px 10px;
    border-radius: 3px;
    cursor: pointer;
}

.suggestion-item button:hover {
    background: var(--gold-bright);
}

.scan-actions {
    margin-top: 20px;
    display: flex;
    gap: 10px;
    justify-content: flex-end;
}

.modal {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
}

.modal-content {
    background: var(--parchment-light);
    padding: 30px;
    border-radius: 8px;
    border: 2px solid var(--gold);
    max-width: 800px;
    width: 90%;
    max-height: 80vh;
    overflow-y: auto;
}
*/


// ----------------------------------------------------------------------------
// USAGE EXAMPLE
// ----------------------------------------------------------------------------

/*
When user writes a document and clicks "Auto-Scan Document":

1. The current document text is extracted
2. Scanner runs (Python backend)
3. Results are shown in a modal with checkboxes
4. User can:
   - Review each suggestion
   - Uncheck ones they don't want
   - Click "Add Now" for individual items
   - Click "Apply All Checked" to add all at once
5. Entities are added to the vault
6. UI refreshes to show new entries
*/
