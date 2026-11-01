-- AceMock: run once in Supabase → SQL Editor → New query → Run.
-- Safe to run again (idempotent).

-- 1) Row Level Security: each user can only touch their own rows
alter table acemock_attempts enable row level security;
alter table acemock_notes    enable row level security;
alter table acemock_usage    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['acemock_attempts','acemock_notes','acemock_usage'] loop
    execute format('drop policy if exists "own rows" on %I', t);
    execute format(
      'create policy "own rows" on %I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

-- 2) Daily AI quota (server-side; only the service role can touch it)
create table if not exists acemock_quota (
  user_id uuid not null,
  day     date not null default ((now() at time zone 'utc')::date),
  kind    text not null,
  n       int  not null default 0,
  primary key (user_id, day, kind)
);
alter table acemock_quota enable row level security;  -- no policies = no client access

create or replace function acemock_bump(p_user uuid, p_kind text, p_limit int)
returns json language plpgsql security definer set search_path = public as $$
declare cur int;
begin
  insert into acemock_quota (user_id, day, kind, n)
  values (p_user, (now() at time zone 'utc')::date, p_kind, 1)
  on conflict (user_id, day, kind) do update set n = acemock_quota.n + 1
  returning n into cur;
  return json_build_object('allowed', cur <= p_limit, 'used', cur);
end $$;

revoke all on function acemock_bump(uuid, text, int) from public, anon, authenticated;
grant execute on function acemock_bump(uuid, text, int) to service_role;

-- 3) In-app "Report AI content" (Google Play requirement)
create table if not exists acemock_reports (
  id         bigserial primary key,
  user_id    uuid not null,
  kind       text,
  sample     text,
  created_at timestamptz not null default now()
);
alter table acemock_reports enable row level security;
drop policy if exists "insert own report" on acemock_reports;
create policy "insert own report" on acemock_reports
  for insert to authenticated with check (auth.uid() = user_id);
-- You read reports in Supabase → Table Editor → acemock_reports
