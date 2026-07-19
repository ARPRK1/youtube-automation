"""One-shot tone-color conversion: re-colors an already-synthesized speech
clip (from edge-tts) to match a reference voice sample, using OpenVoice V2
(MIT license -- safe for a monetized channel, unlike XTTS-v2 whose model
license effectively became non-commercial-only after Coqui shut down).

This does NOT re-synthesize speech from text -- it only converts timbre on
top of the existing TTS output, so prosody/timing/pacing (and the caption
sync built on the original audio) stay intact. Usage:

    python scripts/voice_convert.py --input seg.mp3 --output seg-cloned.wav \
        --reference voice-sample/reference.wav [--checkpoint-dir checkpoints_v2/converter]

The reference speaker embedding is the expensive part to compute (VAD +
feature extraction) and never changes run to run, so it's cached next to
the reference file itself (<reference>.se.pt) and reused across every
segment/video in a run instead of being recomputed per call.
"""
import argparse
import os
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', required=True, help='Path to the source speech clip (any ffmpeg-readable format)')
    parser.add_argument('--output', required=True, help='Path to write the converted WAV to')
    parser.add_argument('--reference', required=True, help='Path to the target voice reference sample (WAV)')
    parser.add_argument('--checkpoint-dir', default='checkpoints_v2/converter', help='OpenVoice V2 converter checkpoint directory')
    args = parser.parse_args()

    import torch
    from openvoice import se_extractor
    from openvoice.api import ToneColorConverter

    # OpenVoice's VAD step (via whisper_timestamped) calls torch.hub.load on
    # snakers4/silero-vad without trust_repo=True, which prompts an
    # interactive y/N confirmation on first use -- that blocks forever
    # under CI (no stdin) rather than failing cleanly. Fetching it directly
    # with trust_repo=True first caches it and marks it trusted, so the
    # later implicit call inside get_se() doesn't prompt at all. Cheap to
    # call every run: a no-op once already cached.
    torch.hub.load(repo_or_dir='snakers4/silero-vad', model='silero_vad', trust_repo=True, onnx=False, force_reload=False)

    device = 'cuda:0' if torch.cuda.is_available() else 'cpu'

    config_path = os.path.join(args.checkpoint_dir, 'config.json')
    ckpt_path = os.path.join(args.checkpoint_dir, 'checkpoint.pth')
    if not os.path.exists(config_path) or not os.path.exists(ckpt_path):
        print(f'ERROR: missing OpenVoice checkpoint files under {args.checkpoint_dir} '
              f'(expected config.json + checkpoint.pth) -- see README for the download step.', file=sys.stderr)
        sys.exit(1)

    converter = ToneColorConverter(config_path, device=device)
    converter.load_ckpt(ckpt_path)

    cache_path = args.reference + '.se.pt'
    if os.path.exists(cache_path):
        target_se = torch.load(cache_path, map_location=device)
    else:
        target_se, _ = se_extractor.get_se(args.reference, converter, vad=True)
        torch.save(target_se, cache_path)

    source_se, _ = se_extractor.get_se(args.input, converter, vad=True)

    converter.convert(
        audio_src_path=args.input,
        src_se=source_se,
        tgt_se=target_se,
        output_path=args.output,
    )
    print(f'OK: wrote {args.output}')


if __name__ == '__main__':
    main()
