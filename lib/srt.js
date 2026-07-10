import { readFile, writeFile } from 'node:fs/promises';

function timeToSeconds(t) {
  // 00:00:01,234
  const [h, m, rest] = t.split(':');
  const [s, ms] = rest.split(',');
  return (+h) * 3600 + (+m) * 60 + (+s) + (+ms) / 1000;
}

function secondsToTime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const ms = Math.round((sec - Math.floor(sec)) * 1000);
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/** Parses an SRT file into [{ start, end, text }] with times in seconds.
 * edge-tts emits one cue per sentence/line, not per word. */
export async function parseSrt(srtPath) {
  const raw = await readFile(srtPath, 'utf-8');
  const blocks = raw.replace(/\r/g, '').split(/\n\n+/).filter(Boolean);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter(Boolean);
    const timeLine = lines.find((l) => l.includes('-->'));
    if (!timeLine) continue;
    const [startRaw, endRaw] = timeLine.split('-->').map((s) => s.trim());
    const textLines = lines.slice(lines.indexOf(timeLine) + 1);
    cues.push({
      start: timeToSeconds(startRaw),
      end: timeToSeconds(endRaw),
      text: textLines.join(' ').trim()
    });
  }
  return cues;
}

/** Splits sentence-level cues into short (~maxWords) caption lines, with
 * timestamps linearly interpolated by word position within the original
 * cue span. edge-tts only gives us per-sentence timing, so this is an
 * approximation, but it's close enough for burned-in captions and reads
 * far better than a full sentence sitting on screen for 10+ seconds. */
export function splitIntoShortLines(cues, maxWords = 7) {
  const lines = [];
  for (const cue of cues) {
    const words = cue.text.split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    const span = cue.end - cue.start;
    for (let i = 0; i < words.length; i += maxWords) {
      const chunk = words.slice(i, i + maxWords);
      const fracStart = i / words.length;
      const fracEnd = Math.min(i + chunk.length, words.length) / words.length;
      lines.push({
        start: cue.start + span * fracStart,
        end: cue.start + span * fracEnd,
        text: chunk.join(' ')
      });
    }
  }
  return lines;
}

/** Writes caption lines back out as a standard SRT file. */
export async function writeSrt(lines, outPath) {
  const body = lines
    .map((line, i) => `${i + 1}\n${secondsToTime(line.start)} --> ${secondsToTime(line.end)}\n${line.text}\n`)
    .join('\n');
  await writeFile(outPath, body, 'utf-8');
}
