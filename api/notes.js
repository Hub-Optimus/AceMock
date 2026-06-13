export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  try {
    const { sources, topicTitle } = await req.json();

    if (!sources || !sources.length) {
      return new Response(JSON.stringify({ error: 'No source files provided' }), { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500 });
    }

    const systemPrompt = `You are an expert PM study notes creator for the BITSoM x Masai PM program.

Produce concise exam-ready notes. For every concept:

## [Concept Name]
**What it is** — One sentence.
**Why it's used** — Problem it solves.
**Real-life examples** — 2 Indian company examples.
**How it impacts PM decisions** — Specific PM use.
**From the material** — Exact case study from sources.
> **Exam angle:** What trap do students fall into?
---
Reproduce framework diagrams as ASCII. Output clean markdown only. Be concise — cover all concepts but keep each section tight.`;

    let textBlock = `Topic: ${topicTitle || 'PM Module'}\n\n`;
    for (const src of sources) {
      textBlock += `=== ${src.label} ===\n${src.text}\n\n`;
    }
    textBlock += `Produce ONE unified set of notes covering all concepts above.`;

    // Call Anthropic with streaming — Edge runtime keeps connection alive
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 3000,
        stream: true,
        system: systemPrompt,
        messages: [{ role: 'user', content: textBlock }],
      }),
    });

    if (!upstream.ok) {
      const err = await upstream.json().catch(() => ({}));
      return new Response(
        JSON.stringify({ error: err.error?.message || `API error ${upstream.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      );
    }

    // TRUE streaming: pipe Anthropic SSE → transform to plain text chunks → browser
    // Edge runtime supports this natively — no timeout because data flows continuously
    const encoder = new TextEncoder();
    let buffer = '';

    const stream = new ReadableStream({
      async start(controller) {
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const data = line.slice(6).trim();
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
                  buffer += parsed.delta.text;
                  // Send each text chunk directly to browser as it arrives
                  controller.enqueue(encoder.encode(parsed.delta.text));
                }
              } catch(e) { /* skip malformed */ }
            }
          }
        } finally {
          controller.close();
        }
      }
    });

    // Return streaming plain-text response
    // Frontend accumulates chunks and shows notes when stream ends
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message || 'Unexpected error' }),
      { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
