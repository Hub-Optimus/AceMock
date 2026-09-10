export const config = { maxDuration: 60 };

const SYSTEM_PROMPT = 'You are a precise OCR transcription engine for a study app. Transcribe EVERY visible word in the image, verbatim, in reading order — this is a full transcription task, not a summary. Never shorten, paraphrase, condense, or skip any text, even if the photo is angled, has glare, or is partially blurry — do your best on unclear characters rather than dropping them. Preserve structure exactly as shown: headings, bold/underlined terms, bullet points as "- ", numbered lists as written, and tables as pipe-separated rows. If the image contains a labeled diagram or chart alongside text, transcribe all surrounding text fully, then add one line describing the diagram\'s labels/axes/arrows factually. Output ONLY the transcribed content — no preamble like "Here is the transcription", no commentary on image quality, no meta-text of any kind.';

async function tryOpenAI(imageBase64, mediaType, timeoutMs) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'gpt-5-mini',
        max_completion_tokens: 4096,
        reasoning_effort: 'low',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: [
            { type: 'text', text: 'Transcribe this image.' },
            { type: 'image_url', image_url: { url: `data:${mediaType || 'image/jpeg'};base64,${imageBase64}` } },
          ]},
        ],
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error?.message || `OpenAI error ${res.status}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

async function tryGroq(imageBase64, mediaType) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw new Error('GROQ_API_KEY not configured');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen/qwen3.8-27b',
      temperature: 0.2,
      max_tokens: 4096,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: [
          { type: 'text', text: 'Transcribe this image.' },
          { type: 'image_url', image_url: { url: `data:${mediaType || 'image/jpeg'};base64,${imageBase64}` } },
        ]},
      ],
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message || `Groq error ${res.status}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' },
    });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { imageBase64, mediaType } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'Missing imageBase64' }), { status: 400 });
    }

    let text;
    try {
      // OpenAI is the primary (better OCR quality); give it 25s. If it's
      // slow or fails, fall back to Groq's vision model, which runs on much
      // faster inference hardware — this keeps the whole request well
      // inside Vercel's function time limit either way.
      text = await tryOpenAI(imageBase64, mediaType, 8000);
    } catch (openaiErr) {
      try {
        text = await tryGroq(imageBase64, mediaType);
      } catch (groqErr) {
        return new Response(JSON.stringify({
          error: `Both providers failed. OpenAI: ${openaiErr.message}. Groq: ${groqErr.message}`,
        }), { status: 502 });
      }
    }

    return new Response(JSON.stringify({ text }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), { status: 500 });
  }
}