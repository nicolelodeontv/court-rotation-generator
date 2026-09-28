-- Court Rotation Generator: secure Supabase schema for https://wochetemsnrysnjrgoed.supabase.co
-- Review in the Supabase SQL editor before running. This file has not been executed.
-- pgcrypto is required here for SHA-256 host-key hashing. pg_cron is intentionally separate.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.court_rotation_sessions (
  session_code text primary key
    check (session_code ~ '^CRG-[A-HJ-NP-Z2-9]{10}$'),
  host_key text not null
    check (host_key ~ '^[0-9a-f]{64}$'),
  payload jsonb not null
    check (octet_length(payload::text) <= 200000),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days')
);

alter table public.court_rotation_sessions enable row level security;

-- Supabase projects may grant table-wide access to anon/authenticated by default.
-- Revoke by role name before adding the minimum Data API grants.
revoke all on table public.court_rotation_sessions from public, anon, authenticated;

grant select (session_code, payload, updated_at, expires_at)
  on table public.court_rotation_sessions to anon, authenticated;
grant all on table public.court_rotation_sessions to service_role;

create index if not exists court_rotation_sessions_expires_at_idx
  on public.court_rotation_sessions (expires_at);

drop policy if exists "CRG sessions exact-code read"
  on public.court_rotation_sessions;
drop policy if exists "CRG sessions host insert"
  on public.court_rotation_sessions;
drop policy if exists "CRG sessions host update"
  on public.court_rotation_sessions;

create policy "CRG sessions exact-code read"
on public.court_rotation_sessions
for select
to anon, authenticated
using (
  session_code = coalesce(
    current_setting('request.headers', true)::jsonb ->> 'x-crg-session-code',
    ''
  )
  and expires_at > now()
);

-- Host writes are intentionally performed by the publish_session() RPC.
-- No anon/authenticated INSERT or UPDATE grants/policies are exposed directly.

create or replace function public.publish_session(
  p_code text,
  p_host_key text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host_key_hash text;
begin
  if p_code is null or p_code !~ '^CRG-[A-HJ-NP-Z2-9]{10}$' then
    raise exception 'Invalid session code.';
  end if;

  if p_host_key is null or length(p_host_key) < 32 then
    raise exception 'Invalid host key.';
  end if;

  if p_payload is null then
    raise exception 'Payload is required.';
  end if;

  if octet_length(p_payload::text) > 200000 then
    raise exception 'Payload too large.';
  end if;

  v_host_key_hash := encode(
    extensions.digest(p_host_key, 'sha256'),
    'hex'
  );

  insert into public.court_rotation_sessions (
    session_code,
    host_key,
    payload,
    updated_at
  )
  values (
    p_code,
    v_host_key_hash,
    p_payload,
    now()
  )
  on conflict (session_code) do update
  set
    payload = excluded.payload,
    updated_at = excluded.updated_at
  where public.court_rotation_sessions.host_key = excluded.host_key
    and public.court_rotation_sessions.expires_at > now();

  if not found then
    raise exception 'Invalid host key or expired session.';
  end if;

  return true;
end;
$$;

revoke execute on function public.publish_session(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_session(text, text, jsonb)
  to anon;
