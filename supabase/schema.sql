-- Supabase schema for dictionary app
-- Run in Supabase SQL editor (or via supabase db push)

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  tier text not null default 'free' check (tier in ('free', 'premium')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  word text not null,
  definition text not null,
  part_of_speech text not null check (part_of_speech in ('noun', 'verb', 'adjective', 'adverb')),
  folder text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists words_user_word_pos_unique
  on public.words (user_id, lower(word), part_of_speech);

create index if not exists words_user_created_idx
  on public.words (user_id, created_at desc);

create table if not exists public.progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quiz_type text not null,
  score integer not null check (score >= 0),
  total_questions integer not null check (total_questions > 0),
  percentage numeric(5,2) generated always as ((score::numeric * 100.0) / total_questions::numeric) stored,
  words_count integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists progress_user_created_idx
  on public.progress (user_id, created_at desc);

create table if not exists public.usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default current_date,
  ai_requests integer not null default 0 check (ai_requests >= 0),
  daily_limit integer not null default 50 check (daily_limit > 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

create index if not exists usage_daily_user_date_idx
  on public.usage_daily (user_id, usage_date desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger trg_words_updated_at
before update on public.words
for each row execute function public.set_updated_at();

create trigger trg_usage_daily_updated_at
before update on public.usage_daily
for each row execute function public.set_updated_at();

create or replace function public.enforce_words_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
  v_count integer;
begin
  select coalesce(tier, 'free') into v_tier
  from public.profiles
  where user_id = new.user_id;

  if coalesce(v_tier, 'free') = 'free' then
    select count(*) into v_count
    from public.words
    where user_id = new.user_id;

    if v_count >= 300 then
      raise exception 'FREE_WORD_LIMIT_REACHED: Free users can store up to 300 words. Upgrade to Premium for unlimited words.'
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_words_limit on public.words;
create trigger trg_words_limit
before insert on public.words
for each row execute function public.enforce_words_limit();

-- Protect plan changes from direct client updates.
-- Only service_role may change tier.
create or replace function public.protect_profile_tier_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.tier is distinct from old.tier then
    if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
      raise exception 'tier can only be updated by service role';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_tier_protect on public.profiles;
create trigger trg_profiles_tier_protect
before update on public.profiles
for each row execute function public.protect_profile_tier_update();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Usage limiting function called by Edge Functions
create or replace function public.increment_ai_usage(
  p_user_id uuid,
  p_limit integer default 50
)
returns table(allowed boolean, used integer, limit_value integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
  v_limit integer;
begin
  insert into public.usage_daily (user_id, usage_date, ai_requests, daily_limit)
  values (p_user_id, current_date, 0, p_limit)
  on conflict (user_id, usage_date)
  do update set daily_limit = excluded.daily_limit;

  update public.usage_daily
  set ai_requests = ai_requests + 1
  where user_id = p_user_id and usage_date = current_date
  returning ai_requests, daily_limit into v_used, v_limit;

  return query select (v_used <= v_limit), v_used, v_limit;
end;
$$;

-- Step 3: tier-aware usage tracking helpers (no enforcement here yet).
create or replace function public.get_user_tier(p_user_id uuid)
returns text
language sql
security definer
set search_path = public
as $$
  select coalesce((
    select tier from public.profiles where user_id = p_user_id
  ), 'free')
$$;

create or replace function public.increment_ai_usage_counter(p_user_id uuid)
returns table(used integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used integer;
begin
  insert into public.usage_daily (user_id, usage_date, ai_requests, daily_limit)
  values (p_user_id, current_date, 0, 10)
  on conflict (user_id, usage_date) do nothing;

  update public.usage_daily
  set ai_requests = ai_requests + 1
  where user_id = p_user_id and usage_date = current_date
  returning ai_requests into v_used;

  return query select coalesce(v_used, 0);
end;
$$;

-- Step 4: enforce daily AI limits atomically.
create or replace function public.consume_ai_request_quota(p_user_id uuid)
returns table(
  allowed boolean,
  used integer,
  limit_value integer,
  is_unlimited boolean,
  tier text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tier text;
  v_used integer;
begin
  v_tier := public.get_user_tier(p_user_id);

  insert into public.usage_daily (user_id, usage_date, ai_requests, daily_limit)
  values (p_user_id, current_date, 0, 10)
  on conflict (user_id, usage_date) do nothing;

  if v_tier = 'premium' then
    update public.usage_daily
    set ai_requests = ai_requests + 1
    where user_id = p_user_id and usage_date = current_date
    returning ai_requests into v_used;

    return query select true, coalesce(v_used, 0), null::integer, true, v_tier;
    return;
  end if;

  update public.usage_daily
  set ai_requests = ai_requests + 1
  where user_id = p_user_id
    and usage_date = current_date
    and ai_requests < 10
  returning ai_requests into v_used;

  if v_used is null then
    select ai_requests into v_used
    from public.usage_daily
    where user_id = p_user_id and usage_date = current_date;

    return query select false, coalesce(v_used, 10), 10, false, v_tier;
  else
    return query select true, v_used, 10, false, v_tier;
  end if;
end;
$$;

-- Read-only function for UI usage meter
create or replace function public.get_today_ai_usage(p_user_id uuid)
returns table(used integer, limit_value integer, is_unlimited boolean, tier text)
language sql
security definer
set search_path = public
as $$
  with tier_row as (
    select public.get_user_tier(p_user_id) as tier
  )
  select
    coalesce(u.ai_requests, 0) as used,
    case when t.tier = 'premium' then null else 10 end as limit_value,
    (t.tier = 'premium') as is_unlimited,
    t.tier
  from tier_row t
  left join public.usage_daily u
    on u.user_id = p_user_id and u.usage_date = current_date;
$$;

revoke all on function public.increment_ai_usage(uuid, integer) from public;
revoke all on function public.get_user_tier(uuid) from public;
revoke all on function public.increment_ai_usage_counter(uuid) from public;
revoke all on function public.consume_ai_request_quota(uuid) from public;
revoke all on function public.get_today_ai_usage(uuid) from public;
grant execute on function public.increment_ai_usage(uuid, integer) to authenticated;
grant execute on function public.get_user_tier(uuid) to authenticated;
grant execute on function public.increment_ai_usage_counter(uuid) to authenticated;
grant execute on function public.consume_ai_request_quota(uuid) to authenticated;
grant execute on function public.get_today_ai_usage(uuid) to authenticated;

-- =============================================================
-- Step 6: Row-Level Security (hardening)
-- =============================================================

alter table public.profiles enable row level security;
alter table public.words enable row level security;
alter table public.progress enable row level security;
alter table public.usage_daily enable row level security;

-- profiles: each user sees/edits only their own row
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = user_id);
create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = user_id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = user_id);

-- words: full CRUD scoped to owner
create policy "words_select_own" on public.words
  for select using (auth.uid() = user_id);
create policy "words_insert_own" on public.words
  for insert with check (auth.uid() = user_id);
create policy "words_update_own" on public.words
  for update using (auth.uid() = user_id);
create policy "words_delete_own" on public.words
  for delete using (auth.uid() = user_id);

-- progress: users can insert and read their own results
create policy "progress_select_own" on public.progress
  for select using (auth.uid() = user_id);
create policy "progress_insert_own" on public.progress
  for insert with check (auth.uid() = user_id);

-- usage_daily: read-only via RLS; all writes go through SECURITY DEFINER RPCs
create policy "usage_select_own" on public.usage_daily
  for select using (auth.uid() = user_id);

