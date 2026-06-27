#!/usr/bin/env python3
"""
Local project chat utility (offline).

Uses llama-cpp-python (llama_cpp) to answer questions about the current
project context plus retrieved persistent memories.

Input (UTF-8 JSON):
{
  "prompt": "...",
  "context": {...}
}

Output (UTF-8 JSON):
{
  "success": true,
  "text": "...",
  "model": "..."
}
"""

from __future__ import annotations

import argparse
import json
import os
import re
import time
from typing import Any, Dict


def _read_json(path: str) -> Dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: str, obj: Dict[str, Any]) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def _strip_fences(text: str) -> str:
    value = (text or "").strip()
    if not value:
        return ""
    if value.startswith("```"):
        parts = value.split("```")
        if len(parts) >= 3:
            inner = parts[1]
            if "\n" in inner:
                inner = inner.split("\n", 1)[1]
            return inner.strip()
    return value


def _extract_json_object(text: str) -> Dict[str, Any] | None:
    raw = _strip_fences(text)
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        pass

    start = raw.find("{")
    if start < 0:
        return None
    depth = 0
    end = -1
    for idx in range(start, len(raw)):
        ch = raw[idx]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = idx + 1
                break
    if end <= start:
        return None
    try:
        parsed = json.loads(raw[start:end])
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


def _cleanup_model_output(raw: str) -> str:
    text = _strip_fences(raw)
    if not text:
        return ""

    if "ANSWER:" in text:
        text = text.rsplit("ANSWER:", 1)[-1].strip()

    prefixes = (
        "assistant:",
        "answer:",
        "response:",
        "summary:",
        "final answer:",
        "result:",
        "output:",
    )
    lowered = text.lower()
    for prefix in prefixes:
        if lowered.startswith(prefix):
            text = text[len(prefix):].strip()
            lowered = text.lower()
            break

    json_obj = _extract_json_object(text)
    if json_obj:
        for key in ("answer", "summary", "response", "text", "content", "message"):
            value = json_obj.get(key)
            if isinstance(value, str) and value.strip():
                return _cleanup_model_output(value)

    # Drop chat-template and prompt-echo artifacts some local models emit.
    lines = [line.rstrip() for line in text.splitlines()]
    cleaned_lines = []
    skipping_context = False
    for line in lines:
        stripped = line.strip()
        lowered_line = stripped.lower()
        if not stripped:
            cleaned_lines.append("")
            continue
        if lowered_line.startswith("project context json:"):
            skipping_context = True
            continue
        if skipping_context:
            if stripped == "<<</END_CONTEXT>>>":
                skipping_context = False
            continue
        if lowered_line in {"user question:", "answer:", "assistant", "assistant:"}:
            continue
        if re.match(r"^assistant\s*(to=.*)?[:\-]?\s*$", lowered_line):
            continue
        cleaned_lines.append(line)

    text = "\n".join(cleaned_lines).strip()
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


def _truncate(value: str, max_chars: int) -> str:
    text = str(value or "")
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 24] + "\n...[truncated]"


def build_prompt(question: str, context: Dict[str, Any], max_context_chars: int = 9_000) -> str:
    serialized = json.dumps(context, ensure_ascii=False, indent=2)
    context_blob = _truncate(serialized, max_context_chars)

    return (
        "You are an offline writing-project assistant for a worldbuilding app.\n"
        "Answer using ONLY the provided project context and memories.\n"
        "Rules:\n"
        "- If the answer is uncertain or missing from context, say so plainly.\n"
        "- Do not invent facts, names, dates, or relationships.\n"
        "- Prefer concise, practical answers.\n"
        "- Cite the most relevant sources from the provided context labels.\n"
        "- End with a final line in this exact format: Sources: label1 | label2\n"
        "- If no useful sources are available, end with: Sources: none\n"
        "- Return ONLY the answer text. No markdown code fences.\n"
        "\n"
        "PROJECT CONTEXT JSON:\n"
        "<<</CONTEXT>>>\n"
        + context_blob
        + "\n<<</END_CONTEXT>>>\n\n"
        "USER QUESTION:\n"
        + question.strip()
        + "\n\nANSWER:\n"
    )


def fit_prompt_to_context_window(llm: Any, question: str, context: Dict[str, Any], n_ctx: int) -> tuple[str, Dict[str, Any]]:
    # Reserve room for the model's answer so larger retrieved contexts do not crash the request.
    response_budget = min(448, max(192, n_ctx // 7))
    target_tokens = max(512, n_ctx - response_budget)
    max_chars = 9_000
    last_prompt = build_prompt(question, context, max_chars)

    while max_chars >= 1_000:
        prompt = build_prompt(question, context, max_chars)
        last_prompt = prompt
        token_count = len(llm.tokenize(prompt.encode("utf-8")))
        if token_count <= target_tokens:
            return prompt, {
                "inputTokens": token_count,
                "targetTokens": target_tokens,
                "contextChars": max_chars,
                "trimmed": max_chars < 9_000,
            }
        max_chars = int(max_chars * 0.7)

    token_count = len(llm.tokenize(last_prompt.encode("utf-8")))
    return last_prompt, {
        "inputTokens": token_count,
        "targetTokens": target_tokens,
        "contextChars": max_chars,
        "trimmed": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--n-ctx", type=int, default=3072)
    parser.add_argument("--threads", type=int, default=0)
    args = parser.parse_args()

    started = time.time()

    if not os.path.exists(args.model_path):
        _write_json(args.output, {"success": False, "error": f"Model not found: {args.model_path}"})
        return 2

    payload = _read_json(args.input)
    prompt = str(payload.get("prompt") or "").strip()
    context = payload.get("context") if isinstance(payload.get("context"), dict) else {}

    if not prompt:
        _write_json(args.output, {"success": False, "error": "No prompt provided"})
        return 3

    try:
        from llama_cpp import Llama  # type: ignore
    except Exception as exc:
        _write_json(
            args.output,
            {
                "success": False,
                "error": "llama-cpp-python not installed",
                "detail": str(exc),
                "note": "Use the app's Model Manager to install Local AI support (llama_cpp).",
            },
        )
        return 5

    n_threads = args.threads or max(1, (os.cpu_count() or 4) // 2)

    try:
        llm = Llama(
            model_path=args.model_path,
            n_ctx=int(args.n_ctx),
            n_threads=int(n_threads),
            n_gpu_layers=0,
            verbose=False,
        )

        fitted_prompt, prompt_meta = fit_prompt_to_context_window(llm, prompt, context, int(args.n_ctx))

        response = llm(
            fitted_prompt,
            max_tokens=448,
            temperature=0.2,
            top_p=0.9,
            repeat_penalty=1.08,
            stop=["<<</CONTEXT>>>", "<<</END_CONTEXT>>>", "\nUSER QUESTION:", "\nPROJECT CONTEXT JSON:"],
        )
        raw_text = (response.get("choices") or [{}])[0].get("text") or ""
        answer = _cleanup_model_output(str(raw_text))

        if not answer:
            _write_json(args.output, {"success": False, "error": "Model returned empty output"})
            return 6

        _write_json(
            args.output,
            {
                "success": True,
                "text": answer,
                "model": os.path.basename(args.model_path),
                "meta": {
                    "elapsedMs": int((time.time() - started) * 1000),
                    **prompt_meta,
                },
            },
        )
        return 0
    except Exception as exc:
        _write_json(args.output, {"success": False, "error": "Project chat failed", "detail": str(exc)})
        return 10


if __name__ == "__main__":
    raise SystemExit(main())
