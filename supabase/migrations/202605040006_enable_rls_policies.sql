-- Step 6: Enable Row-Level Security on all user tables and add per-user policies.
-- Run this in Supabase SQL editor for existing databases.

-- ── Enable RLS ────────────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.words enable row level security;
alter table public.progress enable row level security;
alter table public.usage_daily enable row level security;

-- ── profiles ──────────────────────────────────────────────────────
-- Drop then recreate to make this migration idempotent.
drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = user_id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id);

-- ── words ─────────────────────────────────────────────────────────
drop policy if exists "words_select_own" on public.words;
drop policy if exists "words_insert_own" on public.words;
drop policy if exists "words_update_own" on public.words;
drop policy if exists "words_delete_own" on public.words;

create policy "words_select_own" on public.words
  for select using (auth.uid() = user_id);
create policy "words_insert_own" on public.words
  for insert with check (auth.uid() = user_id);
create policy "words_update_own" on public.words
  for update using (auth.uid() = user_id);
create policy "words_delete_own" on public.words
  for delete using (auth.uid() = user_id);

-- ── progress ──────────────────────────────────────────────────────
drop policy if exists "progress_select_own" on public.progress;
drop policy if exists "progress_insert_own" on public.progress;

create policy "progress_select_own" on public.progress
  for select using (auth.uid() = user_id);
create policy "progress_insert_own" on public.progress
  for insert with check (auth.uid() = user_id);

-- ── usage_daily ───────────────────────────────────────────────────
-- Read-only via RLS; all writes happen inside SECURITY DEFINER RPCs.
drop policy if exists "usage_select_own" on public.usage_daily;

create policy "usage_select_own" on public.usage_daily
  for select using (auth.uid() = user_id);
