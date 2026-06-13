export const config = { runtime: 'nodejs', maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    });

    const { system, user, max_tokens, useGroq } = body;
    if (!user) return res.status(400).json({ error: 'Missing content' });

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (useGroq) {
      // ── GROQ (free, non-streaming) ─────────────────
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'GROQ_API_KEY not configured' });

      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          temperature: 0.5,
          max_tokens: max_tokens || 4096,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      });
      if (!groqRes.ok) {
        const e = await groqRes.json().catch(() => ({}));
        return res.status(502).json({ error: e.error?.message || `Groq error ${groqRes.status}` });
      }
      const data = await groqRes.json();
      return res.status(200).json({ text: data.choices?.[0]?.message?.content || '' });

    } else {
      // ── CLAUDE HAIKU — STREAMING ───────────────────
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

      const upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: max_tokens || 4096,
          stream: true,
          system: system,
          messages: [{ role: 'user', content: user }],
        }),
      });

      if (!upstream.ok) {
        const e = await upstream.json().catch(() => ({}));
        return res.status(502).json({ error: e.error?.message || `API error ${upstream.status}` });
      }

      // Reassemble streamed text then return as single JSON
      let fullText = '';
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              fullText += parsed.delta.text;
            }
          } catch(e) { /* skip */ }
        }
      }

      return res.status(200).json({ text: fullText });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
}
