import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENTRY_POINT = path.join(__dirname, '..', 'remotion', 'index.jsx');

let bundleLocationPromise = null;

/** Bundles the Remotion project once (esbuild bundling is the slow part —
 * do it a single time per orchestrator run and reuse for every video's
 * intro, rather than re-bundling per video). */
export function getRemotionBundle() {
  if (!bundleLocationPromise) {
    bundleLocationPromise = bundle({ entryPoint: ENTRY_POINT });
  }
  return bundleLocationPromise;
}

/**
 * Renders a short (~2.8s) animated title-card intro for one video and
 * returns the output path. `aspect` is 'landscape' or 'vertical'.
 */
export async function renderIntro({ title, niche, accentColor, aspect, outPath }) {
  const serveUrl = await getRemotionBundle();
  const compositionId = aspect === 'vertical' ? 'IntroCardVertical' : 'IntroCardLandscape';
  const inputProps = { title, niche, accentColor };

  const composition = await selectComposition({ serveUrl, id: compositionId, inputProps });

  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    outputLocation: outPath,
    inputProps,
    crf: 20,
    // Match the rest of the pipeline's silent-background segments so
    // concatenation downstream doesn't need to reconcile mismatched audio.
    muted: true
  });

  return outPath;
}
