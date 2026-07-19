"""Persistent stdio worker for Chatterbox TTS (resemble-ai/chatterbox, MIT
license) zero-shot voice cloning. Loads the ~0.5B model once -- the
expensive part -- then serves any number of synthesis requests over
stdin/stdout as JSON lines, so a full video's worth of segments doesn't
pay a model-load cost per segment.

Protocol: one JSON object per line in, one JSON object per line out.
First line out is always {"ready": true} once the model has loaded.

Request:  {"text": "...", "output": "seg0.wav", "reference": "voice-sample/reference.wav",
           "exaggeration": 0.5, "cfg_weight": 0.5}
Response: {"ok": true, "output": "seg0.wav"} or {"ok": false, "error": "..."}
"""
import json
import sys

import torchaudio as ta
from chatterbox.tts import ChatterboxTTS


def main():
    model = ChatterboxTTS.from_pretrained(device='cpu')
    print(json.dumps({'ready': True}), flush=True)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            wav = model.generate(
                req['text'],
                audio_prompt_path=req['reference'],
                exaggeration=req.get('exaggeration', 0.5),
                cfg_weight=req.get('cfg_weight', 0.5),
            )
            ta.save(req['output'], wav, model.sr)
            print(json.dumps({'ok': True, 'output': req['output']}), flush=True)
        except Exception as e:
            print(json.dumps({'ok': False, 'error': str(e)}), flush=True)


if __name__ == '__main__':
    main()
