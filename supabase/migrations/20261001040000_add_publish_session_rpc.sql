-- Court Rotation Generator: additive publish RPC.
-- Stage 1 of the Supabase rollout.
--
-- This migration intentionally preserves the existing direct INSERT/UPDATE
-- grants and policies so older cached clients can continue publishing while
-- the RPC-based client is rolled out and observed.
--
-- TEMPORARY LEGACY COMPATIBILITY:
-- Restored pre-v2 sessions can carry legacy CRG- + 1-7 base-36 codes.
-- Keep this pattern only through the Stage 1 observation window. Remove
-- legacy-code acceptance in #45 after the new client has been live in
-- production for more than LIVE_STATE_TTL_MS (12 hours).
--
-- The final restrictive migration is intentionally separate and will handle
-- host-key hashing/migration, expiry controls, direct-write revocation,
-- tighter SELECT access, and the final RPC definition.

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
  v_request_headers jsonb;
  v_request_code text;
  v_request_host_key text;
begin
  if p_code is null or p_code !~ '^(CRG-[A-HJ-NP-Z2-9]{10}|CRG-[A-Za-z0-9]{1,7})$' then
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

  v_request_headers := current_setting('request.headers', true)::jsonb;
  v_request_code := coalesce(v_request_headers ->> 'x-crg-session-code', '');
  v_request_host_key := coalesce(v_request_headers ->> 'x-crg-host-key', '');

  if v_request_code <> p_code or v_request_host_key <> p_host_key then
    raise exception 'Request headers do not match the publish credentials.';
  end if;

  insert into public.court_rotation_sessions (
    session_code,
    host_key,
    payload,
    updated_at
  )
  values (
    p_code,
    p_host_key,
    p_payload,
    now()
  )
  on conflict (session_code) do update
  set
    payload = excluded.payload,
    updated_at = excluded.updated_at
  where public.court_rotation_sessions.host_key = excluded.host_key;

  if not found then
    raise exception using
      errcode = 'CRG01',
      message = 'Session code is already owned by another host.';
  end if;

  return true;
end;
$$;

revoke execute on function public.publish_session(text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.publish_session(text, text, jsonb)
  to anon;
