#!/usr/bin/env python3
"""
Local AI consistency checker (offline).

Uses llama-cpp-python (llama_cpp) to extract simple per-scene character claims,
then flags likely contradictions across scenes (e.g., "did" vs "didn't").

Input (UTF-8 JSON):
{
  "characters": [{"name":"...", "gender":"..."}],
  "scenes": [{"sceneId":"...", "sceneName":"...", "chapterName":"...", "text":"..."}],
  "maxClaimsPerScene": 12,
  "maxCharsPerScene": 7000
}

Output (UTF-8 JSON):
{
  "success": true,
  "warnings": [...],
  "meta": {...}
}
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from typing import Any, Dict, List, Optional, Tuple


def _read_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: str, obj: Dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def _clamp_int(x: Any, default: int, lo: int, hi: int) -> int:
    try:
        v = int(x)
        if v < lo:
            return lo
        if v > hi:
            return hi
        return v
    except Exception:
        return default


def _strip_fences(s: str) -> str:
    t = (s or "").strip()
    if not t:
        return ""
    if t.startswith("```"):
        parts = t.split("```")
        if len(parts) >= 3:
            inner = parts[1]
            if "\n" in inner:
                inner = inner.split("\n", 1)[1]
            return inner.strip()
    return t


def _extract_json_object(s: str) -> Optional[Dict[str, Any]]:
    """
    Best-effort: find the first JSON object in the string and parse it.
    """
    text = _strip_fences(s)
    if not text:
        return None
    # Fast path
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass

    # Search for a {...} block.
    start = text.find("{")
    if start < 0:
        return None
    # Scan for matching brace with a simple stack counter.
    depth = 0
    end = -1
    for i in range(start, len(text)):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end <= start:
        return None
    chunk = text[start:end]
    try:
        obj = json.loads(chunk)
        return obj if isinstance(obj, dict) else None
    except Exception:
        return None


STOPWORDS = {
    "a",
    "an",
    "the",
    "and",
    "or",
    "but",
    "if",
    "then",
    "than",
    "so",
    "because",
    "as",
    "at",
    "by",
    "for",
    "from",
    "in",
    "into",
    "of",
    "on",
    "onto",
    "out",
    "over",
    "per",
    "to",
    "toward",
    "towards",
    "under",
    "up",
    "with",
    "without",
    "i",
    "me",
    "my",
    "mine",
    "we",
    "us",
    "our",
    "ours",
    "you",
    "your",
    "yours",
    "he",
    "him",
    "his",
    "she",
    "her",
    "hers",
    "they",
    "them",
    "their",
    "theirs",
    "it",
    "its",
    "this",
    "that",
    "these",
    "those",
    "there",
    "here",
    "be",
    "am",
    "is",
    "are",
    "was",
    "were",
    "been",
    "being",
    "do",
    "does",
    "did",
    "done",
    "doing",
    "have",
    "has",
    "had",
    "having",
    "can",
    "could",
    "will",
    "would",
    "shall",
    "should",
    "may",
    "might",
    "must",
    "not",
    "no",
    "never",
    "very",
    "really",
    "just",
    "even",
    "still",
    "also",
    "too",
    "only",
    "almost",
    "said",
    "says",
    "say",
    "told",
    "tell",
    "asks",
    "ask",
}


def _stem_token(w: str) -> str:
    t = (w or "").lower()
    if len(t) > 5 and t.endswith("ing"):
        return t[:-3]
    if len(t) > 4 and t.endswith("ed"):
        return t[:-2]
    if len(t) > 4 and t.endswith("ies"):
        return t[:-3] + "y"
    if len(t) > 3 and t.endswith("s"):
        return t[:-1]
    return t


def _normalize_claim_key(claim: str) -> str:
    s = (claim or "").strip().lower()
    s = re.sub(r"[\"“”‘’']", " ", s)
    s = re.sub(r"[^a-z0-9\s-]+", " ", s)
    toks = [_stem_token(x) for x in re.split(r"\s+", s) if x]
    toks = [t for t in toks if t and t not in STOPWORDS]
    return " ".join(toks[:10]).strip()


def build_extract_prompt(
    scene_text: str,
    character_list: List[Dict[str, str]],
    max_claims: int,
) -> str:
    # Keep character list short-ish (names only) to avoid blowing context.
    names = [str(c.get("name") or "").strip() for c in (character_list or [])]
    names = [n for n in names if n]
    names = names[:200]
    names_blob = "\n".join(f"- {n}" for n in names)

    rules = (
        "You are a careful story analyst. Extract factual claims about characters from the excerpt.\n"
        "Only output JSON. No commentary. No Markdown.\n"
        "Return a single JSON object with key \"claims\".\n"
        "\n"
        "A claim is a small, comparable statement about a character.\n"
        "Format each claim as an object with:\n"
        "- subject: character name (prefer names from the provided list; resolve pronouns when obvious)\n"
        "- claim: a short predicate WITHOUT the subject (present tense; no trailing punctuation)\n"
        "- polarity: true if asserted, false if explicitly negated/denied\n"
        "- evidence: a short quoted snippet (<= 180 chars) from the excerpt supporting the claim\n"
        "\n"
        f"Constraints:\n- Extract at most {max_claims} claims.\n"
        "- Prefer concrete, checkable facts (actions, states, relationships).\n"
        "- If a sentence is ambiguous about who \"he/she/they\" refers to, skip it.\n"
        "- Keep the claim text stable and reusable across scenes.\n"
        "\n"
        "Character names you may use:\n"
        f"{names_blob if names_blob else '(none)'}\n"
    )

    return (
        rules
        + "\nEXCERPT:\n<<</TEXT>>>\n"
        + scene_text
        + "\n<<</END>>>\n\nJSON:\n"
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
    scenes_in = payload.get("scenes") or []
    characters_in = payload.get("characters") or []
    if not isinstance(scenes_in, list):
        _write_json(args.output, {"success": False, "error": "Invalid input: scenes must be a list"})
        return 3

    max_claims_per_scene = _clamp_int(payload.get("maxClaimsPerScene"), 12, 1, 40)
    max_chars_per_scene = _clamp_int(payload.get("maxCharsPerScene"), 7000, 800, 20000)

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

    n_threads = args.threads or max(1, (os.cpu_count() or 4) // 2)

    try:
        llm = Llama(
            model_path=model_path,
            n_ctx=int(args.n_ctx),
            n_threads=int(n_threads),
            n_gpu_layers=0,
            verbose=False,
        )
    except Exception as e:
        _write_json(args.output, {"success": False, "error": "Failed to load model", "detail": str(e)})
        return 6

    extracted_claims: List[Dict[str, Any]] = []
    scenes_processed = 0
    extract_errors: List[Dict[str, Any]] = []

    for idx, sc in enumerate(scenes_in):
        if not isinstance(sc, dict):
            continue
        scene_id = str(sc.get("sceneId") or "")
        scene_name = str(sc.get("sceneName") or "Untitled Scene")
        chapter_name = str(sc.get("chapterName") or "Untitled Chapter")
        text = str(sc.get("text") or "").replace("\r\n", "\n").replace("\r", "\n").strip()
        if not text:
            continue

        # Best-effort context guardrail
        if len(text) > max_chars_per_scene:
            text = text[:max_chars_per_scene].rstrip() + "\n"

        prompt = build_extract_prompt(text, characters_in if isinstance(characters_in, list) else [], max_claims_per_scene)

        try:
            resp = llm(
                prompt,
                max_tokens=900,
                temperature=0.1,
                top_p=0.9,
                repeat_penalty=1.08,
                stop=["<<</END>>>", "\nEXCERPT:", "\n\nEXCERPT:"],
            )
            raw_out = (resp.get("choices") or [{}])[0].get("text") or ""
            obj = _extract_json_object(str(raw_out))
            claims = (obj or {}).get("claims") if isinstance(obj, dict) else None
            if not isinstance(claims, list):
                extract_errors.append(
                    {
                        "sceneId": scene_id,
                        "sceneName": scene_name,
                        "error": "Model output was not valid JSON with a claims list",
                        "raw": str(raw_out)[:1200],
                    }
                )
                continue

            for c in claims:
                if not isinstance(c, dict):
                    continue
                subject = str(c.get("subject") or "").strip()
                claim = str(c.get("claim") or "").strip()
                if not subject or not claim:
                    continue
                pol_raw = c.get("polarity")
                if isinstance(pol_raw, bool):
                    polarity = pol_raw
                elif isinstance(pol_raw, (int, float)):
                    polarity = bool(pol_raw)
                elif isinstance(pol_raw, str):
                    polarity = pol_raw.strip().lower() in ("true", "1", "yes", "y")
                else:
                    # If the model didn't provide a polarity, skip (prevents bogus contradictions).
                    continue
                evidence = str(c.get("evidence") or "").strip()
                extracted_claims.append(
                    {
                        "subject": subject,
                        "claim": claim,
                        "polarity": polarity,
                        "evidence": evidence[:180],
                        "sceneId": scene_id,
                        "sceneName": scene_name,
                        "chapterName": chapter_name,
                        "sceneIndex": idx,
                    }
                )
            scenes_processed += 1
        except Exception as e:
            extract_errors.append(
                {"sceneId": scene_id, "sceneName": scene_name, "error": "Extraction failed", "detail": str(e)}
            )

    # Deterministic contradiction detection
    first_by_key: Dict[str, Dict[str, Any]] = {}
    warnings: List[Dict[str, Any]] = []

    for c in extracted_claims:
        subj = str(c.get("subject") or "").strip()
        claim = str(c.get("claim") or "").strip()
        pol = bool(c.get("polarity"))
        norm = _normalize_claim_key(claim)
        if not subj or not norm:
            continue
        key = f"{subj.lower()}::{norm}"
        if key not in first_by_key:
            first_by_key[key] = {**c, "normKey": norm, "__flagged": False}
            continue
        prev = first_by_key[key]
        if bool(prev.get("polarity") is True) != pol:
            if not prev.get("__flagged"):
                prev["__flagged"] = True
                warnings.append(
                    {
                        "subject": subj,
                        "actionKey": str(prev.get("claim") or claim),
                        "normKey": norm,
                        "earlier": {
                            "sceneId": prev.get("sceneId"),
                            "sceneName": prev.get("sceneName"),
                            "chapterName": prev.get("chapterName"),
                            "negated": not bool(prev.get("polarity") is True),
                            "sentence": prev.get("evidence") or prev.get("claim"),
                        },
                        "later": {
                            "sceneId": c.get("sceneId"),
                            "sceneName": c.get("sceneName"),
                            "chapterName": c.get("chapterName"),
                            "negated": not pol,
                            "sentence": c.get("evidence") or c.get("claim"),
                        },
                    }
                )

    _write_json(
        args.output,
        {
            "success": True,
            "warnings": warnings,
            "meta": {
                "model": os.path.basename(model_path),
                "scenesProcessed": scenes_processed,
                "claimsExtracted": len(extracted_claims),
                "extractErrors": extract_errors[:40],
                "elapsedMs": int((time.time() - started) * 1000),
            },
        },
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
