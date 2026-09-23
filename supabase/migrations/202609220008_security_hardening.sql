-- Security hardening ahead of the public release.
--
-- 1. usage_daily was still writable by its owner: migration 0001 created
--    `usage_insert_own` / `usage_update_own` and 0006 never dropped them, so any
--    signed-in user could `update usage_daily set ai_requests = 0` and bypass
--    the daily AI quota. All writes now go through SECURITY DEFINER functions.
-- 2. The quota RPCs took an arbitrary `p_user_id` and were executable by every
--    authenticated user, so one user could burn (or read) another user's quota.
--    They are now bound to auth.uid().
-- 3. A per-minute burst limit caps how fast any account (premium included) can
--    spend AI requests, and premium gets a generous daily safety ceiling.
-- 4. The tier guard read `request.jwt.claim.role`, which current PostgREST no
--    longer sets — it blocked the service role and the SQL editor from ever
--    changing a tier, while inserts were not guarded at all.
-- 5. The free-tier word cap was a count-then-insert race; it is serialised per
--    user now.
-- 6. Length / size limits so a client cannot store unbounded text.
--
-- Safe to re-run. Constraints are added NOT VALID so existing rows are not
-- re-checked; run `alter table ... validate constraint ...` once data is clean.

-- ── 1. usage_daily is read-only for clients ─────────────────────────────────
drop policy if exists "usage_insert_own" on public.usage_daily;
drop policy if exists "usage_update_own" on public.usage_daily;

alter table public.usage_daily
  add column if not exists burst_window timestamptz,
  add column if not exists burst_count integer not null default 0;

-- ── 2. Legacy helpers that let a caller write anyone's counter ──────────────
drop function if exists public.increment_ai_usage(uuid, integer);
drop function if exists public.increment_ai_usage_counter(uuid);

-- Only called from other SECURITY DEFINER functions.
revoke all on function public.get_user_tier(uuid) from public, anon, authenticated;

-- ── 3. Quota: bound to the caller, with a burst limit ───────────────────────
drop function if exists public.consume_ai_request_quota(uuid);

create function public.consume_ai_request_quota(p_user_id uuid default null)
returns table(
  allowed boolean,
  used integer,
  limit_value integer,
  is_unlimited boolean,
  tier text,
  reason text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  c_free_daily constant integer := 10;
  -- Premium is sold as unlimited; this only stops a runaway client or a leaked
  -- session from turning into an unbounded provider bill.
  c_premium_daily constant integer := 1000;
  -- A 20-question quiz is 20 requests, so this leaves room for real use.
  c_burst_per_minute constant integer := 40;

  v_uid uuid := auth.uid();
  v_tier text;
  v_limit integer;
  v_used integer;
  v_burst_window timestamptz;
  v_burst_count integer;
  v_minute timestamptz := date_trunc('minute', now());
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_user_id is not null and p_user_id <> v_uid then
    raise exception 'cannot consume quota for another user' using errcode = '42501';
  end if;

  v_tier := public.get_user_tier(v_uid);
  v_limit := case when v_tier = 'premium' then c_premium_daily else c_free_daily end;

  insert into public.usage_daily (user_id, usage_date, ai_requests, daily_limit)
  values (v_uid, current_date, 0, v_limit)
  on conflict (user_id, usage_date) do nothing;

  -- Row lock: concurrent requests from one user are serialised here.
  select u.ai_requests, u.burst_window, u.burst_count
    into v_used, v_burst_window, v_burst_count
  from public.usage_daily u
  where u.user_id = v_uid and u.usage_date = current_date
  for update;

  if v_used >= v_limit then
    return query select false, v_used,
      case when v_tier = 'premium' then null else v_limit end,
      v_tier = 'premium', v_tier, 'daily_limit'::text;
    return;
  end if;

  if v_burst_window = v_minute and v_burst_count >= c_burst_per_minute then
    return query select false, v_used,
      case when v_tier = 'premium' then null else v_limit end,
      v_tier = 'premium', v_tier, 'rate_limited'::text;
    return;
  end if;

  update public.usage_daily u
  set ai_requests = u.ai_requests + 1,
      daily_limit = v_limit,
      burst_count = case when u.burst_window = v_minute then u.burst_count + 1 else 1 end,
      burst_window = v_minute
  where u.user_id = v_uid and u.usage_date = current_date
  returning u.ai_requests into v_used;

  return query select true, v_used,
    case when v_tier = 'premium' then null else v_limit end,
    v_tier = 'premium', v_tier, null::text;
end;
$$;

revoke all on function public.consume_ai_request_quota(uuid) from public, anon;
grant execute on function public.consume_ai_request_quota(uuid) to authenticated;

-- The React client calls this with no arguments; the old signature required a
-- user id, so the usage meter always failed and showed 0.
drop function if exists public.get_today_ai_usage(uuid);

create function public.get_today_ai_usage(p_user_id uuid default null)
returns table(used integer, limit_value integer, is_unlimited boolean, tier text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_tier text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_user_id is not null and p_user_id <> v_uid then
    raise exception 'cannot read another user''s usage' using errcode = '42501';
  end if;

  v_tier := public.get_user_tier(v_uid);

  return query
  select
    coalesce((
      select u.ai_requests from public.usage_daily u
      where u.user_id = v_uid and u.usage_date = current_date
    ), 0),
    case when v_tier = 'premium' then null else 10 end,
    v_tier = 'premium',
    v_tier;
end;
$$;

revoke all on function public.get_today_ai_usage(uuid) from public, anon;
grant execute on function public.get_today_ai_usage(uuid) to authenticated;

-- ── 4. Tier guard ───────────────────────────────────────────────────────────
-- Privileged = the service role, or a direct database session with no JWT at
-- all (SQL editor, migrations, the auth server's signup trigger). Requests
-- through PostgREST always carry claims, so clients can never qualify.
create or replace function public.is_privileged_context()
returns boolean
language plpgsql
stable
set search_path = public
as $$
declare
  v_claims text := current_setting('request.jwt.claims', true);
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return true;
  end if;
  if v_claims is null or v_claims = '' then
    return true;
  end if;
  return coalesce(v_claims::jsonb ->> 'role', '') = 'service_role';
end;
$$;

revoke all on function public.is_privileged_context() from public, anon, authenticated;

create or replace function public.protect_profile_tier()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_privileged_context() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.tier := 'free';
    return new;
  end if;
  if new.tier is distinct from old.tier then
    raise exception 'tier can only be changed by the service role' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_tier_protect on public.profiles;
create trigger trg_profiles_tier_protect
before insert or update on public.profiles
for each row execute function public.protect_profile_tier();

drop function if exists public.protect_profile_tier_update();

-- ── 5. Free word cap without the race ───────────────────────────────────────
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
  -- Two parallel inserts could both see 299 and both succeed; serialise them.
  perform pg_advisory_xact_lock(hashtextextended('words_limit:' || new.user_id::text, 0));

  v_tier := public.get_user_tier(new.user_id);

  if v_tier = 'free' then
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

-- ── 6. Size limits ──────────────────────────────────────────────────────────
-- The client enforces tighter limits (word 100, definition 500, example 250,
-- folder 50); these are the backstop for anything calling PostgREST directly.
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('words', 'words_word_length', 'char_length(word) between 1 and 200'),
      ('words', 'words_definition_length', 'char_length(definition) <= 2000'),
      ('words', 'words_example_length', 'example is null or char_length(example) <= 1000'),
      ('words', 'words_folder_length', 'folder is null or char_length(folder) <= 100'),
      ('words', 'words_source_length', 'char_length(source) <= 32'),
      ('progress', 'progress_quiz_type_length', 'char_length(quiz_type) <= 32'),
      ('progress', 'progress_score_le_total', 'score <= total_questions'),
      ('progress', 'progress_total_bounded', 'total_questions <= 500'),
      ('progress', 'progress_details_size', 'pg_column_size(details) <= 8192'),
      ('profiles', 'profiles_display_name_length', 'display_name is null or char_length(display_name) <= 200'),
      ('profiles', 'profiles_avatar_url_length', 'avatar_url is null or char_length(avatar_url) <= 2048')
    ) as t(tbl, name, expr)
  loop
    if not exists (
      select 1 from pg_constraint
      where conname = c.name and conrelid = format('public.%I', c.tbl)::regclass
    ) then
      execute format('alter table public.%I add constraint %I check (%s) not valid', c.tbl, c.name, c.expr);
    end if;
  end loop;
end$$;
