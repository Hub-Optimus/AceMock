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
    const { sources, topicTitle, masaiImages } = await req.json();

    if (!sources || !sources.length) {
      return new Response(JSON.stringify({ error: 'No source files provided' }), { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500 });
    }

    const systemPrompt = `You are an expert PM study notes creator for the BITSoM × Masai "Product Management with Generative & Agentic AI" program.

You will receive multiple source files on the same topic — they may include pre-read material, post-lecture notes, and live transcripts. Your job is to read ALL of them, understand how they relate, and produce ONE unified set of enhanced study notes. Do not repeat the same concept multiple times. Merge intelligently.

Source priority when content conflicts:
- MASAI OFFICIAL MATERIAL → authoritative framework definitions
- POST-LECTURE material → refinements and additional depth  
- LECTURE TRANSCRIPT → live examples, instructor nuances, real case studies
- ADDITIONAL MATERIAL → supplementary context

For every concept produce notes in this format:

## [Concept Name]

**What it is** — One clear sentence definition.

**Why it's used** — The problem it solves.

**Real-life examples** — 2-3 examples beyond the source material. Use Indian companies where relevant.

**How it impacts PM decisions** — How a PM uses this day-to-day.

**From the material** — The specific example/case study from the sources.

> **Exam angle:** What type of question will this become? What trap do students fall into?

---

For framework diagrams (pyramid, funnel, matrix, hierarchy) reproduce as ASCII:
\`\`\`
  ┌─────────────────────┐
  │   Self-actualisation │
  ├─────────────────────┤
  │       Esteem         │
  └─────────────────────┘
\`\`\`

End with a QUICK REVISION TABLE of all frameworks. Output clean markdown only.`;

    // Build user message content
    const contentParts = [];

    let textBlock = `Topic: ${topicTitle || 'PM Module'}\n\nYou have ${sources.length} source file(s) to merge:\n\n`;
    for (const src of sources) {
      textBlock += `=== ${src.label} ===\n${src.text}\n\n`;
    }
    textBlock += `Produce ONE unified set of enhanced notes from all the above sources.`;
    contentParts.push({ type: 'text', text: textBlock });

    // Add diagram images if vision is enabled and images provided
    if (masaiImages && masaiImages.length > 0) {
      contentParts.push({ type: 'text', text: `\nDiagram pages from the PDF (reproduce as ASCII diagrams in notes):` });
      for (const img of masaiImages.slice(0, 6)) {
        contentParts.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.data } });
      }
    }

    // Route to Groq if selected (free, for testing)
    if (useGroq) {
      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey) return new Response(JSON.stringify({ error: 'GROQ_API_KEY not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      const groqPrompt = `Topic: ${topicTitle || 'PM Module'}\n\n${masaiText ? '=== MASAI MATERIAL ===\n' + masaiText + '\n\n' : ''}${transcriptText ? '=== TRANSCRIPT ===\n' + transcriptText : ''}\n\nGenerate structured PM study notes covering all concepts. For each concept: What it is, Why it's used, Real-life examples (Indian companies), PM impact, From the material, Exam angle. End with a Quick Revision Table.`;
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': \`Bearer \${groqKey}\`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'llama-3.3-70b-versatile', temperature: 0.4, max_tokens: 4096, messages: [{ role: 'user', content: groqPrompt }] }),
      });
      if (!groqRes.ok) {
        const e = await groqRes.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: e.error?.message || \`Groq error \${groqRes.status}\` }), { status: 502, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
      }
      const groqData = await groqRes.json();
      const notes = groqData.choices?.[0]?.message?.content || '';
      return new Response(JSON.stringify({ notes }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: contentParts }],
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: errData.error?.message || `API error ${res.status}` }), { status: 502 });
    }

    const data = await res.json();
    const notes = data.content?.[0]?.text || '';

    return new Response(JSON.stringify({ notes }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), { status: 500 });
  }
}
