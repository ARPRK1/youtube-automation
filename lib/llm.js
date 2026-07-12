// Shared free-tier LLM access (Groq primary, Gemini fallback). Never calls
// Claude/Anthropic — used by script-writer.js, research.js, and the vision
// relevance check in visual-sources.js.

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const GEMINI_MODEL = 'gemini-2.5-flash';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Back-to-back calls in one run (research scoring, narration, retries,
 * segmentation, metadata, per-short scripts...) can add up within Groq's
 * free-tier tokens-per-minute window. A 429 there usually clears in a
 * couple seconds, so retry once before giving up to the Gemini fallback
 * (which has its own, different, reliability trade-offs). */
async function callGroq(prompt, maxTokens, attempt = 1) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens: maxTokens
    })
  });
  if (res.status === 429 && attempt < 2) {
    await sleep(3000);
    return callGroq(prompt, maxTokens, attempt + 1);
  }
  if (!res.ok) throw new Error(`Groq API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? null;
}

async function callGemini(prompt, maxTokens, attempt = 1) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens }
    })
  });
  // 503 here is Google's own server-side overload ("high demand"), not a
  // quota issue -- usually clears within a few seconds.
  if (res.status === 503 && attempt < 3) {
    await sleep(2000 * attempt);
    return callGemini(prompt, maxTokens, attempt + 1);
  }
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

/** Calls Groq first (fast, generous free tier), falls back to Gemini. */
export async function callFreeLLM(prompt, maxTokens = 2048) {
  const viaGroq = await callGroq(prompt, maxTokens).catch((err) => {
    console.warn(`[llm] Groq failed, falling back to Gemini: ${err.message}`);
    return null;
  });
  if (viaGroq) return viaGroq;

  const viaGemini = await callGemini(prompt, maxTokens).catch((err) => {
    console.warn(`[llm] Gemini failed too: ${err.message}`);
    return null;
  });
  if (viaGemini) return viaGemini;

  throw new Error('No free LLM available: set GROQ_API_KEY and/or GEMINI_API_KEY');
}

async function callGroqVision(prompt, imageBuffer, mimeType, maxTokens, attempt = 1) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: GROQ_VISION_MODEL,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}` } }
        ]
      }],
      max_tokens: maxTokens
    })
  });
  if (res.status === 429 && attempt < 2) {
    await sleep(3000);
    return callGroqVision(prompt, imageBuffer, mimeType, maxTokens, attempt + 1);
  }
  if (!res.ok) throw new Error(`Groq vision API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? null;
}

async function callGeminiVision(prompt, imageBuffer, mimeType, maxTokens) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: mimeType, data: imageBuffer.toString('base64') } }
        ]
      }],
      generationConfig: { maxOutputTokens: maxTokens }
    })
  });
  if (!res.ok) throw new Error(`Gemini vision API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

/**
 * Vision call, Groq's Llama 4 Scout first (much more generous free-tier
 * limits than Gemini's flat 20-requests/day cap -- a full daily batch
 * needs dozens of vision checks, which would exhaust Gemini's quota
 * within the first video), Gemini as a fallback if Groq is unavailable.
 * Used for the Stage 3 relevance check: does this downloaded image
 * actually show what the segment needs? Returns null (caller treats as
 * "unchecked", doesn't block the pipeline) if neither is available.
 */
export async function callVisionLLM(prompt, imageBuffer, mimeType = 'image/jpeg', maxTokens = 300) {
  const viaGroq = await callGroqVision(prompt, imageBuffer, mimeType, maxTokens).catch((err) => {
    console.warn(`[llm] Groq vision failed, falling back to Gemini: ${err.message}`);
    return null;
  });
  if (viaGroq) return viaGroq;

  return callGeminiVision(prompt, imageBuffer, mimeType, maxTokens).catch((err) => {
    console.warn(`[llm] Gemini vision failed too: ${err.message}`);
    return null;
  });
}

export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = Math.min(...['{', '['].map((c) => (raw.indexOf(c) === -1 ? Infinity : raw.indexOf(c))));
  const isArray = raw[start] === '[';
  const end = isArray ? raw.lastIndexOf(']') : raw.lastIndexOf('}');
  if (!isFinite(start) || end === -1) throw new Error(`No JSON found in LLM output: ${text.slice(0, 300)}`);
  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    // LLMs frequently leave a trailing comma before a closing ] or } --
    // strip it and retry once before giving up.
    const repaired = slice.replace(/,(\s*[\]}])/g, '$1');
    return JSON.parse(repaired);
  }
}
