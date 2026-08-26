-- Step 4: enforce AI limits atomically in DB for Edge Functions

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

revoke all on function public.consume_ai_request_quota(uuid) from public;
grant execute on function public.consume_ai_request_quota(uuid) to authenticated;
