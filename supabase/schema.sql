-- One row per player: their whole save as JSON (see js/cloud.js).
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.

create table if not exists public.saves (
  user_id uuid primary key references auth.users on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- Players can read and write only their own row. The public anon key in
-- js/cloud-config.js gets nothing beyond this.
alter table public.saves enable row level security;

drop policy if exists "own save" on public.saves;
create policy "own save" on public.saves
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
