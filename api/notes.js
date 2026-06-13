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
    const { sources, topicTitle, masaiImages } = req.json ? await req.json() : await new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { reject(e); } });
    });

    if (!sources || !sources.length) {
      return res.status(400).json({ error: 'No source files provided' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
    }

    const systemPrompt = `You are an expert PM study notes creator for the BITSoM × Masai "Product Management with Generative & Agentic AI" program.

You will receive multiple source files on the same topic. Produce ONE unified set of enhanced study notes. Do not repeat the same concept multiple times. Merge intelligently.

Source priority when content overlaps:
- MASAI OFFICIAL MATERIAL / LMS PRE-READ → authoritative framework definitions
- POST-LECTURE material → refinements and additional depth
- LECTURE TRANSCRIPT → live examples, instructor nuances, real case studies

For every concept use this format:

## [Concept Name]

**What it is** — One clear sentence definition.

**Why it's used** — The problem it solves.

**Real-life examples** — 2-3 examples beyond the source material. Use Indian companies where relevant.

**How it impacts PM decisions** — How a PM uses this day-to-day.

**From the material** — The specific example/case study from the sources.

> **Exam angle:** What type of question will this become? What trap do students fall into?

---

For framework diagrams (pyramid, funnel, matrix) reproduce as ASCII art.

End with a QUICK REVISION TABLE of all frameworks covered. Output clean markdown only.`;

    let textBlock = `Topic: ${topicTitle || 'PM Module'}\n\nYou have ${sources.length} source file(s) to merge:\n\n`;
    for (const src of sources) {
      textBlock += `=== ${src.label} ===\n${src.text}\n\n`;
    }
    textBlock += `Produce ONE unified set of enhanced notes from all the above sources.`;

    const contentParts = [{ type: 'text', text: textBlock }];

    if (masaiImages && masaiImages.length > 0) {
      contentParts.push({ type: 'text', text: '\nDiagram pages from PDF (reproduce as ASCII in notes):' });
      for (const img of masaiImages.slice(0, 6)) {
        contentParts.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.data } });
      }
    }

    // ── STREAMING REQUEST ──────────────────────────────
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        stream: true,
        system: systemPrompt,
        messages: [{ role: 'user', content: contentParts }],
      }),
    });

    if (!upstream.ok) {
      const errData = await upstream.json().catch(() => ({}));
      return res.status(502).json({ error: errData.error?.message || `API error ${upstream.status}` });
    }

    // Stream SSE from Anthropic → reassemble → send as single JSON response
    // This keeps the frontend simple (no SSE parsing needed there)
    // while preventing Vercel timeout (data flows continuously)
    let fullText = '';
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();

    // Set headers for streaming-friendly response
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Transfer-Encoding', 'chunked');

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
            fullText += parsed.delta.text;
          }
        } catch(e) { /* skip malformed chunks */ }
      }
    }

    return res.status(200).json({ notes: fullText });

  } catch (err) {
    return res.status(500).json({ error: err.message || 'Unexpected error' });
  }
}
