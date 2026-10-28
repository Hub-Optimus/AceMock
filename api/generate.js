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

    // useGroq=true → free Groq, false → OpenAI gpt-6-luna (paid, better quality)
    if (useGroq) {
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) return new Response(JSON.stringify({ error: 'GROQ_API_KEY not configured' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          temperature: 0.5,
          max_tokens: max_tokens || 4096,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: e.error?.message || `Groq error ${res.status}` }), { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      const data = await res.json();
      return new Response(JSON.stringify({ text: data.choices?.[0]?.message?.content || '' }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });

    } else {
      // OpenAI gpt-6-luna — quiz generation (paid tier)
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

      const openaiUser = user + '\n\nRespond with a single JSON object only, in the exact shape {"questions":[...]}. No markdown, no commentary.';

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-6-luna',
          max_completion_tokens: max_tokens || 4096,
          reasoning_effort: 'low',
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: openaiUser }],
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: e.error?.message || `OpenAI error ${res.status}` }), { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      const data = await res.json();
      return new Response(JSON.stringify({ text: data.choices?.[0]?.message?.content || '' }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}