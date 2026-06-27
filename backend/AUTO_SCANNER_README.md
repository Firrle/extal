# Auto-Scanner for Extal World Builder

Automatically extract and suggest worldbuilding entities (characters, events, topics, locations) from text documents using both rule-based and AI/NLP approaches.

## 🌟 Features

### Rule-Based Extraction (No AI Required)
- **Characters**: Detects titles (King, Queen, Lord, etc.) and proper nouns with context analysis
- **Events**: Extracts historical events, battles, ages, and timeline markers
- **Topics**: Identifies themes using keyword matching (Magic, War, Politics, etc.)
- **Locations**: Finds kingdoms, cities, geographical features
- **Date Parsing**: Extracts years, ages, and temporal references
- **Smart Matching**: Compares against existing vault entries to suggest links

### AI-Enhanced Extraction (Optional)
- **OpenAI GPT-4**: Most accurate, cloud-based
- **Anthropic Claude**: High quality, cloud-based
- **spaCy NER**: Free, runs locally, good for names and places
- Falls back to rule-based if no AI is configured

## 📋 Requirements

**Core** (Rule-based extraction works without any dependencies):
- Python 3.7+
- Standard library only

**Optional** (for AI enhancement):
```bash
# Option 1: OpenAI (requires API key)
pip install openai

# Option 2: Anthropic (requires API key)
pip install anthropic

# Option 3: spaCy (free, local)
pip install spacy
python -m spacy download en_core_web_sm
```

## 🚀 Quick Start

### Basic Usage

Scan a text file with rule-based extraction:
```bash
python backend/auto_scanner.py your_story.txt
```

This will:
1. Extract characters, events, topics, and locations
2. Match against existing vault entries
3. Generate suggestions for new entities
4. Save results to `scan_results.json`

### With AI Enhancement

```bash
# Using spaCy (local, free)
pip install spacy
python -m spacy download en_core_web_sm
python backend/auto_scanner.py your_story.txt --ai

# Using OpenAI
export OPENAI_API_KEY="your-key-here"
python backend/auto_scanner.py your_story.txt --ai

# Using Anthropic
export ANTHROPIC_API_KEY="your-key-here"
python backend/auto_scanner.py your_story.txt --ai
```

### Custom Output File

```bash
python backend/auto_scanner.py your_story.txt --output my_results.json
```

## 📖 Examples

Run the comprehensive examples:
```bash
python backend/example_usage.py
```

This demonstrates:
1. Basic rule-based scanning
2. Generating actionable suggestions
3. Matching existing vault entries
4. Complete workflow with JSON output
5. AI-enhanced extraction

## 📊 Output Format

The scanner generates a JSON file with:

```json
{
  "characters": [
    {
      "name": "King Joshua",
      "mentions": 3,
      "titles": ["King"],
      "confidence": 0.90,
      "suggested_gender": "Male"
    }
  ],
  "events": [
    {
      "name": "Chaos Wars",
      "date": "1201",
      "confidence": 0.85,
      "description": "..."
    }
  ],
  "topics": [
    {
      "name": "War",
      "keywords": ["war", "battle", "conflict"],
      "frequency": 12,
      "confidence": 0.75
    }
  ],
  "locations": [
    {
      "name": "Sarsda",
      "mentions": 4,
      "confidence": 0.80
    }
  ],
  "suggestions": {
    "new_characters": [...],
    "new_events": [...],
    "new_topics": [...],
    "link_suggestions": [...]
  }
}
```

## 🎯 How It Works

### Rule-Based Extraction

1. **Character Detection**:
   - Regex patterns for titles: `(King|Queen|Lord) Name`
   - Proper noun analysis with context
   - Gender inference from titles
   - Confidence scoring based on context clues

2. **Event Detection**:
   - Named event patterns: `Battle of X`, `War of Y`
   - Date extraction: years, ages, temporal markers
   - Context-aware description generation

3. **Topic Classification**:
   - Keyword frequency analysis
   - Pre-defined theme categories
   - Confidence based on keyword diversity and frequency

4. **Location Extraction**:
   - Geographic patterns: `Kingdom of X`, `Mountains of Y`
   - Cross-reference with existing map markers
   - Context extraction for descriptions

### AI Enhancement

The AI layer adds:
- Named Entity Recognition (NER)
- Contextual understanding
- Relationship detection
- More accurate classification

## 💡 Integration with Your App

To integrate auto-scanning into your Electron app:

### 1. Add a "Scan Document" Button

```javascript
// In your renderer.js or main app
async function scanDocument(documentText) {
    const result = await window.electron.invoke('scan-document', documentText);
    
    // Display suggestions to user
    displaySuggestions(result.suggestions);
}
```

### 2. Add IPC Handler (main.js)

```javascript
const { spawn } = require('child_process');

ipcMain.handle('scan-document', async (event, text) => {
    return new Promise((resolve, reject) => {
        // Save text to temp file
        const tempFile = path.join(__dirname, 'temp_scan.txt');
        fs.writeFileSync(tempFile, text);
        
        // Run scanner
        const python = spawn('python3', [
            'backend/auto_scanner.py',
            tempFile,
            '--output', 'backend/temp_results.json'
        ]);
        
        python.on('close', () => {
            const results = JSON.parse(
                fs.readFileSync('backend/temp_results.json', 'utf-8')
            );
            resolve(results);
        });
    });
});
```

### 3. Display Suggestions to User

Create a UI panel showing:
- ✅ Suggested characters to add
- ✅ Suggested events to add  
- ✅ Suggested links to existing entries
- User can approve/reject each suggestion

## 🔧 Configuration

### Adjusting Confidence Thresholds

Edit `auto_scanner.py`:

```python
# Line ~300 - Character confidence threshold
if char.confidence > 0.5:  # Change to 0.6 for stricter matching
    suggestions['new_characters'].append(...)

# Line ~310 - Event confidence threshold  
if event.confidence > 0.6:  # Change to 0.7 for fewer suggestions
    suggestions['new_events'].append(...)
```

### Adding Custom Topic Keywords

```python
# Line ~80 - Add your custom topics
self.topic_keywords = {
    'Magic': ['magic', 'spell', ...],
    'Your Custom Topic': ['keyword1', 'keyword2', ...]
}
```

### Adding Custom Character Titles

```python
# Line ~60 - Add more title patterns
self.title_patterns = [
    r'\b(King|Queen|YourTitle)\s+([A-Z][a-z]+)',
    ...
]
```

## 📝 Use Cases

1. **Importing Existing Lore**: Scan your old documents to populate the vault
2. **Consistency Checking**: Find character mentions you may have missed linking
3. **Timeline Building**: Auto-extract dates and events from narrative text
4. **Topic Organization**: Automatically categorize content by themes
5. **Map Population**: Extract location names for map marker suggestions

## 🐛 Troubleshooting

### "No module named 'openai'"
- AI features are optional
- Script works fine without them (rule-based only)
- Or install: `pip install openai`

### Low Confidence Scores
- Rule-based extraction is conservative
- AI enhancement improves accuracy
- Adjust thresholds in code if needed

### Too Many False Positives
- Increase confidence thresholds
- Add exclusion patterns for common words
- Use AI enhancement for better accuracy

## 🚀 Future Enhancements

- [ ] Web UI for reviewing suggestions
- [ ] Batch processing multiple files
- [ ] Auto-linking between related entities
- [ ] Export suggestions directly to vault format
- [ ] Character relationship extraction
- [ ] Image description scanning (for character portraits)

## 📄 License

Part of Extal World Builder project.

---

**Try it now:**
```bash
python backend/example_usage.py
```
