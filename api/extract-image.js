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
    const { imageBase64, mediaType } = await req.json();
    if (!imageBase64) {
      return new Response(JSON.stringify({ error: 'Missing imageBase64' }), { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500 });
    }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        system: 'You transcribe study material from images for an exam-prep app. Read the image and output ONLY the content, in clean plain text — preserve headings, bullet points, numbered lists, and tables (pipe-separated). Do not add commentary, labels, or a preamble. If the image is a diagram/chart with little or no text, describe what it shows in 3-4 factual sentences instead.',
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
            { type: 'text', text: 'Transcribe this image.' },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      return new Response(JSON.stringify({ error: e.error?.message || `API error ${res.status}` }), { status: 502 });
    }
    const data = await res.json();
    return new Response(JSON.stringify({ text: data.content?.[0]?.text || '' }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message || 'Unexpected error' }), { status: 500 });
  }
}