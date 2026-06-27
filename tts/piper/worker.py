import base64
import io
import json
import os
import subprocess
import sys
import tempfile
import traceback
import wave

try:
    from piper import PiperVoice, SynthesisConfig
except Exception:
    PiperVoice = None
    SynthesisConfig = None


_VOICE_CACHE = {}


def _load_voice(model_path, config_path=None):
    cache_key = (os.path.abspath(model_path), os.path.abspath(config_path) if config_path else None)
    voice = _VOICE_CACHE.get(cache_key)
    if voice is None:
        if PiperVoice is None:
            raise RuntimeError("Python Piper package is unavailable")
        voice = PiperVoice.load(model_path, config_path=config_path or None)
        _VOICE_CACHE[cache_key] = voice
    return voice


def _build_syn_config(payload):
    speaker_id = payload.get("speaker")
    length_scale = payload.get("lengthScale")

    if SynthesisConfig is None or (speaker_id is None and length_scale is None):
        return None

    return SynthesisConfig(
        speaker_id=speaker_id if isinstance(speaker_id, int) else None,
        length_scale=float(length_scale) if isinstance(length_scale, (int, float)) else None,
    )


def _synthesize_bytes_with_python(payload):
    model_path = str(payload.get("modelPath") or "").strip()
    config_path = str(payload.get("configPath") or "").strip() or None
    text = str(payload.get("text") or "").strip()

    if not model_path:
        raise ValueError("modelPath is required")
    if not text:
        raise ValueError("text is required")

    voice = _load_voice(model_path, config_path=config_path)
    syn_config = _build_syn_config(payload)

    audio_buffer = io.BytesIO()
    with wave.open(audio_buffer, "wb") as wav_file:
        wav_file.setframerate(int(voice.config.sample_rate))
        wav_file.setsampwidth(2)
        wav_file.setnchannels(1)
        voice.synthesize_wav(text, wav_file, syn_config=syn_config, set_wav_format=False)

    return audio_buffer.getvalue()


def _save_with_python(payload, output_path):
    model_path = str(payload.get("modelPath") or "").strip()
    config_path = str(payload.get("configPath") or "").strip() or None
    text = str(payload.get("text") or "").strip()

    if not model_path:
        raise ValueError("modelPath is required")
    if not text:
        raise ValueError("text is required")

    voice = _load_voice(model_path, config_path=config_path)
    syn_config = _build_syn_config(payload)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with wave.open(output_path, "wb") as wav_file:
        wav_file.setframerate(int(voice.config.sample_rate))
        wav_file.setsampwidth(2)
        wav_file.setnchannels(1)
        voice.synthesize_wav(text, wav_file, syn_config=syn_config, set_wav_format=False)

    return output_path


def _run_piper_cli(payload, output_path):
    binary_path = str(payload.get("binaryPath") or "").strip()
    model_path = str(payload.get("modelPath") or "").strip()
    config_path = str(payload.get("configPath") or "").strip()
    text = str(payload.get("text") or "").strip()

    if not binary_path:
        raise ValueError("binaryPath is required")
    if not os.path.exists(binary_path):
        raise FileNotFoundError(f"Bundled Piper binary was not found: {binary_path}")
    if not model_path:
        raise ValueError("modelPath is required")
    if not text:
        raise ValueError("text is required")

    binary_dir = os.path.dirname(os.path.abspath(binary_path))
    args = [binary_path, "--model", model_path, "--output_file", output_path, "--espeak_data", binary_dir, "--quiet"]

    if config_path:
        args.extend(["--config", config_path])

    speaker = payload.get("speaker")
    if isinstance(speaker, int):
        args.extend(["--speaker", str(speaker)])

    length_scale = payload.get("lengthScale")
    if isinstance(length_scale, (int, float)):
        args.extend(["--length_scale", str(float(length_scale))])

    env = os.environ.copy()
    if os.name == "nt":
        env["PATH"] = binary_dir + os.pathsep + env.get("PATH", "")

    result = subprocess.run(
        args,
        input=text,
        text=True,
        capture_output=True,
        cwd=binary_dir,
        env=env,
        check=False,
    )

    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        stdout = (result.stdout or "").strip()
        message = stderr or stdout or f"Piper exited with code {result.returncode}"
        raise RuntimeError(message)

    return output_path


def _synthesize_bytes(payload):
    if PiperVoice is not None:
        return _synthesize_bytes_with_python(payload)

    with tempfile.NamedTemporaryFile(prefix="piper-", suffix=".wav", delete=False) as temp_file:
        temp_path = temp_file.name

    try:
        _run_piper_cli(payload, temp_path)
        with open(temp_path, "rb") as wav_file:
            return wav_file.read()
    finally:
        try:
            os.unlink(temp_path)
        except OSError:
            pass


def _save_audio(payload, output_path):
    if PiperVoice is not None:
        return _save_with_python(payload, output_path)
    return _run_piper_cli(payload, output_path)


def _write_response(response):
    sys.stdout.write(json.dumps(response) + "\n")
    sys.stdout.flush()


for raw_line in sys.stdin:
    line = raw_line.strip()
    if not line:
        continue

    request_id = None
    try:
        request = json.loads(line)
        request_id = request.get("id")
        command = str(request.get("command") or "synthesize").strip().lower()

        if command == "prewarm":
            _synthesize_bytes({**request, "text": str(request.get("text") or "prewarm").strip() or "prewarm"})
            _write_response({"id": request_id, "ok": True, "warmed": True})
            continue

        text = str(request.get("text") or "").strip()
        if not text:
            raise ValueError("text is required")

        if command == "save":
            output_path = str(request.get("outputPath") or "").strip()
            if not output_path:
                raise ValueError("outputPath is required")
            _save_audio(request, output_path)
            _write_response({"id": request_id, "ok": True, "outputPath": output_path})
            continue

        if command != "synthesize":
            raise ValueError(f"Unsupported command: {command}")

        audio_bytes = _synthesize_bytes(request)
        _write_response({
            "id": request_id,
            "ok": True,
            "audioBase64": base64.b64encode(audio_bytes).decode("ascii")
        })
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        _write_response({
            "id": request_id,
            "ok": False,
            "error": str(error)
        })


def _write_response(response):
    sys.stdout.write(json.dumps(response) + "\n")
    sys.stdout.flush()


def _run_piper(payload, output_path):
    binary_path = str(payload.get("binaryPath") or "").strip()
    model_path = str(payload.get("modelPath") or "").strip()
    config_path = str(payload.get("configPath") or "").strip()
    text = str(payload.get("text") or "").strip()

    if not binary_path:
        raise ValueError("binaryPath is required")
    if not os.path.exists(binary_path):
        raise FileNotFoundError(f"Bundled Piper binary was not found: {binary_path}")
    if not model_path:
        raise ValueError("modelPath is required")
    if not text:
        raise ValueError("text is required")

    binary_dir = os.path.dirname(os.path.abspath(binary_path))
    args = [binary_path, "--model", model_path, "--output_file", output_path, "--espeak_data", binary_dir, "--quiet"]

    if config_path:
        args.extend(["--config", config_path])

    speaker = payload.get("speaker")
    if isinstance(speaker, int):
        args.extend(["--speaker", str(speaker)])

    length_scale = payload.get("lengthScale")
    if isinstance(length_scale, (int, float)):
        args.extend(["--length_scale", str(float(length_scale))])

    env = os.environ.copy()
    if os.name == "nt":
        env["PATH"] = binary_dir + os.pathsep + env.get("PATH", "")

    result = subprocess.run(
        args,
        input=text,
        text=True,
        capture_output=True,
        cwd=binary_dir,
        env=env,
        check=False,
    )

    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        stdout = (result.stdout or "").strip()
        message = stderr or stdout or f"Piper exited with code {result.returncode}"
        raise RuntimeError(message)

    return output_path


def _synthesize_to_bytes(payload):
    with tempfile.NamedTemporaryFile(prefix="piper-", suffix=".wav", delete=False) as temp_file:
        temp_path = temp_file.name

    try:
        _run_piper(payload, temp_path)
        with open(temp_path, "rb") as wav_file:
            return wav_file.read()
    finally:
        try:
            os.unlink(temp_path)
        except OSError:
            pass


for raw_line in sys.stdin:
    line = raw_line.strip()
    if not line:
        continue

    request_id = None
    try:
        request = json.loads(line)
        request_id = request.get("id")
        command = str(request.get("command") or "synthesize").strip().lower()

        if command == "prewarm":
            _synthesize_to_bytes({**request, "text": str(request.get("text") or "prewarm").strip() or "prewarm"})
            _write_response({"id": request_id, "ok": True, "warmed": True})
            continue

        text = str(request.get("text") or "").strip()
        if not text:
            raise ValueError("text is required")

        if command == "save":
            output_path = str(request.get("outputPath") or "").strip()
            if not output_path:
                raise ValueError("outputPath is required")
            os.makedirs(os.path.dirname(output_path), exist_ok=True)
            _run_piper(request, output_path)
            _write_response({"id": request_id, "ok": True, "outputPath": output_path})
            continue

        if command != "synthesize":
            raise ValueError(f"Unsupported command: {command}")

        audio_bytes = _synthesize_to_bytes(request)
        _write_response({
            "id": request_id,
            "ok": True,
            "audioBase64": __import__("base64").b64encode(audio_bytes).decode("ascii")
        })
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        _write_response({
            "id": request_id,
            "ok": False,
            "error": str(error)
        })