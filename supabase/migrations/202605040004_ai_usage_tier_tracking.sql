-- Step 3: tier-aware AI usage tracking primitives
-- Free users baseline: 10/day
-- Premium users: unlimited (limit_value = null)

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

revoke all on function public.get_user_tier(uuid) from public;
revoke all on function public.increment_ai_usage_counter(uuid) from public;
revoke all on function public.get_today_ai_usage(uuid) from public;

grant execute on function public.get_user_tier(uuid) to authenticated;
grant execute on function public.increment_ai_usage_counter(uuid) to authenticated;
grant execute on function public.get_today_ai_usage(uuid) to authenticated;
