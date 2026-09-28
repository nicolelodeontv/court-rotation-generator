create table if not exists public.court_rotation_sessions (
  session_code text primary key,
  host_key text not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.court_rotation_sessions enable row level security;
revoke all on table public.court_rotation_sessions from public;
grant select, insert, update on table public.court_rotation_sessions to anon,authenticated;
drop policy if exists "court sessions anonymous read" on public.court_rotation_sessions;
drop policy if exists "court sessions keyed host insert" on public.court_rotation_sessions;
drop policy if exists "court sessions keyed host update" on public.court_rotation_sessions;
create policy "court sessions anonymous read" on public.court_rotation_sessions for select to anon,authenticated using (true);
create policy "court sessions keyed host insert" on public.court_rotation_sessions for insert to anon,authenticated with check (length(host_key)>=32 and host_key=coalesce(current_setting('request.headers',true)::json->>'x-crg-host-key',''));
create policy "court sessions keyed host update" on public.court_rotation_sessions for update to anon,authenticated using (host_key=coalesce(current_setting('request.headers',true)::json->>'x-crg-host-key','')) with check (length(host_key)>=32 and host_key=coalesce(current_setting('request.headers',true)::json->>'x-crg-host-key',''));
