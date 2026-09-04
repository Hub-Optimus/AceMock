export const config = { runtime: 'edge' };

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
    const body = await req.json();
    const topicTitle = body.topicTitle || 'PM Module';
    const masaiImages = body.masaiImages || [];
    const useGroq = body.useGroq === true;

    // Support both old format (masaiText/transcriptText) and new sources[] format
    let masaiText = '';
    let transcriptText = '';
    if (body.sources && Array.isArray(body.sources)) {
      // New format: sources array [{label, text}]
      const parts = body.sources.map(s => '=== ' + s.label + ' ===\n' + s.text).join('\n\n');
      masaiText = parts; // use masaiText as the combined text block
    } else {
      masaiText = body.masaiText || '';
      transcriptText = body.transcriptText || '';
    }

    if (!masaiText && !transcriptText) {
      return new Response(JSON.stringify({ error: 'Provide at least one input' }), { status: 400 });
    }

    // ── GROQ ROUTE (free testing) ──────────────────────
    if (useGroq) {
      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey) {
        return new Response(JSON.stringify({ error: 'GROQ_API_KEY not configured' }), {
          status: 500, headers: { 'Content-Type': 'application/json' }
        });
      }

      const groqPrompt = 'Topic: ' + topicTitle + '\n\n'
        + (masaiText ? '=== MASAI MATERIAL ===\n' + masaiText + '\n\n' : '')
        + (transcriptText ? '=== TRANSCRIPT ===\n' + transcriptText : '')
        + '\n\nGenerate structured PM study notes. For each concept include: What it is, Why its used, Real-life examples (Indian companies preferred), How it impacts PM decisions, From the material (exact case study), Exam angle. End with a Quick Revision Table.';

      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + groqKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          temperature: 0.4,
          max_tokens: 4096,
          messages: [{ role: 'user', content: groqPrompt }]
        }),
      });

      if (!groqRes.ok) {
        const e = await groqRes.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: e.error ? e.error.message : 'Groq error ' + groqRes.status }), {
          status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
      const groqData = await groqRes.json();
      const notes = groqData.choices && groqData.choices[0] ? groqData.choices[0].message.content : '';
      return new Response(JSON.stringify({ notes }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    // ── CLAUDE ROUTE ───────────────────────────────────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500 });
    }

    const systemPrompt = `You are an expert PM study notes creator for the BITSoM x Masai PM program.

For every concept produce notes in this format:

## [Concept Name]
**What it is** — One clear sentence definition.
**Why it's used** — The problem it solves.
**Real-life examples** — 2-3 examples. Use Indian companies where relevant.
**How it impacts PM decisions** — How a PM uses this day-to-day.
**From the material** — The specific example/case study from the sources.
> **Exam angle:** What type of question will this become? What trap do students fall into?
---
For framework diagrams reproduce as ASCII. End with a QUICK REVISION TABLE. Output clean markdown only.`;

    const contentParts = [];
    let textBlock = 'Topic: ' + topicTitle + '\n\n';
    if (masaiText) textBlock += '=== MASAI OFFICIAL MATERIAL ===\n' + masaiText + '\n\n';
    if (transcriptText) textBlock += '=== LECTURE TRANSCRIPT ===\n' + transcriptText + '\n\n';
    textBlock += 'Generate comprehensive enhanced notes covering all concepts from the above material.';
    contentParts.push({ type: 'text', text: textBlock });

    if (masaiImages && masaiImages.length > 0) {
      contentParts.push({ type: 'text', text: 'Diagram pages from PDF (reproduce as ASCII):' });
      for (const img of masaiImages.slice(0, 6)) {
        contentParts.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.data } });
      }
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: contentParts }],
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: errData.error ? errData.error.message : 'API error ' + res.status }), {
        status: 502, headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await res.json();
    const notes = data.content && data.content[0] ? data.content[0].text : '';

    return new Response(JSON.stringify({ notes }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), {
      status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}