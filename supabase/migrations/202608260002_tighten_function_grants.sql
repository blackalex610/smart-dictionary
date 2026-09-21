-- Follow-up from Supabase's security advisor after 202608260001_security_hotfix:
-- default privileges grant `anon` EXECUTE on newly created functions
-- directly (not via the PUBLIC pseudo-role), so `revoke all ... from public`
-- alone did not remove it. Also lock down the pure trigger functions, which
-- have no business being callable as RPCs at all -- Postgres does not check
-- EXECUTE privilege when a function fires as a trigger, so this does not
-- affect signup, the word-limit check, or the tier-protect check.

revoke execute on function public.get_user_tier(uuid) from anon;
revoke execute on function public.consume_ai_request_quota(uuid) from anon;
revoke execute on function public.get_today_ai_usage(uuid) from anon;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.enforce_words_limit() from public, anon, authenticated;
revoke execute on function public.protect_profile_tier_update() from public, anon, authenticated;

alter function public.set_updated_at() set search_path = public;
