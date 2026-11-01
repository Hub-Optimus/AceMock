// Shared guard for AI endpoints (underscore = not a public route).
// 1) Caller must be logged in (valid Supabase session token).
// 2) Per-user daily limit, counted atomically in Postgres via acemock_bump().
// Limits can be changed in Vercel env vars: LIMIT_PREMIUM_PER_DAY (default 5),
// LIMIT_FREE_PER_DAY (default 40). Needs SUPABASE_SERVICE_ROLE_KEY for limits.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dkelsqxwbqbaircknggt.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRrZWxzcXh3YnFiYWlyY2tuZ2d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyODM1MDEsImV4cCI6MjA5Njg1OTUwMX0.WAnmiFKgpBGN3HES5y29jX3XOpHhFpgo2LiCc_Qg9Ro';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}

// Returns null when the request may proceed, otherwise a ready Response.
export async function guard(req, { premium }) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Please log in to use AI features.' }, 401);

  let user;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return json({ error: 'Your session expired. Please log in again.' }, 401);
    user = await r.json();
  } catch (e) {
    return json({ error: 'Could not verify your login. Please try again.' }, 503);
  }
  if (!user || !user.id) return json({ error: 'Please log in to use AI features.' }, 401);

  // Daily limit (fails open if the quota table/function is not set up yet)
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return null;
  const limit = premium
    ? parseInt(process.env.LIMIT_PREMIUM_PER_DAY || '5', 10)
    : parseInt(process.env.LIMIT_FREE_PER_DAY || '40', 10);
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/acemock_bump`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user: user.id, p_kind: premium ? 'premium' : 'free', p_limit: limit }),
    });
    if (!r.ok) return null;
    const out = await r.json();
    if (out && out.allowed === false) {
      return json({
        error: premium
          ? `Daily limit reached (${limit} OpenAI generations per day). Try the free Groq model, or come back tomorrow.`
          : `Daily limit reached (${limit} per day). Please come back tomorrow.`,
      }, 429);
    }
  } catch (e) { /* fail open */ }
  return null;
}
