#!/usr/bin/env python3
"""
Local AI rewrite utility (offline).

Uses llama-cpp-python (llama_cpp) to rewrite text while preserving author voice.

Input/Output:
- Reads a UTF-8 JSON file with fields:
    { "text": "...", "mode": "grammar"|"rewrite", "strength": 0..1, "temperature": 0..1 }
- Writes a UTF-8 JSON file:
    { "success": true, "text": "...", "model": "...", "meta": {...} }
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Any, Dict


def _read_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: str, obj: Dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def _cleanup_model_output(raw: str) -> str:
    s = (raw or "").strip()
    if not s:
        return ""

    # Strip common wrappers
    for prefix in ("Rewritten text:", "Rewrite:", "Corrected text:", "Corrected:", "Output:", "Result:"):
        if s.lower().startswith(prefix.lower()):
            s = s[len(prefix):].strip()
            break

    # Remove code fences if present
    if s.startswith("```"):
        # Try to remove a single fenced block
        parts = s.split("```")
        if len(parts) >= 3:
            s = parts[1]
            # If a language tag exists, drop first line
            s = s.split("\n", 1)[1] if "\n" in s else s
            s = s.strip()

    # Strip surrounding quotes
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        s = s[1:-1].strip()

    return s


def _clamp01(x: Any, default: float) -> float:
    try:
        v = float(x)
        if v != v:  # NaN
            return default
        if v < 0:
            return 0.0
        if v > 1:
            return 1.0
        return v
    except Exception:
        return default


def build_prompt(text: str, mode: str, strength: float) -> str:
    base_rules = (
        "You are a meticulous fiction editor.\n"
        "Rules:\n"
        "- Preserve the author's voice, tone, and phrasing as much as possible.\n"
        "- Preserve meaning and intent.\n"
        "- Do not add new plot, facts, or ideas.\n"
        "- Keep character/place names unchanged.\n"
        "- Preserve paragraph breaks.\n"
        "- Return ONLY the revised text. No commentary.\n"
    )

    if mode == "grammar":
        task = (
            "Task: Fix spelling, grammar, punctuation, and obvious typos with minimal changes.\n"
            f"Change strength: {strength:.2f} (higher = slightly more aggressive fixes, still minimal).\n"
        )
    else:
        task = (
            "Task: Rewrite for clarity and flow while keeping the same voice and nuances.\n"
            "Make the smallest changes needed.\n"
            f"Change strength: {strength:.2f} (higher = more rewriting, but still preserve voice).\n"
        )

    return (
        base_rules
        + task
        + "\nTEXT:\n<<</TEXT>>>\n"
        + text
        + "\n<<</END>>>\n\nREVISED TEXT:\n"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-path", required=True, help="Absolute path to a .gguf model")
    ap.add_argument("--input", required=True, help="Input JSON file path")
    ap.add_argument("--output", required=True, help="Output JSON file path")
    ap.add_argument("--n-ctx", type=int, default=4096)
    ap.add_argument("--threads", type=int, default=0)
    args = ap.parse_args()

    started = time.time()
    model_path = args.model_path
    if not os.path.exists(model_path):
        _write_json(args.output, {"success": False, "error": f"Model not found: {model_path}"})
        return 2

    payload = _read_json(args.input)
    text = str(payload.get("text") or "")
    mode = str(payload.get("mode") or "rewrite").strip().lower()
    if mode not in ("rewrite", "grammar"):
        mode = "rewrite"
    strength = _clamp01(payload.get("strength"), 0.35 if mode == "rewrite" else 0.2)
    temperature = _clamp01(payload.get("temperature"), 0.2 if mode == "rewrite" else 0.05)

    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if not text.strip():
        _write_json(args.output, {"success": False, "error": "No text provided"})
        return 3

    # Guardrails for context limits (best-effort)
    if len(text) > 12_000:
        _write_json(args.output, {"success": False, "error": "Selection too large. Please rewrite a smaller section."})
        return 4

    try:
        from llama_cpp import Llama  # type: ignore
    except Exception as e:
        _write_json(
            args.output,
            {
                "success": False,
                "error": "llama-cpp-python not installed",
                "detail": str(e),
                "note": "Use the app's Model Manager to install Local AI support (llama_cpp).",
            },
        )
        return 5

    prompt = build_prompt(text, mode, strength)

    n_threads = args.threads or max(1, (os.cpu_count() or 4) // 2)

    try:
        llm = Llama(
            model_path=model_path,
            n_ctx=int(args.n_ctx),
            n_threads=int(n_threads),
            n_gpu_layers=0,
            verbose=False,
        )

        # Token budget heuristic: allow growth, but cap.
        max_tokens = 1024 if len(text) < 4000 else 1536
        stop = ["<<</END>>>", "\n\nTEXT:", "\n\nRules:"]

        resp = llm(
            prompt,
            max_tokens=max_tokens,
            temperature=temperature,
            top_p=0.9,
            repeat_penalty=1.08,
            stop=stop,
        )
        raw_out = (resp.get("choices") or [{}])[0].get("text") or ""
        out_text = _cleanup_model_output(str(raw_out))

        if not out_text.strip():
            _write_json(args.output, {"success": False, "error": "Model returned empty output"})
            return 6

        _write_json(
            args.output,
            {
                "success": True,
                "text": out_text,
                "model": os.path.basename(model_path),
                "meta": {
                    "mode": mode,
                    "strength": strength,
                    "temperature": temperature,
                    "elapsedMs": int((time.time() - started) * 1000),
                },
            },
        )
        return 0
    except Exception as e:
        _write_json(args.output, {"success": False, "error": "Rewrite failed", "detail": str(e)})
        return 10


if __name__ == "__main__":
    raise SystemExit(main())

