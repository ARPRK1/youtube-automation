// Writes video scripts using a free-tier LLM (Groq or Gemini). Never calls
// Claude/Anthropic here — that's the whole point of this pipeline.

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GEMINI_MODEL = 'gemini-2.5-flash';
const MIN_LONG_WORDS = 1300;

async function callGroq(prompt, maxTokens) {
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
  if (!res.ok) throw new Error(`Groq API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? null;
}

async function callGemini(prompt, maxTokens) {
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
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

/** Calls Groq first (fast, generous free tier), falls back to Gemini. */
async function callFreeLLM(prompt, maxTokens = 2048) {
  const viaGroq = await callGroq(prompt, maxTokens).catch((err) => {
    console.warn(`[script-writer] Groq failed, falling back to Gemini: ${err.message}`);
    return null;
  });
  if (viaGroq) return viaGroq;

  const viaGemini = await callGemini(prompt, maxTokens).catch((err) => {
    console.warn(`[script-writer] Gemini failed too: ${err.message}`);
    return null;
  });
  if (viaGemini) return viaGemini;

  throw new Error('No free LLM available: set GROQ_API_KEY and/or GEMINI_API_KEY');
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error(`No JSON object found in LLM output: ${text.slice(0, 300)}`);
  return JSON.parse(raw.slice(start, end + 1));
}

function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Plain-text narration call, kept separate from JSON metadata generation —
 * models reliably undershoot requested word counts when also asked to
 * produce structured JSON in the same response. Retries once with a more
 * forceful prompt if the first attempt comes in short. */
async function generateNarration(niche, topic) {
  const basePrompt = (extra) => `Write ONLY a spoken YouTube video narration script, no title, no headers, no markdown, no stage directions — plain spoken text only, for a "${niche.name}" channel (audience: ${niche.audience}) about: "${topic}".
Start with a strong hook in the first two sentences. Structure: hook, context/setup, 3-4 main body sections with specific detail and examples, then a close with a call to action to subscribe.
It MUST be at least ${MIN_LONG_WORDS} words — this is a hard requirement. ${extra}`;

  let narration = await callFreeLLM(basePrompt(''), 3000);
  if (wordCount(narration) < MIN_LONG_WORDS) {
    narration = await callFreeLLM(
      basePrompt(`Your previous attempt was too short. Elaborate significantly more in each body section with extra detail, stories, and examples until you clearly exceed ${MIN_LONG_WORDS} words.`),
      3800
    );
  }
  return narration.trim();
}

/**
 * Writes one long-form script (~1500 words) for the given niche/topic.
 * Returns { title, description, tags, narration, chapters: [{title}] }
 */
export async function writeLongScript(niche, topic) {
  const narration = await generateNarration(niche, topic);
  if (wordCount(narration) < MIN_LONG_WORDS * 0.7) {
    throw new Error(`Generated narration is too short (${wordCount(narration)} words) — refusing to proceed with a thin script`);
  }

  const metaPrompt = `Here is a YouTube video narration script:
"""
${narration.slice(0, 4000)}
"""
Return ONLY a JSON object, no other text, matching this shape exactly:
{
  "title": "SEO-friendly title under 60 characters",
  "description": "2-3 sentence YouTube description",
  "tags": ["tag1", "tag2", ... up to 15 tags],
  "chapters": [{"title": "Hook"}, {"title": "..."}]
}`;
  const rawMeta = await callFreeLLM(metaPrompt, 800);
  const meta = extractJson(rawMeta);
  return { ...meta, narration };
}

/**
 * Writes N short-form hooks (<=60s narration, ~120-150 words each) derived
 * from an existing long script's topic, for cutting into YouTube Shorts.
 */
export async function writeShortScripts(niche, topic, longScript, count) {
  const prompt = `You are writing YouTube Shorts scripts for the "${niche.name}" niche.
The related long-form video is titled "${longScript.title}" and is about: "${topic}".

Write ${count} standalone short-form video scripts (9:16 vertical, under 60 seconds each, 120-150 words each), each with its own hook in the first sentence, that tease or highlight a specific, punchy fact or moment related to the topic. Each must work standalone without having seen the long video.

Return ONLY a JSON object, no other text:
{
  "shorts": [
    {"title": "short title under 100 chars", "narration": "120-150 word spoken script"},
    ...
  ]
}`;

  const raw = await callFreeLLM(prompt, 2000);
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed.shorts) || parsed.shorts.length < count) {
    throw new Error(`Expected ${count} shorts, got ${parsed.shorts?.length ?? 0}`);
  }
  return parsed.shorts.slice(0, count);
}
