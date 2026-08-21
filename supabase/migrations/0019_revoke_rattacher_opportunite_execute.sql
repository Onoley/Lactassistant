-- supabase/migrations/0019_revoke_rattacher_opportunite_execute.sql
-- rattacher_opportunite est security definer (owner postgres, BYPASSRLS) et
-- l'unique chemin d'écriture transactionnel pour opportunites /
-- opportunite_evenements / opportunite_promos_preuves. Elle est actuellement
-- appelable par anon/authenticated via /rest/v1/rpc/rattacher_opportunite,
-- contournant la RLS opportunites_write_own_secteur. Les seuls appelants
-- réels (lib/engine/rattachement.ts) utilisent un client admin
-- (service_role), qui n'est pas soumis aux grants — cette révocation ne
-- casse rien côté app.
--
-- Note : cette révocation explicite sur anon/authenticated s'avère un no-op
-- (vérifié en live) car ni l'un ni l'autre n'avait de grant explicite — leur
-- accès venait entièrement du grant par défaut à PUBLIC (`=X/postgres` dans
-- proacl). Le fix effectif est dans la migration 0020, qui révoque de
-- PUBLIC. On garde celle-ci telle quelle (déjà appliquée en l'état sur la
-- base live) plutôt que de réécrire un fichier déjà exécuté.
revoke execute on function rattacher_opportunite(
  uuid, uuid, text, uuid, text, integer, text, jsonb, text, text, boolean, uuid[], uuid
) from anon, authenticated;
