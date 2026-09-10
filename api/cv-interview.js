export const config = { maxDuration: 60 };

// Generating 30-50 questions in one giant AI call was the real cause of the
// 504s — a single request that large can genuinely take 60-90s+. Instead we
// fire 4 smaller, category-scoped requests IN PARALLEL, so total wall-clock
// time is roughly the slowest single category, not the sum of all of them.

function roleNote(targetRole) {
  return targetRole && targetRole.trim()
    ? `\n\nThe candidate is targeting this role: ${targetRole.trim()}. Tailor questions and framing toward that target role specifically.`
    : '';
}

function buildPrompts(cvText, targetRole) {
  const note = roleNote(targetRole);
  const cv = `CV / RESUME CONTENT:\n${cvText.trim()}${note}`;
  const base = 'You are an expert interview coach reading a real CV. This works for ANY field or industry (software, finance, marketing, design, operations, sales, etc.) — infer the candidate\'s field and seniority entirely from the CV. Never invent specific facts (numbers, company names, outcomes) not in the CV — if a model answer needs a specific example the CV doesn\'t give, write "[reference a specific project/metric here]" instead of making one up. Respond with a JSON object only: {"questions":[{"category":"<cat>","question":"...","answer":"..."}]}. No markdown, no code fences, no commentary.';

  return [
    {
      category: 'Technical',
      system: `${base}\n\nGenerate ONE "Technical" question for every distinct skill, tool, technology, or project listed on the CV (a CV listing 12 skills/projects should yield 12+ questions — do not cap it artificially, but do not pad with duplicates either). "answer" is a model answer referencing specific CV details.`,
      user: `${cv}\n\nGenerate the Technical questions now, category:"Technical" for every item.`,
      maxOut: 4500,
    },
    {
      category: 'Behavioral',
      system: `${base}\n\nGenerate 5-8 "Behavioral" questions (teamwork, conflict, leadership, failure, growth). "answer" is a suggested STAR-method answer drawing on real experience from the CV where possible.`,
      user: `${cv}\n\nGenerate the Behavioral questions now, category:"Behavioral".`,
      maxOut: 1800,
    },
    {
      category: 'Gap',
      system: `${base}\n\nGenerate 1-3 "Gap" questions about a career gap, career switch, or a skill commonly expected in this field but missing from the CV. If nothing stands out, ask 1-2 reasonable "why this transition / why this next step" questions instead. "answer" is suggested framing for an honest, confident response.`,
      user: `${cv}\n\nGenerate the Gap questions now, category:"Gap".`,
      maxOut: 900,
    },
    {
      category: 'AskInterviewer',
      system: `${base}\n\nGenerate 3-5 "AskInterviewer" questions the candidate can ask back, informed by their seniority and field. "answer" is a one-sentence note on why it's smart to ask (not a literal answer).`,
      user: `${cv}\n\nGenerate the AskInterviewer questions now, category:"AskInterviewer".`,
      maxOut: 900,
    },
  ];
}

async function callChatModel({ system, user, maxOut, useGroq }) {
  if (useGroq) {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) throw new Error('GROQ_API_KEY not configured');
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        temperature: 0.4,
        max_tokens: maxOut,
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error?.message || `Groq error ${res.status}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        max_completion_tokens: maxOut,
        reasoning_effort: 'low',
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error?.message || `API error ${res.status}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }
}

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

    const prompts = buildPrompts(cvText, targetRole);
    const settled = await Promise.allSettled(
      prompts.map(p => callChatModel({ system: p.system, user: p.user, maxOut: p.maxOut, useGroq }))
    );

    let allQuestions = [];
    const failed = [];

    settled.forEach((r, i) => {
      const cat = prompts[i].category;
      if (r.status !== 'fulfilled') { failed.push(`${cat} (${r.reason?.message || 'failed'})`); return; }
      try {
        const raw = r.value.replace(/```json|```/g, '').trim();
        const obj = JSON.parse(raw);
        const qs = Array.isArray(obj) ? obj : obj.questions;
        if (Array.isArray(qs) && qs.length) allQuestions = allQuestions.concat(qs);
        else failed.push(`${cat} (empty response)`);
      } catch (e) {
        failed.push(`${cat} (invalid JSON)`);
      }
    });

    if (allQuestions.length === 0) {
      return new Response(JSON.stringify({ error: `Generation failed for all sections: ${failed.join('; ')}` }), { status: 502 });
    }

    const payload = { questions: allQuestions };
    if (failed.length) payload.warning = `Some sections didn't generate: ${failed.join('; ')}. Showing what succeeded.`;

    return new Response(JSON.stringify({ text: JSON.stringify(payload) }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), { status: 500 });
  }
}