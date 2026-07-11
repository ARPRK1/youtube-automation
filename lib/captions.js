import { parseSrt, splitIntoShortLines, writeSrt } from './srt.js';

/** Evenly distributes a segment's own text across its known real duration
 * -- used when the TTS provider gives no native word/sentence timing
 * (Kokoro). Less precise than edge-tts's real per-sentence cues, but
 * still synced to the actual audio length, and simple text is read at a
 * fairly constant pace so the approximation reads fine on screen. */
function evenlyDistributedLines(text, durationSec, maxWords = 7) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines = [];
  for (let i = 0; i < words.length; i += maxWords) {
    const chunk = words.slice(i, i + maxWords);
    lines.push({
      start: (i / words.length) * durationSec,
      end: (Math.min(i + chunk.length, words.length) / words.length) * durationSec,
      text: chunk.join(' ')
    });
  }
  return lines;
}

/**
 * Builds short, phrase-level caption lines for one segment's audio clip
 * and writes them to `captionSrtPath`. Uses the TTS provider's own timing
 * (edge-tts) when available, falling back to even distribution across the
 * segment's real duration otherwise (Kokoro).
 */
export async function buildSegmentCaptions({ srtPath, text, durationSec, outPath }) {
  let lines;
  if (srtPath) {
    const cues = await parseSrt(srtPath);
    lines = cues.length > 0 ? splitIntoShortLines(cues) : evenlyDistributedLines(text, durationSec);
  } else {
    lines = evenlyDistributedLines(text, durationSec);
  }
  await writeSrt(lines, outPath);
  return lines;
}
