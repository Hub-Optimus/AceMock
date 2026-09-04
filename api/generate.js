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
    const { system, user, max_tokens, useGroq } = await req.json();
    if (!user) return new Response(JSON.stringify({ error: 'Missing content' }), { status: 400 });

    // useGroq=true → free Groq (fresh questions), false → Claude Haiku (paid, better quality)
    if (useGroq) {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) return new Response(JSON.stringify({ error: 'GROQ_API_KEY not configured' }), { status: 500 });

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          temperature: 0.5,
          max_tokens: max_tokens || 4096,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: e.error?.message || `Groq error ${res.status}` }), { status: 502 });
      }
      const data = await res.json();
      return new Response(JSON.stringify({ text: data.choices?.[0]?.message?.content || '' }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });

    } else {
      // Claude Haiku 3.5 — quiz generation
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500 });

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: max_tokens || 4096,
          system: system,
          messages: [{ role: 'user', content: user }],
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: e.error?.message || `API error ${res.status}` }), { status: 502 });
      }
      const data = await res.json();
      return new Response(JSON.stringify({ text: data.content?.[0]?.text || '' }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), { status: 500 });
  }
}