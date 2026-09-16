create table if not exists public.court_rotation_sessions (
  session_code text primary key,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.court_rotation_sessions enable row level security;

drop policy if exists "CRG public read sessions" on public.court_rotation_sessions;
drop policy if exists "CRG public insert sessions" on public.court_rotation_sessions;
drop policy if exists "CRG public update sessions" on public.court_rotation_sessions;

create policy "CRG public read sessions"
  on public.court_rotation_sessions for select
  using (true);

create policy "CRG public insert sessions"
  on public.court_rotation_sessions for insert
  with check (true);

create policy "CRG public update sessions"
  on public.court_rotation_sessions for update
  using (true)
  with check (true);

alter publication supabase_realtime add table public.court_rotation_sessions;
