-- supabase/migrations/0018_vue_opportunites_actives_security_invoker.sql
-- Fixe une faille RLS-bypass sur vue_opportunites_actives (Task 17) : la vue
-- était créée sans security_invoker, appartenant à postgres (BYPASSRLS), avec
-- select accordé à authenticated. Tout utilisateur authentifié interrogeant
-- la vue voyait donc les opportunités de tous les secteurs, en contournant
-- la policy opportunites_select_visible sur la table opportunites.
-- security_invoker = true force la ré-évaluation des policies RLS avec les
-- droits de l'appelant plutôt que du propriétaire de la vue (fix standard
-- PostgreSQL 15+). Le grant select existant à authenticated reste valide.
alter view vue_opportunites_actives set (security_invoker = true);
