-- Court Rotation Generator: secure Supabase schema for https://wochetemsnrysnjrgoed.supabase.co
-- Review in the Supabase SQL editor before running. This file has not been executed.
-- Required extension: pg_cron (enabled by this migration with CREATE EXTENSION IF NOT EXISTS).

create table if not exists public.court_rotation_sessions (
  session_code text primary key,
  host_key text not null check (length(host_key) >= 32),
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

alter table public.court_rotation_sessions enable row level security;

revoke all on table public.court_rotation_sessions from public;
grant select (session_code, payload, updated_at, expires_at) on table public.court_rotation_sessions to anon, authenticated;
grant insert (session_code, host_key, payload, updated_at) on table public.court_rotation_sessions to anon, authenticated;
grant update (session_code, host_key, payload, updated_at) on table public.court_rotation_sessions to anon, authenticated;
grant all on table public.court_rotation_sessions to service_role;

create index if not exists court_rotation_sessions_expires_at_idx
  on public.court_rotation_sessions (expires_at);

drop policy if exists "CRG sessions exact-code read" on public.court_rotation_sessions;
drop policy if exists "CRG sessions host insert" on public.court_rotation_sessions;
drop policy if exists "CRG sessions host update" on public.court_rotation_sessions;

create policy "CRG sessions exact-code read"
on public.court_rotation_sessions
for select
to anon, authenticated
using (
  session_code = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-crg-session-code', '')
  and expires_at > now()
);

create policy "CRG sessions host insert"
on public.court_rotation_sessions
for insert
to anon, authenticated
with check (
  session_code = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-crg-session-code', '')
  and host_key = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-crg-host-key', '')
  and length(host_key) >= 32
);

create policy "CRG sessions host update"
on public.court_rotation_sessions
for update
to anon, authenticated
using (
  session_code = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-crg-session-code', '')
  and host_key = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-crg-host-key', '')
  and expires_at > now()
)
with check (
  session_code = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-crg-session-code', '')
  and host_key = coalesce(current_setting('request.headers', true)::jsonb ->> 'x-crg-host-key', '')
  and length(host_key) >= 32
);

create extension if not exists pg_cron;
select cron.schedule(
  'crg-expired-session-cleanup',
  '0 * * * *',
  $$delete from public.court_rotation_sessions where expires_at <= now()$$
);
