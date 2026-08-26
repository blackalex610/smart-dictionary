-- Add plan tier support for profiles
-- Existing users default to free

alter table public.profiles
  add column if not exists tier text;

update public.profiles
set tier = coalesce(tier, 'free')
where tier is null;

alter table public.profiles
  alter column tier set default 'free',
  alter column tier set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_tier_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_tier_check
      check (tier in ('free', 'premium'));
  end if;
end$$;

-- Prevent client-side self-upgrade from free -> premium.
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
