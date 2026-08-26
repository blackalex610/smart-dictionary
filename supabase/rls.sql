-- Row Level Security policies
-- Run after schema.sql

alter table public.profiles enable row level security;
alter table public.words enable row level security;
alter table public.progress enable row level security;
alter table public.usage_daily enable row level security;

-- profiles
create policy if not exists "profiles_select_own"
on public.profiles
for select
using (auth.uid() = user_id);

create policy if not exists "profiles_insert_own"
on public.profiles
for insert
with check (auth.uid() = user_id);

create policy if not exists "profiles_update_own"
on public.profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- words
create policy if not exists "words_select_own"
on public.words
for select
using (auth.uid() = user_id);

create policy if not exists "words_insert_own"
on public.words
for insert
with check (auth.uid() = user_id);

create policy if not exists "words_update_own"
on public.words
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy if not exists "words_delete_own"
on public.words
for delete
using (auth.uid() = user_id);

-- progress
create policy if not exists "progress_select_own"
on public.progress
for select
using (auth.uid() = user_id);

create policy if not exists "progress_insert_own"
on public.progress
for insert
with check (auth.uid() = user_id);

-- usage_daily
create policy if not exists "usage_select_own"
on public.usage_daily
for select
using (auth.uid() = user_id);

create policy if not exists "usage_insert_own"
on public.usage_daily
for insert
with check (auth.uid() = user_id);

create policy if not exists "usage_update_own"
on public.usage_daily
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
