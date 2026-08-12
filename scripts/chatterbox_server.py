"""Persistent stdio worker for Chatterbox TTS (resemble-ai/chatterbox, MIT
license) zero-shot voice cloning. Loads the ~0.5B model once -- the
expensive part -- then serves any number of synthesis requests over
stdin/stdout as JSON lines.

Protocol: one JSON object per line in, one JSON object per line out.
First line out is always {"ready": true} once the model has loaded.

Request:
  {
    "text": "...",
    "output": "seg0.wav",
    "reference": "voice-sample/reference.wav",
    "exaggeration": 0.72,
    "cfg_weight": 0.28,
    "temperature": 0.8
  }

Official tips (ResembleAI):
  - Higher exaggeration = more emotion BUT tends to speed up speech
  - Lower cfg_weight (~0.3) = slower, more deliberate pacing + freer prosody
  - For expressive speech: exaggeration ~0.7+, cfg_weight ~0.3

Response: {"ok": true, "output": "seg0.wav"} or {"ok": false, "error": "..."}
"""
import json
import sys

import torchaudio as ta
from chatterbox.tts import ChatterboxTTS


def generate_wav(model, req):
    text = req['text']
    kwargs = {
        'audio_prompt_path': req['reference'],
        'exaggeration': float(req.get('exaggeration', 0.72)),
        'cfg_weight': float(req.get('cfg_weight', 0.28)),
    }
    # temperature is supported on recent chatterbox builds; ignore if not.
    temp = req.get('temperature')
    if temp is not None:
        try:
            kwargs['temperature'] = float(temp)
        except (TypeError, ValueError):
            pass

    try:
        wav = model.generate(text, **kwargs)
    except TypeError:
        # Older builds may not accept temperature — retry without it.
        kwargs.pop('temperature', None)
        wav = model.generate(text, **kwargs)
    return wav


def main():
    model = ChatterboxTTS.from_pretrained(device='cpu')
    print(json.dumps({'ready': True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            wav = generate_wav(model, req)
            ta.save(req['output'], wav, model.sr)
            print(json.dumps({'ok': True, 'output': req['output']}), flush=True)
        except Exception as e:
            print(json.dumps({'ok': False, 'error': str(e)}), flush=True)


if __name__ == '__main__':
    main()
