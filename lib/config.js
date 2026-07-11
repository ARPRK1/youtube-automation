import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

let cached = null;

/** Loads config.yaml once and caches it. All job behavior (volume, voice,
 * topic sources, media rules) is controlled from that one file — no code
 * changes needed to adjust the daily job. */
export function loadConfig() {
  if (cached) return cached;
  const raw = readFileSync(new URL('../config.yaml', import.meta.url), 'utf-8');
  cached = parse(raw);
  return cached;
}
