-- Phase 1 security hotfix + schema completion for the live project.
--
-- The live database's actual schema does not match any SQL file previously
-- checked into supabase/ (schema.sql, rls.sql, or the 7 numbered
-- migrations) — it is an earlier, simpler, hand-run version, discovered by
-- direct inspection rather than from any file in this repo. This migration
-- patches that live schema in place. It does not drop or recreate anything
-- that holds data.
--
-- Live state before this migration (verified by direct inspection):
--   - profiles has no `tier` column; words has no `example` column.
--   - usage_daily has client-writable INSERT/UPDATE RLS policies
--     ("usage_insert_own", "usage_update_own") — any user can reset their
--     own AI quota directly (`update usage_daily set ai_requests = 0`),
--     bypassing the RPC entirely.
--   - get_today_ai_usage(p_user_id) and increment_ai_usage(p_user_id, ...)
--     take p_user_id but never check it against auth.uid() — either lets
--     one authenticated user act on another user's usage row.
--   - consume_ai_request_quota / get_user_tier — referenced by
--     supabase/functions/ai-chat/index.ts — do not exist in this database
--     at all, so the Edge Function (if deployed) is calling a missing RPC.
--   - 1 real user, 1 profile, 1 word, 3 usage_daily rows exist. Nothing
--     below touches existing rows except via the two new columns' defaults.

-- ── Columns that were designed but never deployed ────────────────────

alter table public.profiles
  add column if not exists tier text not null default 'free';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_tier_check' and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_tier_check check (tier in ('free', 'premium'));
  end if;
end$$;

alter table public.words
  add column if not exists example text;

comment on column public.words.example is 'Optional example sentence for the word.';

-- ── Close the client-writable usage_daily hole ───────────────────────
-- (self-resettable AI quota)

drop policy if exists "usage_insert_own" on public.usage_daily;
drop policy if exists "usage_update_own" on public.usage_daily;
revoke insert, update, delete on public.usage_daily from authenticated, anon;

-- ── Replace the functions that had no ownership check ────────────────
-- increment_ai_usage(uuid, integer) has no caller anywhere in src/ or
-- supabase/functions/ — dead code with the same missing-check problem.

drop function if exists public.increment_ai_usage(uuid, integer);
drop function if exists public.get_today_ai_usage(uuid);

create or replace function public.get_user_tier(p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return coalesce((
    select tier from public.profiles where user_id = p_user_id
  ), 'free');
end;
$$;

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
  if p_user_id is distinct from auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

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

create or replace function public.get_today_ai_usage(p_user_id uuid)
returns table(used integer, limit_value integer, is_unlimited boolean, tier text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user_id is distinct from auth.uid() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
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
end;
$$;

revoke all on function public.get_user_tier(uuid) from public;
revoke all on function public.consume_ai_request_quota(uuid) from public;
revoke all on function public.get_today_ai_usage(uuid) from public;
grant execute on function public.get_user_tier(uuid) to authenticated;
grant execute on function public.consume_ai_request_quota(uuid) to authenticated;
grant execute on function public.get_today_ai_usage(uuid) to authenticated;

-- ── Free-tier word cap + tier-change protection ───────────────────────
-- Designed in the repo's migration files, never deployed to this project.

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

-- NOTE: this reads the legacy PostgREST GUC (request.jwt.claim.role), which
-- current PostgREST versions do not set (they set request.jwt.claims, a JSON
-- object) — so this predicate is always true and tier can never be updated
-- by anyone, including service_role. Kept as-is (matching the originally
-- designed behaviour) rather than fixed, because without SOME trigger here,
-- adding the `tier` column above would let a client self-upgrade via
-- `profiles.update({tier: 'premium'})` — the profiles_update_own RLS policy
-- only checks row ownership, not which columns changed. Tracked as a known
-- gap (plan bug #4); the `tier` column and this trigger are dropped
-- entirely in Phase 3 in favour of a single-tier model.
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
