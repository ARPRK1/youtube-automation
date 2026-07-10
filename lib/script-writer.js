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

function contextBlock(context) {
  if (!context || context.length === 0) return '';
  return `\nToday's real related headlines (use these for factual grounding — do not invent facts, names, or numbers beyond general knowledge and what's stated here):\n${context.map((c) => `- ${c}`).join('\n')}\n`;
}

/** Plain-text narration call, kept separate from JSON metadata generation —
 * models reliably undershoot requested word counts when also asked to
 * produce structured JSON in the same response. Retries once with a more
 * forceful prompt if the first attempt comes in short. */
async function generateNarration(niche, topic, context) {
  const basePrompt = (extra) => `Write ONLY a spoken YouTube video narration script, no title, no headers, no markdown, no stage directions — plain spoken text only, for a "${niche.name}" channel (audience: ${niche.audience}) about: "${topic}".
${contextBlock(context)}
Start with a strong hook in the first two sentences that creates curiosity or urgency. Structure: hook, context/setup, 3-4 main body sections with specific detail and examples, then a close with a call to action to subscribe.
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

const METADATA_SHAPE = `{
  "title": "curiosity-driven, SEO-friendly title under 60 characters that would make someone tap on it",
  "description": "an opening hook line (1 sentence) to pull readers in, then 2-3 sentences summarizing the video, written to rank well in YouTube search",
  "tags": ["tag1", "tag2", ... up to 15 SEO tags, mix of broad and specific],
  "hashtags": ["3 to 6 short trending-style hashtags WITHOUT the # symbol, relevant to the topic and to India where relevant"],
  "chapters": [{"title": "Hook"}, {"title": "..."}]
}`;

function assembleDescription(base, hashtags) {
  const tagLine = hashtags.map((h) => `#${h.replace(/^#/, '').replace(/\s+/g, '')}`).join(' ');
  return `${base}\n\n${tagLine}`.trim();
}

/**
 * Writes one long-form script for the given niche/topic (as picked by
 * lib/trends.js). `topicInfo` is { topic, context, source }.
 * Returns { title, description, tags, hashtags, narration, chapters }
 */
export async function writeLongScript(niche, topicInfo) {
  const { topic, context = [] } = topicInfo;
  const narration = await generateNarration(niche, topic, context);
  if (wordCount(narration) < MIN_LONG_WORDS * 0.7) {
    throw new Error(`Generated narration is too short (${wordCount(narration)} words) — refusing to proceed with a thin script`);
  }

  const metaPrompt = `Here is a YouTube video narration script:
"""
${narration.slice(0, 4000)}
"""
Return ONLY a JSON object, no other text, matching this shape exactly:
${METADATA_SHAPE}`;
  const rawMeta = await callFreeLLM(metaPrompt, 900);
  const meta = extractJson(rawMeta);
  const hashtags = Array.isArray(meta.hashtags) && meta.hashtags.length > 0 ? meta.hashtags : [niche.name.replace(/\s+/g, '')];
  return {
    ...meta,
    hashtags,
    description: assembleDescription(meta.description, hashtags),
    narration
  };
}

/**
 * Writes N short-form hooks (<=60s narration, ~120-150 words each) derived
 * from an existing long script's topic, for cutting into YouTube Shorts.
 * Every short forcibly gets #Shorts in its hashtags — YouTube uses that tag
 * to route uploads into the Shorts shelf, so it's not left to the model.
 */
export async function writeShortScripts(niche, topicInfo, longScript, count) {
  const { topic, context = [] } = topicInfo;
  const prompt = `You are writing YouTube Shorts scripts for the "${niche.name}" niche.
The related long-form video is titled "${longScript.title}" and is about: "${topic}".
${contextBlock(context)}
Write ${count} standalone short-form video scripts (9:16 vertical, under 60 seconds each, 120-150 words each), each with its own strong hook in the first sentence, that tease or highlight a specific, punchy fact or moment related to the topic. Each must work standalone without having seen the long video.

Return ONLY a JSON object, no other text:
{
  "shorts": [
    {
      "title": "short, punchy title under 100 chars",
      "narration": "120-150 word spoken script",
      "hashtags": ["3 to 5 short trending-style hashtags WITHOUT the # symbol"]
    },
    ...
  ]
}`;

  const raw = await callFreeLLM(prompt, 2200);
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed.shorts) || parsed.shorts.length < count) {
    throw new Error(`Expected ${count} shorts, got ${parsed.shorts?.length ?? 0}`);
  }
  return parsed.shorts.slice(0, count).map((s) => {
    const hashtags = [...new Set([...(s.hashtags || []), 'Shorts'])];
    return {
      ...s,
      hashtags,
      description: assembleDescription(s.narration.split(/[.!?]/)[0], hashtags)
    };
  });
}
