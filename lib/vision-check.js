// Vision-based relevance verification -- the actual fix for "an unrelated
// real photo is as bad as a random AI image." Text-title matching (see
// isRelevantTitle in visual-sources.js) is a cheap first filter, but it
// can't catch a photo whose title matches but whose actual content
// doesn't (or a watermark stamped across it). This looks at the real
// pixels via Gemini's free vision tier.

import { callGeminiVision, extractJson } from './llm.js';

/**
 * Downloads nothing itself -- takes an already-downloaded image buffer.
 * Returns { relevant, hasWatermark, description, checked }. `checked` is
 * true only when a real verification actually ran and produced a real
 * (or salvaged) verdict -- callers must not report an asset as "verified"
 * in the manifest when checked is false, even though `relevant` defaults
 * true in that case so the pipeline doesn't block on a degraded check.
 */
export async function verifyImageRelevance(imageBuffer, entity, segmentContext) {
  if (!process.env.GEMINI_API_KEY) {
    return { relevant: true, hasWatermark: false, description: 'unchecked (no Gemini key)', checked: false };
  }

  const prompt = `Look at this image. It's a candidate visual for a video segment about: "${segmentContext}". It's specifically meant to show: "${entity}".

Answer plainly:
1. Does the image actually, clearly show or strongly relate to "${entity}"? Be strict -- a random unrelated photo or a completely different person/place/thing should be marked not relevant, even if thematically loose.
2. Does the image have a visible watermark, logo overlay, or stock-photo site branding stamped on it?

Return ONLY JSON, no other text:
{"relevant": true/false, "hasWatermark": true/false, "description": "one short sentence describing what's actually in the image"}`;

  try {
    const raw = await callGeminiVision(prompt, imageBuffer, 'image/jpeg', 600);
    if (!raw) return { relevant: true, hasWatermark: false, description: 'unchecked (vision call returned nothing)', checked: false };
    try {
      return { ...extractJson(raw), checked: true };
    } catch (parseErr) {
      // A truncated/malformed response must never be treated as a silent
      // "unchecked -> accept" -- that already let one real rejection
      // through in testing (the model correctly said relevant:false, then
      // got cut off, and the catch-all defaulted it back to accepted).
      // Salvage whatever fields did come through via regex before giving
      // up, and default a genuinely unparseable response to REJECT, not
      // accept -- fail closed on a safety check, not open.
      const relevantMatch = raw.match(/"relevant"\s*:\s*(true|false)/);
      const watermarkMatch = raw.match(/"hasWatermark"\s*:\s*(true|false)/);
      if (relevantMatch) {
        return {
          relevant: relevantMatch[1] === 'true',
          hasWatermark: watermarkMatch ? watermarkMatch[1] === 'true' : false,
          description: `salvaged from truncated response (${parseErr.message})`,
          checked: true
        };
      }
      console.warn(`[vision-check] response was unparseable and had no salvageable fields, rejecting rather than silently accepting: ${parseErr.message}`);
      return { relevant: false, hasWatermark: false, description: `rejected -- verification response unparseable (${parseErr.message})`, checked: true };
    }
  } catch (err) {
    console.warn(`[vision-check] verification call failed, treating as unchecked: ${err.message}`);
    return { relevant: true, hasWatermark: false, description: `unchecked (${err.message})`, checked: false };
  }
}
