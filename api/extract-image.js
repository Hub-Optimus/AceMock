export const config = { maxDuration: 60 };

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
    const { imageBase64, mediaType } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'Missing imageBase64' }), { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'OPENAI_API_KEY not configured' }), { status: 500 });
    }

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        max_completion_tokens: 4096,
        messages: [
          {
            role: 'system',
            content: 'You transcribe study material from images for an exam-prep app. Read the image and output ONLY the content, in clean plain text — preserve headings, bullet points, numbered lists, and tables (pipe-separated). Do not add commentary, labels, or a preamble. If the image is a diagram/chart with little or no text, describe what it shows in 3-4 factual sentences instead.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe this image.' },
              { type: 'image_url', image_url: { url: `data:${mediaType || 'image/jpeg'};base64,${imageBase64}` } },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: e.error?.message || `API error ${res.status}` }), { status: 502 });
    }
    const data = await res.json();
    return new Response(JSON.stringify({ text: data.choices?.[0]?.message?.content || '' }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), { status: 500 });
  }
}