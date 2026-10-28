export const config = { maxDuration: 30 };

// Scores ONE typed answer against the ideal answer for a single CV
// interview question. Separate from cv-interview.js (which only
// generates the question bank) so a single feedback request stays
// fast and simple — no multi-category fan-out needed here.

function buildPrompt({ question, idealAnswer, userAnswer, category }) {
  const system = `You are an experienced interview coach giving honest, specific, encouraging feedback. You will be shown an interview question, a model/ideal answer, and a candidate's actual typed answer. Score the candidate's answer against the IDEAL ANSWER'S substance — not exact wording, paraphrasing and different examples are fine if they cover the same ground. Be honest: a vague, incomplete, or off-target answer should score low even if well-written.

Respond with a JSON object only: {"score": <integer 0-10>, "feedback": "<2-4 sentences: what the answer got right, what it missed or should add, kept specific to this question>"}. No markdown, no code fences, no commentary outside the JSON.`;

  const user = `CATEGORY: ${category || 'General'}

QUESTION:
${question}

IDEAL ANSWER (for reference, candidate never saw this):
${idealAnswer || '(no reference answer provided — judge on general interview quality for this question)'}

CANDIDATE'S ACTUAL ANSWER:
${userAnswer}

Score the candidate's answer now.`;

  return { system, user };
}

async function callOpenAI(system, user, timeoutMs) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: 'gpt-6-luna',
        max_completion_tokens: 500,
        reasoning_effort: 'low',
        response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error?.message || `OpenAI error ${res.status}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timer);
  }
}

async function callGroq(system, user) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) throw new Error('GROQ_API_KEY not configured');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      temperature: 0.3,
      max_tokens: 500,
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
    const { question, idealAnswer, userAnswer, category, useGroq } = await req.json();
    if (!question || !userAnswer || !userAnswer.trim()) {
      return new Response(JSON.stringify({ error: 'Missing question or answer' }), { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }

    const { system, user } = buildPrompt({ question, idealAnswer, userAnswer, category });

    let raw;
    if (useGroq) {
      raw = await callGroq(system, user);
    } else {
      try {
        raw = await callOpenAI(system, user, 12000);
      } catch (openaiErr) {
        raw = await callGroq(system, user);
      }
    }

    const cleaned = raw.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      throw new Error('Could not parse feedback response');
    }
    const score = Math.max(0, Math.min(10, Number(parsed.score) || 0));
    const feedback = parsed.feedback || 'No feedback text returned.';

    return new Response(JSON.stringify({ score, feedback }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }
}
