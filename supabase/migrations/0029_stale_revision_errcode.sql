-- 0029: stop PostgREST from retrying "This content changed" errors forever.
-- production_transition() and save_production() raised a stale-revision conflict with SQLSTATE 40001
-- (serialization_failure). The database logs showed one stale call repeated every second for over 24 hours
-- (≈86k errors a day, CPU pegged at 100%) through PostgREST and never through the API gateway, which is
-- consistent with PostgREST treating 40001 as retryable. PT409 is a PostgREST custom code: HTTP 409 Conflict,
-- never retried. The message is unchanged, so the app shows the same "reload" error.
-- The live definitions are rewritten in place so nothing else in the functions changes.

do $$
declare d text;
begin
  for d in
    select replace(pg_get_functiondef(p.oid), 'errcode=''40001''', 'errcode=''PT409''')
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('production_transition', 'save_production')
      and p.prosrc like '%40001%'
  loop
    execute d;
  end loop;
end $$;
