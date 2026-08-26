-- Enforce free-tier word cap (300 words) at DB level
-- Security: this trigger runs server-side and cannot be bypassed by client code

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
