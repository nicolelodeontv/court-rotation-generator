-- Court Rotation Generator: secure live session publishing.
-- Reconstructed from the deployed production state on project
-- wochetemsnrysnjrgoed, migration 20260928132803_secure_court_rotation_sessions.
--
-- This migration is intentionally separate from PR #23. PR #23 is the
-- client-side rollout; this file records the database contract already
-- deployed to production.

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

revoke all on table public.court_rotation_sessions
  from public, anon, authenticated;

grant select (
  session_code,
  payload,
  updated_at,
  expires_at
)
on table public.court_rotation_sessions
to anon, authenticated;

grant all on table public.court_rotation_sessions
  to service_role;

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

create or replace function public.publish_session(
  p_code text,
  p_host_key text,
  p_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
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

  if not exists (select 1 from public.court_rotation_sessions where session_code = p_code)
     and (select count(*) from public.court_rotation_sessions) >= 2000 then
    raise exception 'Capacity reached.';
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
$function$;

revoke execute on function public.publish_session(text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.publish_session(text, text, jsonb)
  to anon;
