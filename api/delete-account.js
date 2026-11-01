export const config = { maxDuration: 30 };

// Permanently deletes the signed-in user's data and login.
// Needs SUPABASE_SERVICE_ROLE_KEY in Vercel env vars (server-side only —
// never put this key in index.html). The caller proves who they are with
// their own Supabase access token; we only ever delete THAT user.

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://dkelsqxwbqbaircknggt.supabase.co';
const TABLES = ['acemock_attempts', 'acemock_notes', 'acemock_usage'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceKey) return json({ error: 'Account deletion is not configured on the server yet.' }, 500);

    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Please sign in first.' }, 401);

    // Who is this token for?
    const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${token}` },
    });
    if (!who.ok) return json({ error: 'Your session expired. Please sign in again.' }, 401);
    const user = await who.json();
    if (!user?.id) return json({ error: 'Could not verify your account.' }, 401);

    const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

    // 1) Delete the user's rows
    for (const t of TABLES) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?user_id=eq.${encodeURIComponent(user.id)}`, {
        method: 'DELETE', headers: admin,
      });
      if (!r.ok) {
        const msg = await r.text().catch(() => '');
        return json({ error: `Could not delete data (${t}). ${msg}`.slice(0, 300) }, 500);
      }
    }

    // 2) Delete the login itself
    const del = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${encodeURIComponent(user.id)}`, {
      method: 'DELETE', headers: admin,
    });
    if (!del.ok) {
      const msg = await del.text().catch(() => '');
      return json({ error: `Could not delete login. ${msg}`.slice(0, 300) }, 500);
    }

    return json({ ok: true });
  } catch (err) {
    return json({ error: err.message || 'Unexpected error' }, 500);
  }
}
