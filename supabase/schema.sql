-- Saves for every game on this Supabase project: one row per player per
-- game, holding that game's whole save as JSON (see js/cloud.js). A new game
-- just picks its own `game` name in js/cloud-config.js; nothing to add here.
-- Run once in the Supabase dashboard: SQL Editor → New query → paste → Run.

create table if not exists public.saves (
  user_id uuid not null references auth.users on delete cascade,
  game text not null,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, game)
);

-- Players can read and write only their own rows. The public key in
-- js/cloud-config.js gets nothing beyond this.
alter table public.saves enable row level security;

drop policy if exists "own save" on public.saves;
create policy "own save" on public.saves
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
