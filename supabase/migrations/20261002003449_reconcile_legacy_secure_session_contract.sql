-- Court Rotation Generator: reconcile legacy live-session access drift.
-- This migration repairs the older 20260928030000_court_rotation_sessions
-- policy and privilege names that can survive when the newer secure migration
-- 20260928132803_secure_court_rotation_sessions is already recorded.
--
-- The statements are intentionally idempotent. They remove only the legacy
-- direct-read/write grants and policies, then restore the secure SELECT grant.
-- The production cron job is not changed here.

revoke all on table public.court_rotation_sessions
  from public, anon, authenticated;

drop policy if exists "court sessions anonymous read"
  on public.court_rotation_sessions;

drop policy if exists "court sessions keyed host insert"
  on public.court_rotation_sessions;

drop policy if exists "court sessions keyed host update"
  on public.court_rotation_sessions;

grant select (
  session_code,
  payload,
  updated_at,
  expires_at
)
on table public.court_rotation_sessions
to anon, authenticated;

revoke execute on function public.publish_session(text, text, jsonb)
  from public, authenticated;

grant execute on function public.publish_session(text, text, jsonb)
  to anon;
