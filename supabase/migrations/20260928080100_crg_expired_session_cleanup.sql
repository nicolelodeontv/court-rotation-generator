-- Court Rotation Generator: expired-session cleanup.
-- Enable pg_cron first in Supabase Dashboard -> Database -> Extensions.
-- This migration intentionally does not create/enable the extension itself.

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
      'delete from public.court_rotation_sessions where expires_at <= now()'
    );
  end if;
end;
$$;
