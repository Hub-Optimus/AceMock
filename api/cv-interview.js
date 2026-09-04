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
    const { cvText, targetRole, useGroq } = await req.json();
    if (!cvText || cvText.trim().length < 50) {
      return new Response(JSON.stringify({ error: 'CV text is too short or missing' }), { status: 400 });
    }

    const systemPrompt = `You are an expert interview coach. Read the candidate's CV/resume and produce a structured interview-prep guide personalized to it — this works for ANY field or industry (software, finance, marketing, design, operations, sales, etc.), not just one domain. Infer the candidate's field, seniority, and focus areas entirely from the CV content.

Produce the guide in this exact structure:

## About This Candidate
2-3 sentences: their field, seniority level, and main strengths, based only on what's in the CV.

## Likely Technical / Domain Questions
6-8 questions specific to the tools, skills, projects, or domain knowledge listed on the CV. After each question, give a model answer that references specific details from the CV (project names, tools, achievements, metrics).

## Behavioral Questions
5-6 common behavioral questions (teamwork, conflict, leadership, failure, growth). For each, give a suggested answer using the STAR method, drawing on real experiences from the CV where possible.

## Questions About Gaps or Weak Points
If the CV shows a career gap, career switch, or a skill commonly expected in this field but missing from the CV, list 2-3 questions the candidate should prepare for, with suggested framing for honest, confident answers. If nothing stands out, note that briefly instead.

## Smart Questions to Ask the Interviewer
4-5 thoughtful questions the candidate can ask back, informed by their seniority and field.

Rules: Output clean markdown only, no preamble. Never invent specific facts (numbers, company names, project outcomes) that aren't in the CV — where a model answer needs a specific example the CV doesn't provide, write "[reference a specific project/metric here]" instead of making one up.`;

    const roleNote = targetRole && targetRole.trim()
      ? `\n\nThe candidate is targeting this role: ${targetRole.trim()}. Tailor the technical/domain questions and framing toward that target role specifically.`
      : '';

    const userPrompt = `CV / RESUME CONTENT:\n${cvText.trim()}${roleNote}\n\nGenerate the interview-prep guide now.`;

    // ── GROQ ROUTE (free) ──────────────────────
    if (useGroq) {
      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey) {
        return new Response(JSON.stringify({ error: 'GROQ_API_KEY not configured' }), { status: 500 });
      }
      const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          temperature: 0.4,
          max_tokens: 4096,
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        }),
      });
      if (!groqRes.ok) {
        const e = await groqRes.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: e.error?.message || `Groq error ${groqRes.status}` }), { status: 502 });
      }
      const groqData = await groqRes.json();
      const text = groqData.choices?.[0]?.message?.content || '';
      return new Response(JSON.stringify({ text }), {
        status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    // ── CLAUDE ROUTE (paid, better quality) ────
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500 });
    }
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: e.error?.message || `API error ${res.status}` }), { status: 502 });
    }
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    return new Response(JSON.stringify({ text }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), { status: 500 });
  }
}