"""Servico de transcricao em tempo real (faster-whisper) via WebSocket.

Protocolo:
  cliente -> servidor: frames binarios PCM16 little-endian, 16 kHz, mono;
                       texto JSON {"type":"flush"} para fechar a fala em andamento.
  servidor -> cliente: {"type":"partial","text":...}
                       {"type":"final","text":...,"t0":seg,"t1":seg}
                       {"type":"info","msg":...}
"""
import argparse
import asyncio
import glob
import json
import os
import re
import sys
import time

# --- DLLs da NVIDIA (cuBLAS/cuDNN instaladas via pip) precisam estar no caminho antes de importar ctranslate2 ---
if sys.platform == "win32":
    for base in sys.path:
        for d in glob.glob(os.path.join(base, "nvidia", "*", "bin")):
            try:
                os.add_dll_directory(d)
                os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")
            except OSError:
                pass

import numpy as np  # noqa: E402
import websockets  # noqa: E402
from faster_whisper import WhisperModel  # noqa: E402
from faster_whisper.vad import VadOptions, get_speech_timestamps  # noqa: E402

SR = 16000
CHECK_EVERY = 0.4       # s de audio novo entre verificacoes de VAD
END_SILENCE = 0.6       # s de silencio que encerram uma fala
MAX_SEGMENT = 10.0      # s: corte forcado
PARTIAL_EVERY = 1.6     # s entre parciais dentro de uma fala longa
MIN_SPEECH = 0.35       # s minimos de fala para valer a pena transcrever

INITIAL_PROMPT = "Entrevista e debate político no Brasil. Governo, eleições, economia, saúde, segurança."

HALLUCINATIONS = [
    r"obrigad[oa] por assistir", r"legendas? (pela|por|da) comunidade", r"amara\.org", r"inscreva-se",
    r"deixe o seu like", r"até a próxima", r"tchau,? tchau", r"^\W*(tchau|obrigado|obrigada)\W*$",
    r"transcrição e legendas", r"www\.", r"♪", r"^\W*$",
]
HALLUCINATION_RE = re.compile("|".join(HALLUCINATIONS), re.IGNORECASE)

model = None
model_lock = asyncio.Lock()


def load_model(name: str):
    global model
    try:
        model = WhisperModel(name, device="cuda", compute_type="int8_float16")
        print(f"modelo {name} carregado na GPU (int8_float16)", flush=True)
        return f"{name} (GPU)"
    except Exception as e:  # noqa: BLE001
        print(f"GPU indisponivel ({e}); usando 'small' na CPU", flush=True)
        model = WhisperModel("small", device="cpu", compute_type="int8")
        return "small (CPU)"


def transcribe(audio: np.ndarray, partial: bool):
    segments, _ = model.transcribe(
        audio,
        language="pt",
        beam_size=1 if partial else 3,
        condition_on_previous_text=False,
        initial_prompt=INITIAL_PROMPT,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
        no_speech_threshold=0.6,
        temperature=0.0 if partial else [0.0, 0.2],
    )
    parts = []
    for s in segments:
        if s.no_speech_prob > 0.7 or s.avg_logprob < -1.2 or s.compression_ratio > 2.6:
            continue
        parts.append(s.text.strip())
    text = " ".join(p for p in parts if p).strip()
    if HALLUCINATION_RE.search(text) and len(text) < 60:
        return ""
    return text


def speech_spans(audio: np.ndarray):
    return get_speech_timestamps(
        audio,
        VadOptions(min_silence_duration_ms=300, speech_pad_ms=120, threshold=0.5),
        sampling_rate=SR,
    )


async def handler(ws):
    loop = asyncio.get_running_loop()
    buf = np.zeros(0, dtype=np.float32)
    since_check = 0
    stream_t = 0.0            # tempo (s) do inicio do buffer no fluxo total
    last_partial_t = 0.0
    last_partial_text = ""

    async def run(audio, partial):
        async with model_lock:
            return await loop.run_in_executor(None, transcribe, audio, partial)

    async def finalize(upto: int):
        nonlocal buf, stream_t, last_partial_text
        seg = buf[:upto]
        t0, t1 = stream_t, stream_t + upto / SR
        buf = buf[upto:]
        stream_t = t1
        last_partial_text = ""
        if len(seg) / SR < MIN_SPEECH:
            return
        text = await run(seg, False)
        if text:
            await ws.send(json.dumps({"type": "final", "text": text, "t0": round(t0, 2), "t1": round(t1, 2)}))

    try:
        async for msg in ws:
            if isinstance(msg, str):
                try:
                    data = json.loads(msg)
                except ValueError:
                    continue
                if data.get("type") == "flush" and len(buf):
                    spans = await loop.run_in_executor(None, speech_spans, buf)
                    if spans:
                        await finalize(len(buf))
                    buf = np.zeros(0, dtype=np.float32)
                continue

            pcm = np.frombuffer(msg, dtype="<i2").astype(np.float32) / 32768.0
            buf = np.concatenate([buf, pcm])
            since_check += len(pcm)
            if since_check < CHECK_EVERY * SR:
                continue
            since_check = 0

            spans = await loop.run_in_executor(None, speech_spans, buf)
            dur = len(buf) / SR

            if not spans:
                # so silencio/ruido: mantem uma pequena cauda
                if dur > 2.0:
                    keep = int(0.5 * SR)
                    stream_t += (len(buf) - keep) / SR
                    buf = buf[-keep:]
                continue

            last_end = spans[-1]["end"]
            silence_after = (len(buf) - last_end) / SR

            if silence_after >= END_SILENCE:
                await finalize(min(len(buf), last_end + int(0.15 * SR)))
            elif dur >= MAX_SEGMENT:
                # corte forcado: no ultimo silencio interno, se houver; senao no fim
                cut = spans[-2]["end"] if len(spans) > 1 else len(buf)
                await finalize(min(len(buf), cut + int(0.1 * SR)))
            elif dur - last_partial_t >= PARTIAL_EVERY and not model_lock.locked():
                last_partial_t = dur
                text = await run(buf.copy(), True)
                if text and text != last_partial_text:
                    last_partial_text = text
                    await ws.send(json.dumps({"type": "partial", "text": text}))
            if len(buf) == 0:
                last_partial_t = 0.0
    except websockets.ConnectionClosed:
        pass


async def main(port: int, name: str):
    t0 = time.time()
    label = load_model(name)
    print(f"pronto em {time.time() - t0:.1f}s -> {label}", flush=True)
    async with websockets.serve(handler, "127.0.0.1", port, max_size=2**22):
        await asyncio.Future()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--model", default="large-v3-turbo")
    a = ap.parse_args()
    asyncio.run(main(a.port, a.model))
