// Shared free-tier LLM access (Groq primary, Gemini fallback). Never calls
// Claude/Anthropic — used by script-writer.js, research.js, and the vision
// relevance check in visual-sources.js.

const GROQ_MODEL = 'llama-3.3-70b-versatile';
// Groq deprecated meta-llama/llama-4-scout-17b-16e-instruct on 2026-07-17
// (confirmed via console.groq.com/docs/deprecations) -- every vision call
// was 404ing and falling through to Gemini's scarce 20-requests/day quota.
// qwen/qwen3.6-27b is Groq's current vision-capable replacement.
const GROQ_VISION_MODEL = 'qwen/qwen3.6-27b';
const GEMINI_MODEL = 'gemini-2.5-flash';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Groq key indices and Gemini, once confirmed exhausted for the whole day
// (not a transient per-minute burst), stay exhausted for the rest of this
// process -- a single daily video-generation run makes 10+ callFreeLLM
// calls (research, narration retries, metadata, per-short scripts...), and
// without this every one of them was re-discovering the same daily 429
// from scratch instead of skipping straight to the next provider.
const groqKeyDailyExhausted = new Set();
let geminiDailyExhausted = false;

// Per-minute burst limits (Groq's TPM cap) observed clearing anywhere from
// under a second up to ~20-30s in production; a 15s ceiling was tight
// enough that a real 17.24s burst wait missed it and jumped straight to
// key rotation / Gemini instead of just waiting the extra two seconds out.
// 65s comfortably covers a full per-minute window without approaching the
// multi-minute/hour waits that really do mean "move on instead."
const INLINE_RETRY_MAX_SEC = 65;

/** Multiple free Groq accounts (GROQ_API_KEY, GROQ_API_KEY_2, ...) so a
 * quota-exhausted key fails over to the next one immediately instead of
 * falling all the way through to Gemini's much scarcer 20-requests/day
 * cap -- added after a single day of heavy debugging exhausted both a
 * single Groq key's full daily allowance and Gemini's. */
function getGroqKeys() {
  const keys = [process.env.GROQ_API_KEY];
  for (let i = 2; process.env[`GROQ_API_KEY_${i}`]; i++) keys.push(process.env[`GROQ_API_KEY_${i}`]);
  return keys.filter(Boolean);
}

// Confirmed live 2026-07-29: every callFreeLLM call always started at key
// #1, so key #2 sat completely idle for the whole run as long as key #1's
// 429s kept clearing within INLINE_RETRY_MAX_SEC (they always do -- that's
// the common TPM-burst case, not the rare daily-cap case that actually
// escalates keys) -- one run logged a dozen+ short 429-wait cycles back to
// back while a second Groq account's separate quota went completely
// unused. Round-robining which key each independent call starts on spreads
// load across both keys' quotas instead of hammering just one.
let groqRoundRobinIndex = 0;
function nextGroqStartIndex(keyCount) {
  if (keyCount <= 1) return 0;
  const idx = groqRoundRobinIndex % keyCount;
  groqRoundRobinIndex = (groqRoundRobinIndex + 1) % keyCount;
  return idx;
}

/** Groq's 429 body states exactly how long to wait ("Please try again in
 * 9.27s" for a per-minute burst limit, or "35m27s" for the daily cap). A
 * fixed 3s guess was too short for real bursts (still 429ing) and, worse,
 * didn't distinguish "clears in a few seconds" from "clears in 35
 * minutes" -- retrying the latter just burns time before falling through
 * to Gemini anyway, and Gemini's free tier is a scarce 20 requests/day,
 * not something to reach for after an avoidable wasted round-trip. */
function parseRetryDelaySeconds(text) {
  const minSec = text.match(/try again in\s+(\d+)m([\d.]+)s/i);
  if (minSec) return parseInt(minSec[1], 10) * 60 + parseFloat(minSec[2]);
  const secOnly = text.match(/try again in\s+([\d.]+)s\b/i);
  if (secOnly) return parseFloat(secOnly[1]);
  // Short bursts (typically well under a second) come back as "455ms",
  // not "0.455s" -- confirmed live. Missing this format meant a trivial
  // sub-second wait was treated as "unknown, don't retry" and fell
  // straight through to the Gemini fallback, needlessly spending a
  // request out of Gemini's scarce 20/day quota on what a half-second
  // retry would have solved.
  const msOnly = text.match(/try again in\s+([\d.]+)ms\b/i);
  if (msOnly) return parseFloat(msOnly[1]) / 1000;
  return null;
}

/** Back-to-back calls in one run (research scoring, narration, retries,
 * segmentation, metadata, per-short scripts...) can add up within Groq's
 * free-tier tokens-per-minute window. Only worth retrying inline when the
 * stated wait is short (a real burst that'll clear soon); a long wait
 * (the daily cap) moves to the next configured key immediately, and only
 * falls through to Gemini once every Groq key is exhausted. */
// `keysTried` counts how many distinct keys this call has already tried
// (regardless of starting index, now that calls can start anywhere via
// nextGroqStartIndex) -- stops once every configured key has had a shot,
// instead of the old plain `keyIndex >= keys.length` check, which assumed
// index 0 was always the start and would give up early (or never revisit
// key 0) once a non-zero start index was introduced.
async function callGroq(prompt, maxTokens, keyIndex = 0, attempt = 1, keysTried = 0) {
  const keys = getGroqKeys();
  if (keys.length === 0 || keysTried >= keys.length) return null;
  // Already confirmed out for the day this run -- don't spend a round trip
  // re-learning that, just move on to the next key immediately.
  if (groqKeyDailyExhausted.has(keyIndex)) {
    return callGroq(prompt, maxTokens, (keyIndex + 1) % keys.length, 1, keysTried + 1);
  }
  const apiKey = keys[keyIndex];

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
  if (res.status === 429) {
    const body = await res.text();
    const delaySec = parseRetryDelaySeconds(body);
    // Up to 3 inline waits for short TPM bursts (was 1) -- confirmed live
    // that back-to-back script calls stack into ~10-15s waits that a single
    // retry clears, while a second burst right after still needs another.
    if (delaySec !== null && delaySec <= INLINE_RETRY_MAX_SEC && attempt < 4) {
      console.warn(`[llm] Groq 429, waiting ${delaySec.toFixed(1)}s then retry (attempt ${attempt}/3, key #${keyIndex + 1})`);
      await sleep(delaySec * 1000 + 500);
      return callGroq(prompt, maxTokens, keyIndex, attempt + 1, keysTried);
    }
    groqKeyDailyExhausted.add(keyIndex);
    if (keysTried + 1 < keys.length) {
      const nextIndex = (keyIndex + 1) % keys.length;
      console.warn(`[llm] Groq key #${keyIndex + 1} exhausted (${delaySec ?? 'unknown'}s wait), trying key #${nextIndex + 1}`);
      return callGroq(prompt, maxTokens, nextIndex, 1, keysTried + 1);
    }
    throw new Error(`Groq API error 429 on all ${keys.length} configured key(s) (wait too long to retry inline, ${delaySec ?? 'unknown'}s): ${body}`);
  }
  if (!res.ok) throw new Error(`Groq API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? null;
}

async function callGemini(prompt, maxTokens, attempt = 1) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  // Already confirmed out for the day this run -- the free tier's daily cap
  // (20 requests/day) won't clear until Google's reset, so don't burn
  // another round trip (and possibly another 20-40s of retry sleeps)
  // rediscovering that on every remaining callFreeLLM in this run.
  if (geminiDailyExhausted) return null;
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
  // Free-tier RPM 429s often say "Please retry in 30s" -- previously we
  // threw immediately and the whole long-script attempt died with
  // "No free LLM available" even though a short wait would have worked.
  // BUT Gemini suggests a short retryDelay even when the real cause is the
  // free tier's daily request cap (quotaId ...PerDay...), which won't
  // clear in 30s no matter how long we wait -- confirmed live (Daily
  // generation run on 2026-07-21: every callFreeLLM burned a full 20-40s
  // sleeping and retrying a quota that was actually day-scoped). Only
  // treat the delay as inline-retryable when the violation itself isn't
  // day-scoped.
  if (res.status === 429) {
    const body = await res.text();
    const isDailyCap = /PerDay/i.test(body);
    if (isDailyCap) {
      geminiDailyExhausted = true;
      throw new Error(`Gemini API error 429 (daily quota exhausted, not retrying further this run): ${body}`);
    }
    if (attempt < 3) {
      const delaySec = parseRetryDelaySeconds(body) ?? 20;
      if (delaySec <= INLINE_RETRY_MAX_SEC) {
        console.warn(`[llm] Gemini 429, waiting ${delaySec.toFixed(1)}s then retry (attempt ${attempt}/2)`);
        await sleep(delaySec * 1000 + 500);
        return callGemini(prompt, maxTokens, attempt + 1);
      }
    }
    throw new Error(`Gemini API error 429: ${body}`);
  }
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

/** Calls Groq first (fast, generous free tier), falls back to Gemini. */
export async function callFreeLLM(prompt, maxTokens = 2048) {
  const startIndex = nextGroqStartIndex(getGroqKeys().length);
  const viaGroq = await callGroq(prompt, maxTokens, startIndex).catch((err) => {
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

async function callGroqVision(prompt, imageBuffer, mimeType, maxTokens, keyIndex = 0, attempt = 1) {
  const keys = getGroqKeys();
  if (keyIndex >= keys.length) return null;
  const apiKey = keys[keyIndex];

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
      // qwen/qwen3.6-27b is a REASONING model: without this it emits a long
      // <think>…</think> block BEFORE the JSON, which at a normal max_tokens
      // budget pushes the actual answer past the cutoff -> truncated/no JSON
      // -> the relevance/never-people check fails closed and rejects good
      // media (confirmed live 2026-08-13: a 1000+ char reasoning preamble on
      // a trivial image). "none" makes it answer directly. If a future Groq
      // vision model ignores this field, it's simply a no-op.
      reasoning_effort: 'none',
      max_tokens: maxTokens
    })
  });
  if (res.status === 429) {
    const body = await res.text();
    const delaySec = parseRetryDelaySeconds(body);
    if (delaySec !== null && delaySec <= INLINE_RETRY_MAX_SEC && attempt < 2) {
      await sleep(delaySec * 1000 + 500);
      return callGroqVision(prompt, imageBuffer, mimeType, maxTokens, keyIndex, attempt + 1);
    }
    if (keyIndex + 1 < keys.length) {
      console.warn(`[llm] Groq vision key #${keyIndex + 1} exhausted (${delaySec ?? 'unknown'}s wait), trying key #${keyIndex + 2}`);
      return callGroqVision(prompt, imageBuffer, mimeType, maxTokens, keyIndex + 1, 1);
    }
    throw new Error(`Groq vision API error 429 on all ${keys.length} configured key(s) (wait too long to retry inline, ${delaySec ?? 'unknown'}s): ${body}`);
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
  // Reasoning models (e.g. Groq's qwen3.6) can wrap their answer after a
  // <think>…</think> block. Even with reasoning disabled at the API level,
  // strip any such block defensively so its prose (which may contain braces
  // in an example) can't be mistaken for the real JSON payload.
  const withoutThink = String(text).replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*/i, '');
  const fenced = withoutThink.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : withoutThink;
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
