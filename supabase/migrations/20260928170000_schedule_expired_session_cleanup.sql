-- SCRATCH NEGATIVE CONTROL ONLY: invert expiry comparison so cleanup is intentionally wrong.
-- This branch is never to be merged.
--
-- Court Rotation Generator: record the deployed pg_cron expiry cleanup.
-- The production job was first observed running at 2026-09-28 17:00 UTC.
-- pg_cron does not expose a creator timestamp, so this migration records the
-- deployed job without asserting who created it.
-- The job is created only when the expected job name is absent, so replaying
-- this migration is idempotent and will not create a duplicate.

do $$
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'crg-expired-session-cleanup'
  ) then
    perform cron.schedule(
      'crg-expired-session-cleanup',
      '0 * * * *',
      'delete from public.court_rotation_sessions where expires_at >= now()'
    );
  end if;
end
$$;
