import { guard, json } from './_guard.js';
export const config = { runtime: 'edge' };

const SYSTEM_PROMPT = `You are an expert study-notes creator for students and professionals.

For every concept produce notes in this format:

## [Concept Name]
**What it is** — One clear sentence definition.
**Why it's used** — The problem it solves.
**Real-life examples** — 2-3 examples. Use Indian companies where relevant.
**How it is applied** — How a practitioner uses this day-to-day.
**From the material** — The specific example/case study from the sources.
> **Exam angle:** What type of question will this become? What trap do students fall into?
---
For framework diagrams reproduce as ASCII. End with a QUICK REVISION TABLE. Output clean markdown only.`;


// Streams the model's text straight to the browser as text/plain.
// Streaming keeps the Edge function alive (no 504 on long generations).
function streamChat(upstream) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader();
      let buf = '';
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            const l = line.trim();
            if (!l.startsWith('data:')) continue;
            const payload = l.slice(5).trim();
            if (payload === '[DONE]') continue;
            try {
              const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
              if (delta) controller.enqueue(enc.encode(delta));
            } catch (e) {}
          }
        }
      } catch (e) {
        controller.enqueue(enc.encode('\n\n[Generation interrupted — please try again]'));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' },
    });
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json();
    const topicTitle = String(body.topicTitle || 'Study Notes').slice(0, 200);
    const useGroq = body.useGroq === true;

    let material = '';
    let transcriptText = '';
    if (Array.isArray(body.sources)) {
      material = body.sources.map(s => '=== ' + String(s.label || 'Source') + ' ===\n' + String(s.text || '')).join('\n\n');
    } else {
      material = String(body.masaiText || '');
      transcriptText = String(body.transcriptText || '');
    }

    if (!material && !transcriptText) return json({ error: 'Provide at least one input' }, 400);
    if (material.length + transcriptText.length > 120000) return json({ error: 'Input is too large. Please use a smaller section.' }, 413);

    const blocked = await guard(req, { premium: !useGroq });
    if (blocked) return blocked;

    const userPrompt = 'Topic: ' + topicTitle + '\n\n'
      + (material ? '=== COURSE MATERIAL ===\n' + material + '\n\n' : '')
      + (transcriptText ? '=== TRANSCRIPT ===\n' + transcriptText + '\n\n' : '')
      + 'Generate comprehensive study notes covering all concepts from the above material. End with a Quick Revision Table.';

    // ── FREE ROUTE (Groq) ──────────────────────────────
    if (useGroq) {
      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey) return json({ error: 'GROQ_API_KEY not configured' }, 500);
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + groqKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          temperature: 0.4,
          max_tokens: 4096,
          stream: true,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return json({ error: e.error ? e.error.message : 'Groq error ' + res.status }, 502);
      }
      return streamChat(res);
    }

    // ── PREMIUM ROUTE (OpenAI gpt-6-luna) ──────────────
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return json({ error: 'OPENAI_API_KEY not configured' }, 500);
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-6-luna',
        max_completion_tokens: 6000,
        reasoning_effort: 'low',
        stream: true,
        messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return json({ error: e.error?.message || 'OpenAI error ' + res.status }, 502);
    }
    return streamChat(res);

  } catch (err) {
    return json({ error: err.message || 'Unexpected error' }, 500);
  }
}
