# Local AI Setup (Optional - Self-Contained)

Add AI capabilities that live entirely within your project directory!

## Quick Setup (3 steps)

### 1. Install llama-cpp-python (one-time)
```bash
pip install llama-cpp-python
```

### 2. Download a small model (~600MB)
```bash
cd /home/andrew/Desktop/extal_browser/backend/
mkdir -p models
cd models

# TinyLlama 1.1B (best balance of size/quality)
wget https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
```

### 3. Enable in the app
- Check the **🤖 Use Local AI** toggle in the top toolbar
- Click any scan button (Auto-Scan, Scan File, Scan Folder)
- The model will run 100% locally on your machine!

---

## Model Options

### TinyLlama 1.1B (Recommended)
- **Size:** ~600MB
- **Speed:** Fast on CPU
- **Quality:** Good for entity extraction
- **Download:** See step 2 above

### Phi-2 (Better quality)
- **Size:** ~1.5GB  
- **Speed:** Slower but more accurate
- **Download:**
```bash
cd /home/andrew/Desktop/extal_browser/backend/models/
wget https://huggingface.co/TheBloke/phi-2-GGUF/resolve/main/phi-2.Q4_K_M.gguf
```

### Mistral 7B (Best quality, slower)
- **Size:** ~4GB
- **Speed:** Needs good CPU/GPU
- **Quality:** Excellent
- **Download:**
```bash
cd /home/andrew/Desktop/extal_browser/backend/models/
wget https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf
```

---

## How It Works

1. **Fully Local:** Model runs on your machine, no internet needed after download
2. **Self-Contained:** Model file sits in `backend/models/` directory
3. **No API Keys:** Everything is local
4. **Toggle On/Off:** Use the checkbox to switch between AI and rule-based scanning
5. **Automatic:** Scanner finds any `.gguf` file in `backend/models/` and uses it

---

## Benefits of Local AI

✅ **Better character detection** - Understands context better than regex
✅ **Smarter topic extraction** - Can identify themes and relationships  
✅ **More accurate dates** - Better at parsing complex date formats
✅ **Gender inference** - Can infer gender from context, not just titles
✅ **100% offline** - No internet required
✅ **Private** - Your worldbuilding data never leaves your computer
✅ **Fast enough** - Small models run quickly on modern CPUs

---

## Performance Tips

- **GPU Acceleration:** If you have an NVIDIA GPU, install `llama-cpp-python` with CUDA support for 10x speed boost
- **Smaller models first:** Start with TinyLlama, upgrade if you want better quality
- **Batch processing:** When scanning folders, the model is loaded once and reused

---

## Without AI

If you don't install a model, the scanner still works great with rule-based pattern matching! It detects:
- Titled characters (King, Queen, Lord, etc.)
- Named events (War of..., Battle of..., etc.)
- Topics based on keyword frequency
- Locations with geographic patterns

Just leave the "Use Local AI" toggle **unchecked**.

