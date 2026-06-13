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
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { masaiText, transcriptText, topicTitle, masaiImages } = await req.json();

    if (!transcriptText && !masaiText) {
      return new Response(JSON.stringify({ error: 'Provide at least one input — Masai PDF or transcript' }), { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500 });
    }

    const systemPrompt = `You are an expert PM study notes creator for the BITSoM × Masai "Product Management with Generative & Agentic AI" program. You produce structured, exam-ready notes that help students understand AND apply concepts — not just memorise them.

For every concept in the material, produce notes in this exact format:

## [Concept Name]

**What it is** — One clear sentence definition.

**Why it's used** — The problem it solves. Why does this concept exist?

**Real-life examples** — 2-3 examples from the real world BEYOND the lecture material. Use Indian companies where relevant.

**How it impacts PM decisions** — Specifically how a PM uses this in their day-to-day work.

**From the lecture/material** — The specific example or case study used in the source material.

> **Exam angle:** What type of question will this become? What trap do students fall into? What should they watch for?

---

DIAGRAM RULE: If you see an image of a framework diagram (pyramid, funnel, matrix, hierarchy, flow), reproduce it as a clean ASCII text diagram. Example for Maslow pyramid:
\`\`\`
        ┌─────────────────┐
        │ Self-actualisation │  ← Personal growth
        ├──────────────────┤
        │     Esteem        │  ← Status, achievement
        ├──────────────────┤
        │    Belonging      │  ← Community, connection
        ├──────────────────┤
        │     Safety        │  ← Security, stability
        ├──────────────────┤
        │  Physiological    │  ← Food, water, shelter
        └──────────────────┘
\`\`\`
Do this for every framework diagram you encounter. Skip decorative images, logos, headers.

RULES:
- Cover EVERY concept from all sources — miss nothing
- Merge overlapping content — don't repeat
- Use Masai PDF for framework accuracy, transcript for real examples
- Keep each section tight — no padding
- End with a QUICK REVISION TABLE summarising all frameworks
- Output clean markdown only`;

    // Build message content — text + images
    const contentParts = [];

    // Add text content
    let textBlock = `Topic: ${topicTitle || 'PM Module'}\n\n`;
    if (masaiText) textBlock += `=== MASAI OFFICIAL MATERIAL ===\n${masaiText.slice(0, 7000)}\n\n`;
    if (transcriptText) textBlock += `=== LECTURE TRANSCRIPT ===\n${transcriptText.slice(0, 7000)}\n\n`;
    textBlock += `Generate comprehensive enhanced notes covering all concepts from the above material.`;

    contentParts.push({ type: 'text', text: textBlock });

    // Add images if provided (vision pass)
    if (masaiImages && Array.isArray(masaiImages) && masaiImages.length > 0) {
      contentParts.push({
        type: 'text',
        text: `\n\nThe following are page images from the Masai PDF. For each framework diagram (pyramid, funnel, matrix, hierarchy, model), reproduce it as an ASCII diagram in the notes. Skip decorative images.`
      });
      for (const img of masaiImages.slice(0, 8)) { // max 8 images
        contentParts.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType || 'image/jpeg',
            data: img.data
          }
        });
      }
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: contentParts }],
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: errData.error?.message || `API error ${res.status}` }), {
        status: 502, headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await res.json();
    const notes = data.content?.[0]?.text || '';

    return new Response(JSON.stringify({ notes }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
