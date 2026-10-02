\set ON_ERROR_STOP on
\pset pager off
\set crg_secure_migration 'supabase/migrations/20260928132803_secure_court_rotation_sessions.sql'
\set crg_cron_migration 'supabase/migrations/20260928170000_schedule_expired_session_cleanup.sql'
\set crg_reconcile_migration 'supabase/migrations/20261002003449_reconcile_legacy_secure_session_contract.sql'
\echo 'Migrations under test:'
\echo '  ' :crg_secure_migration
\echo '  ' :crg_cron_migration
\echo '  ' :crg_reconcile_migration

\echo '1. Verify the applied secure schema, privileges, policy, function and cron job.'
do $$
declare
  v_rls boolean;
  v_policy_count integer;
  v_definition text;
  v_cron_count integer;
begin
  select relrowsecurity into v_rls
  from pg_class
  where oid = 'public.court_rotation_sessions'::regclass;

  if not v_rls then
    raise exception 'RLS is not enabled';
  end if;

  if has_table_privilege('anon', 'public.court_rotation_sessions', 'insert')
     or has_table_privilege('anon', 'public.court_rotation_sessions', 'update')
     or has_table_privilege('anon', 'public.court_rotation_sessions', 'delete')
     or has_table_privilege('anon', 'public.court_rotation_sessions', 'truncate') then
    raise exception 'anon has an unexpected direct table write privilege';
  end if;

  if not has_column_privilege('anon', 'public.court_rotation_sessions', 'session_code', 'select')
     or not has_column_privilege('anon', 'public.court_rotation_sessions', 'payload', 'select')
     or not has_column_privilege('anon', 'public.court_rotation_sessions', 'updated_at', 'select')
     or not has_column_privilege('anon', 'public.court_rotation_sessions', 'expires_at', 'select') then
    raise exception 'anon is missing one or more granted SELECT columns';
  end if;

  if has_column_privilege('anon', 'public.court_rotation_sessions', 'host_key', 'select') then
    raise exception 'host_key is unexpectedly SELECT-granted to anon';
  end if;

  if has_table_privilege('authenticated', 'public.court_rotation_sessions', 'insert')
     or has_table_privilege('authenticated', 'public.court_rotation_sessions', 'update') then
    raise exception 'authenticated has unexpected direct write privileges';
  end if;

  select count(*) into v_policy_count
  from pg_policies
  where schemaname='public'
    and tablename='court_rotation_sessions';

  if v_policy_count <> 1 then
    raise exception 'expected exactly one court session policy, found %', v_policy_count;
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname='public'
      and tablename='court_rotation_sessions'
      and policyname='CRG sessions exact-code read'
      and cmd='SELECT'
      and roles::text='{anon,authenticated}'
      and qual like '%expires_at > now()%'
      and qual like '%x-crg-session-code%'
  ) then
    raise exception 'exact-code/expiry SELECT policy does not match deployed contract';
  end if;

  select pg_get_functiondef('public.publish_session(text,text,jsonb)'::regprocedure)
    into v_definition;

  if v_definition not like '%SECURITY DEFINER%' then
    raise exception 'publish_session is not SECURITY DEFINER';
  end if;
  if v_definition not like '%SET search_path TO ''''%' then
    raise exception 'publish_session does not set empty search_path';
  end if;
  if v_definition not like '%^CRG-[A-HJ-NP-Z2-9]{10}$%' then
    raise exception 'publish_session code regex does not match deployed contract';
  end if;
  if v_definition not like '%extensions.digest(p_host_key, ''sha256'')%' then
    raise exception 'publish_session does not hash the raw host key';
  end if;
  if v_definition not like '%expires_at > now()%' then
    raise exception 'publish_session does not enforce session expiry';
  end if;
  if v_definition not like '%Invalid host key or expired session.%' then
    raise exception 'publish_session ownership/expiry error does not match deployed message';
  end if;

  if not has_function_privilege('anon', 'public.publish_session(text,text,jsonb)', 'execute') then
    raise exception 'anon should have EXECUTE';
  end if;
  if has_function_privilege('authenticated', 'public.publish_session(text,text,jsonb)', 'execute') then
    raise exception 'authenticated must not have EXECUTE';
  end if;

  select count(*) into v_cron_count
  from cron.job
  where jobname='crg-expired-session-cleanup'
    and schedule='0 * * * *'
    and command='delete from public.court_rotation_sessions where expires_at <= now()'
    and active;

  if v_cron_count <> 1 then
    raise exception 'expected exactly one active expiry cleanup job, found %', v_cron_count;
  end if;
end
$$;

\echo '2. Seed an expired owned session for the expiry assertion.'
insert into public.court_rotation_sessions (
  session_code, host_key, payload, updated_at, expires_at
)
values (
  'CRG-ABCDEFGHJL',
  encode(extensions.digest(repeat('c', 64), 'sha256'), 'hex'),
  '{"expired":true}'::jsonb,
  now(),
  now() - interval '1 minute'
);

\echo '3. Valid new-format publish must succeed and hash the raw host key.'
set role anon;
select public.publish_session(
  'CRG-ABCDEFGHJK',
  repeat('a', 64),
  '{"x":1}'::jsonb
);
reset role;

do $$
declare
  v_expected_hash text := encode(extensions.digest(repeat('a', 64), 'sha256'), 'hex');
  v_stored_hash text;
  v_payload jsonb;
  v_expires timestamptz;
begin
  select host_key, payload, expires_at
    into v_stored_hash, v_payload, v_expires
  from public.court_rotation_sessions
  where session_code='CRG-ABCDEFGHJK';

  if v_stored_hash <> v_expected_hash then
    raise exception 'host key was not stored as the expected SHA-256 hash';
  end if;
  if v_payload <> '{"x": 1}'::jsonb then
    raise exception 'valid publish stored the wrong payload';
  end if;
  if v_expires <= now() then
    raise exception 'valid publish did not create a future expiry';
  end if;
end
$$;

\echo '4. Same raw host key must update the existing session.'
do $$
declare
  v_hash_before text;
  v_hash_after text;
  v_payload jsonb;
  v_expiry_before timestamptz;
  v_expiry_after timestamptz;
begin
  select host_key, expires_at into v_hash_before, v_expiry_before
  from public.court_rotation_sessions
  where session_code='CRG-ABCDEFGHJK';

  set local role anon;
  perform public.publish_session(
    'CRG-ABCDEFGHJK',
    repeat('a', 64),
    '{"x":2,"updated":true}'::jsonb
  );

  reset role;

  select host_key, payload, expires_at
    into v_hash_after, v_payload, v_expiry_after
  from public.court_rotation_sessions
  where session_code='CRG-ABCDEFGHJK';

  if v_payload <> '{"updated": true, "x": 2}'::jsonb then
    raise exception 'same-key republish did not replace payload';
  end if;
  if v_hash_after <> v_hash_before then
    raise exception 'same-key republish changed the ownership hash';
  end if;
  if v_expiry_after <> v_expiry_before then
    raise exception 'same-key republish unexpectedly extended expiry';
  end if;
end
$$;

\echo '5. Wrong key must return the deployed generic ownership/expiry error.'
set role anon;
do $crg$
begin
  begin
    perform public.publish_session(
      'CRG-ABCDEFGHJK',
      repeat('b', 64),
      '{"x":3}'::jsonb
    );
    raise exception 'wrong-key publish unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> 'P0001'
         or sqlerrm <> 'Invalid host key or expired session.' then
        raise exception 'wrong-key error was % / %', sqlstate, sqlerrm;
      end if;
  end;
end
$crg$;
reset role;

\echo '6. Expired session must return the same generic error.'
set role anon;
do $crg$
begin
  begin
    perform public.publish_session(
      'CRG-ABCDEFGHJL',
      repeat('c', 64),
      '{"expired":false}'::jsonb
    );
    raise exception 'expired-session publish unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> 'P0001'
         or sqlerrm <> 'Invalid host key or expired session.' then
        raise exception 'expired-session error was % / %', sqlstate, sqlerrm;
      end if;
  end;
end
$crg$;
reset role;

\echo '7. Legacy codes and short keys must be rejected.'
set role anon;
do $crg$
begin
  begin
    perform public.publish_session(
      'CRG-ABC1234',
      repeat('a', 64),
      '{"legacy":true}'::jsonb
    );
    raise exception 'legacy code unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> 'P0001' or sqlerrm <> 'Invalid session code.' then
        raise exception 'legacy code returned % / %', sqlstate, sqlerrm;
      end if;
  end;

  begin
    perform public.publish_session(
      'CRG-ABCDEFGHJM',
      'short',
      '{"short":true}'::jsonb
    );
    raise exception 'short host key unexpectedly succeeded';
  exception
    when others then
      if sqlstate <> 'P0001' or sqlerrm <> 'Invalid host key.' then
        raise exception 'short host key returned % / %', sqlstate, sqlerrm;
      end if;
  end;
end
$crg$;
reset role;

\echo '8. Direct INSERT/UPDATE must be denied to anon.'
set role anon;
do $crg$
begin
  begin
    insert into public.court_rotation_sessions (
      session_code, host_key, payload
    )
    values (
      'CRG-ZZZZZZZZZZ', repeat('d',64), '{"direct":"insert"}'::jsonb
    );
    raise exception 'anon direct INSERT unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    update public.court_rotation_sessions
       set payload='{"direct":"update"}'::jsonb
     where session_code='CRG-ABCDEFGHJK';
    raise exception 'anon direct UPDATE unexpectedly succeeded';
  exception
    when insufficient_privilege then
      null;
  end;
end
$crg$;
reset role;

\echo '9. Spectator SELECT must use the matching session-code header.'
set role anon;
do $crg$
declare
  v_visible integer;
  v_hidden integer;
begin
  perform set_config(
    'request.headers',
    json_build_object('x-crg-session-code','CRG-ABCDEFGHJK')::text,
    true
  );

  select count(*) into v_visible
  from public.court_rotation_sessions;

  perform set_config(
    'request.headers',
    json_build_object('x-crg-session-code','CRG-ZZZZZZZZZZ')::text,
    true
  );

  select count(*) into v_hidden
  from public.court_rotation_sessions;

  if v_visible <> 1 then
    raise exception 'matching session header did not expose exactly one live session';
  end if;
  if v_hidden <> 0 then
    raise exception 'non-matching session header exposed live rows';
  end if;
end
$crg$;
reset role;

\echo '10. Payload cap remains enforced by the deployed function.'
set role anon;
do $crg$
declare
  v_result text;
begin
  begin
    perform public.publish_session(
      'CRG-ABCDEFGHJN',
      repeat('e',64),
      jsonb_build_object('blob', repeat('x', 200000))
    );
    v_result := 'ok';
  exception when others then
    v_result := sqlstate || ':' || sqlerrm;
  end;

  if v_result <> 'P0001:Payload too large.' then
    raise exception 'oversized payload returned % instead of P0001:Payload too large.', v_result;
  end if;
end
$crg$;
reset role;

\echo '11. Expiry migration is idempotent and did not create a duplicate named job.'
do $crg$
declare
  v_job_count integer;
begin
  select count(*) into v_job_count
  from cron.job
  where jobname='crg-expired-session-cleanup';

  if v_job_count <> 1 then
    raise exception 'expected one cleanup job, found %', v_job_count;
  end if;
end
$crg$;

\echo '12. Expiry cleanup command must delete expired rows and retain live rows.'
do $crg$
declare
  v_command text;
  v_seed_count integer;
  v_expired_count integer;
  v_live_count integer;
begin
  select command
    into v_command
  from cron.job
  where jobname='crg-expired-session-cleanup';

  if v_command is null then
    raise exception 'expiry cleanup command was not found';
  end if;

  insert into public.court_rotation_sessions (
    session_code, host_key, payload, updated_at, expires_at
  )
  values
    (
      'CRG-EXPTESTX23',
      encode(extensions.digest(repeat('f', 64), 'sha256'), 'hex'),
      '{"cleanup":"expired"}'::jsonb,
      now(),
      now() - interval '1 minute'
    ),
    (
      'CRG-LVTESTXX23',
      encode(extensions.digest(repeat('g', 64), 'sha256'), 'hex'),
      '{"cleanup":"live"}'::jsonb,
      now(),
      now() + interval '1 day'
    );

  select count(*) into v_seed_count
  from public.court_rotation_sessions
  where session_code in ('CRG-EXPTESTX23', 'CRG-LVTESTXX23');

  if v_seed_count <> 2 then
    raise exception 'cleanup test precondition expected two rows, found %', v_seed_count;
  end if;

  execute v_command;

  select count(*) into v_expired_count
  from public.court_rotation_sessions
  where session_code='CRG-EXPTESTX23';

  select count(*) into v_live_count
  from public.court_rotation_sessions
  where session_code='CRG-LVTESTXX23';

  if v_expired_count <> 0 then
    raise exception 'expired row was not deleted';
  end if;

  if v_live_count <> 1 then
    raise exception 'live row was unexpectedly deleted';
  end if;
end
$crg$;

\echo 'All secure session migration rehearsal assertions passed.';
