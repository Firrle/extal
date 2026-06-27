const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");

let piperWorker = null;
let piperWorkerRequestId = 0;

function titleCaseWords(value) {
  const acronymParts = new Set(["hfc", "cmu", "vctk", "ljs", "libri"]);
  const specialParts = new Map([
    ["ljspeech", "LJSpeech"],
    ["libritts", "LibriTTS"],
    ["libritts_r", "LibriTTS R"]
  ]);
  return String(value || "")
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^[A-Z0-9]+$/.test(part)) return part;
      if (specialParts.has(part.toLowerCase())) return specialParts.get(part.toLowerCase());
      if (acronymParts.has(part.toLowerCase())) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function readPiperConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (_) {
    return null;
  }
}

function buildPiperModelLabel(id, config = null) {
  const parts = String(id || "").split("-");
  const qualityFromId = parts.length > 1 ? parts[parts.length - 1] : "";
  const quality = String(config && config.audio && config.audio.quality ? config.audio.quality : qualityFromId).trim();

  let voiceId = String(id || "");
  if (parts.length >= 3) {
    voiceId = parts.slice(1, quality ? -1 : undefined).join("-");
  }

  const language = config && config.language
    ? [config.language.name_english, config.language.country_english].filter(Boolean).join(" (")
    : "";
  const languageLabel = language
    ? (language.includes("(") ? `${language})` : language)
    : "";
  const voiceLabel = titleCaseWords((config && config.dataset) || voiceId || id);
  const qualityLabel = quality ? titleCaseWords(quality) : "";

  return [languageLabel, voiceLabel, qualityLabel].filter(Boolean).join(" - ") || String(id || "Piper Model");
}

function listPiperModels(modelsDir) {
  if (!modelsDir || !fs.existsSync(modelsDir)) return [];

  const entries = [];
  for (const entry of fs.readdirSync(modelsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".onnx")) continue;
    const modelPath = path.join(modelsDir, entry.name);
    const id = entry.name.replace(/\.onnx$/i, "");
    const configPath = fs.existsSync(`${modelPath}.json`) ? `${modelPath}.json` : null;
    const config = readPiperConfig(configPath);
    entries.push({
      id,
      name: buildPiperModelLabel(id, config),
      path: modelPath,
      configPath,
      languageCode: config && config.language && config.language.code ? String(config.language.code) : "",
      quality: config && config.audio && config.audio.quality ? String(config.audio.quality) : "",
      format: "onnx"
    });
  }

  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function normalizePiperRequest(payload = {}) {
  const text = String(payload.text || "").trim();
  const speaker = Number.isInteger(payload.speaker) ? payload.speaker : null;
  const lengthScale = Number.isFinite(Number(payload.lengthScale)) ? Number(payload.lengthScale) : null;

  if (!text) {
    throw new Error("TTS text is required.");
  }

  return { text, speaker, lengthScale };
}

function resetPiperWorker(state = piperWorker) {
  if (!state) return;
  if (piperWorker === state) {
    piperWorker = null;
  }
  try {
    state.readline?.close();
  } catch (_) {}
  const pending = state.pending || new Map();
  for (const { reject } of pending.values()) {
    reject(new Error("Bundled Piper worker stopped unexpectedly."));
  }
  pending.clear();
}

function getPiperWorker(runtime = {}) {
  const pythonPath = String(runtime.pythonPath || "").trim();
  const workerScriptPath = String(runtime.workerScriptPath || "").trim();

  if (!pythonPath || !fs.existsSync(pythonPath)) {
    throw new Error("Bundled Piper Python runtime was not found.");
  }
  if (!workerScriptPath || !fs.existsSync(workerScriptPath)) {
    throw new Error("Bundled Piper worker script was not found.");
  }

  if (
    piperWorker &&
    !piperWorker.exited &&
    piperWorker.pythonPath === pythonPath &&
    piperWorker.workerScriptPath === workerScriptPath
  ) {
    return piperWorker;
  }

  if (piperWorker && !piperWorker.exited) {
    try {
      piperWorker.child.kill();
    } catch (_) {}
    resetPiperWorker(piperWorker);
  }

  const child = spawn(pythonPath, [workerScriptPath], {
    stdio: ["pipe", "pipe", "pipe"]
  });

  const state = {
    child,
    exited: false,
    pending: new Map(),
    pythonPath,
    workerScriptPath,
    readline: readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  };

  state.readline.on("line", (line) => {
    let payload = null;
    try {
      payload = JSON.parse(String(line || ""));
    } catch (_) {
      return;
    }

    const requestId = String(payload && payload.id ? payload.id : "").trim();
    if (!requestId || !state.pending.has(requestId)) return;

    const { resolve, reject } = state.pending.get(requestId);
    state.pending.delete(requestId);

    if (payload.ok === false) {
      reject(new Error(payload.error || "Bundled Piper worker failed."));
      return;
    }

    resolve(payload);
  });

  child.on("error", (error) => {
    state.exited = true;
    for (const { reject } of state.pending.values()) {
      reject(new Error(`Failed to start bundled Piper worker: ${error.message}`));
    }
    resetPiperWorker(state);
  });

  child.on("close", (code, signal) => {
    state.exited = true;
    const message = `Bundled Piper worker exited${typeof code === "number" ? ` with code ${code}` : ""}${signal ? ` (${signal})` : ""}.`;
    for (const { reject } of state.pending.values()) {
      reject(new Error(message));
    }
    resetPiperWorker(state);
  });

  piperWorker = state;
  return state;
}

function callPiperWorker(command, payload = {}, runtime = {}) {
  const { text, speaker, lengthScale } = normalizePiperRequest(command === "prewarm" ? { ...payload, text: payload.text || "prewarm" } : payload);
  const worker = getPiperWorker(runtime);
  const requestId = String(++piperWorkerRequestId);

  return new Promise((resolve, reject) => {
    worker.pending.set(requestId, { resolve, reject });

    const request = {
      id: requestId,
      command,
      binaryPath: String(runtime.binaryPath || "").trim(),
      modelPath: String(runtime.modelPath || "").trim(),
      configPath: String(runtime.modelConfigPath || "").trim(),
      text,
      speaker,
      lengthScale
    };

    if (command === "save") {
      request.outputPath = String(payload.outputPath || "").trim();
    }

    worker.child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
      if (!error) return;
      worker.pending.delete(requestId);
      reject(new Error(`Failed to send request to bundled Piper worker: ${error.message}`));
    });
  });
}

async function runPiperToFile(payload = {}, runtime = {}, outputPath) {
  const { text, speaker, lengthScale } = normalizePiperRequest(payload);
  const modelPath = String(runtime.modelPath || "").trim();
  if (!modelPath || !fs.existsSync(modelPath)) {
    throw new Error("Bundled Piper model was not found.");
  }
  if (!outputPath) {
    throw new Error("An output path is required for Piper synthesis.");
  }

  await fsp.mkdir(path.dirname(outputPath), { recursive: true });

  await callPiperWorker("save", { text, speaker, lengthScale, outputPath }, runtime);
  return { text };
}

async function synthesizePiperTts(payload = {}, runtime = {}) {
  const { text } = normalizePiperRequest(payload);
  const response = await callPiperWorker("synthesize", payload, runtime);
  return {
    ok: true,
    provider: "piper",
    modelId: String(runtime.modelId || "").trim(),
    characterCount: text.length,
    mimeType: "audio/wav",
    format: "wav",
    audioDataUrl: `data:audio/wav;base64,${String(response.audioBase64 || "")}`
  };
}

async function savePiperTtsToFile(payload = {}, runtime = {}) {
  const outputPath = String(payload.outputPath || "").trim();
  if (!outputPath) {
    throw new Error("An outputPath is required to save Piper audio.");
  }

  const { text } = await runPiperToFile(payload, runtime, outputPath);
  return {
    ok: true,
    provider: "piper",
    modelId: String(runtime.modelId || "").trim(),
    outputPath,
    characterCount: text.length,
    mimeType: "audio/wav",
    format: "wav"
  };
}

async function prewarmPiperModel(payload = {}, runtime = {}) {
  await callPiperWorker("prewarm", payload, runtime);
  return {
    ok: true,
    provider: "piper",
    modelId: String(runtime.modelId || "").trim(),
    warmed: true
  };
}

function shutdownPiperWorker() {
  if (!piperWorker || piperWorker.exited) return;
  try {
    piperWorker.child.kill();
  } catch (_) {}
}

module.exports = {
  listPiperModels,
  prewarmPiperModel,
  savePiperTtsToFile,
  shutdownPiperWorker,
  synthesizePiperTts
};