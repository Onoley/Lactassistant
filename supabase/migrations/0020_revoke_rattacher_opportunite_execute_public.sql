-- supabase/migrations/0020_revoke_rattacher_opportunite_execute_public.sql
-- 0019 revoked EXECUTE from anon/authenticated directly, but that was a
-- no-op: PostgreSQL grants EXECUTE to PUBLIC by default on function
-- creation, and anon/authenticated never had an explicit grant of their
-- own — their access came entirely through PUBLIC (confirmed live: proacl
-- was `{=X/postgres,postgres=X/postgres,service_role=X/postgres}`, i.e. no
-- anon/authenticated entries at all). Revoking from PUBLIC is what actually
-- closes the hole; the explicit grants to postgres (owner) and service_role
-- are untouched, so the app's admin client keeps working.
revoke execute on function rattacher_opportunite(
  uuid, uuid, text, uuid, text, integer, text, jsonb, text, text, boolean, uuid[], uuid
) from public;
