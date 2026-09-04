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

    const systemPrompt = `You are an expert interview coach. Read the candidate's CV/resume and generate a full interview question bank personalized to it — this works for ANY field or industry (software, finance, marketing, design, operations, sales, etc.), not just one domain. Infer the candidate's field, seniority, and focus areas entirely from the CV content.

Respond with a JSON object only, shaped exactly like:
{"questions": [{"category": "Technical", "question": "...", "answer": "..."}, ...]}

Scale the TOTAL number of questions to how much the CV actually contains — do not target a fixed count. A short, fresher-level CV with few projects might only support 15-20 solid questions. A detailed CV with many roles, projects, and skills can easily support 30-50+. Never pad with generic or repetitive questions just to hit a number — every question must map to something specific and real in the CV (a named skill, tool, project, role, or achievement).

Categories:
- "Technical" — one or more questions per distinct skill, tool, technology, or project listed on the CV (so a CV listing 12 skills/projects should yield roughly 12+ Technical questions). "answer" is a model answer referencing specific details from the CV.
- "Behavioral" — 5-8 common behavioral questions (teamwork, conflict, leadership, failure, growth). "answer" is a suggested answer using the STAR method, drawing on real experiences from the CV where possible.
- "Gap" — 1-3 questions about a career gap, career switch, or a skill commonly expected in this field but missing from the CV. If nothing stands out, ask 1-2 reasonable "why this transition / why this next step" questions instead. "answer" is suggested framing for an honest, confident response.
- "AskInterviewer" — 3-5 thoughtful questions the candidate can ask the interviewer, informed by their seniority and field. "answer" here is a one-sentence note on why this question is smart to ask (not a literal answer from the candidate).

Rules: Never invent specific facts (numbers, company names, project outcomes) that aren't in the CV — where a model answer needs a specific example the CV doesn't provide, write "[reference a specific project/metric here]" instead of making one up. Keep each "answer" to 2-5 sentences, concrete and usable, not generic filler. Output valid JSON only — no markdown, no code fences, no commentary.`;

    const roleNote = targetRole && targetRole.trim()
      ? `\n\nThe candidate is targeting this role: ${targetRole.trim()}. Tailor the Technical questions and framing toward that target role specifically.`
      : '';

    const userPrompt = `CV / RESUME CONTENT:\n${cvText.trim()}${roleNote}\n\nGenerate the JSON question bank now. Base the total count on how much this specific CV supports, following the category guidance exactly — do not aim for a round number.`;

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
          max_tokens: 8000,
          response_format: { type: 'json_object' },
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

    // ── OPENAI ROUTE (paid, better quality) ────
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), { status: 500 });
    }
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        max_completion_tokens: 8000,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: e.error?.message || `API error ${res.status}` }), { status: 502 });
    }
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || '';
    return new Response(JSON.stringify({ text }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), { status: 500 });
  }
}