-- Court Rotation Generator: secure live session publishing.
-- Reconstructed from the deployed production state on project
-- wochetemsnrysnjrgoed, migration 20260928132803_secure_court_rotation_sessions.
--
-- This migration records the database contract already deployed to production.
-- The publish_session definition below preserves the later deployed
-- pg_get_functiondef() output. The supabase_migrations.schema_migrations row
-- for version 20260928132803 contains the earlier equivalent function text.
-- The deployed definition is authoritative for this source record.
-- Expired-session cleanup is recorded separately in the subsequent pg_cron
-- migration, matching the cleanup job already present in production.
--
-- Fresh-replay compatibility:
-- 20260928030000_court_rotation_sessions may create this table first with the
-- legacy four-column schema. The guarded schema repair below makes this
-- historical migration replayable after that legacy migration. It is
-- idempotent and does not change an already-secure table.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.court_rotation_sessions (
  session_code text primary key
    check (session_code ~ '^CRG-[A-HJ-NP-Z2-9]{10}$'),
  host_key text not null
    check (host_key ~ '^[0-9a-f]{64}$'),
  payload jsonb not null
    check (octet_length(payload::text) <= 200000),
  updated_at timestamptz not null default (now()),
  expires_at timestamptz not null default (now() + interval '7 days')
);

-- 20260928030000 creates the table without expires_at and without the
-- secure-format checks. Repair that legacy shape before the policy/function
-- below references expires_at or relies on the secure column contract.
alter table public.court_rotation_sessions
  add column if not exists expires_at timestamptz not null
    default (now() + interval '7 days');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.court_rotation_sessions'::regclass
      and conname = 'court_rotation_sessions_session_code_check'
  ) then
    alter table public.court_rotation_sessions
      add constraint court_rotation_sessions_session_code_check
      check (session_code ~ '^CRG-[A-HJ-NP-Z2-9]{10}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.court_rotation_sessions'::regclass
      and conname = 'court_rotation_sessions_host_key_check'
  ) then
    alter table public.court_rotation_sessions
      add constraint court_rotation_sessions_host_key_check
      check (host_key ~ '^[0-9a-f]{64}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.court_rotation_sessions'::regclass
      and conname = 'court_rotation_sessions_payload_check'
  ) then
    alter table public.court_rotation_sessions
      add constraint court_rotation_sessions_payload_check
      check (octet_length(payload::text) <= 200000);
  end if;
end
$$;

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

CREATE OR REPLACE FUNCTION public.publish_session(p_code text, p_host_key text, p_payload jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
