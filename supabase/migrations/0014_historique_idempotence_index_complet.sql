-- Task 5 fix round 2: l'index partiel historique_idempotence_visite empêche
-- PostgREST/supabase-js d'inférer l'arbitre ON CONFLICT (le client ne peut pas
-- spécifier de clause WHERE), ce qui fait échouer un upsert sur deux avec
-- l'erreur Postgres 42P10. On recrée l'index en version complète (non partielle)
-- sur les mêmes colonnes. Comportement inchangé pour visite_id is null : les
-- index uniques Postgres traitent toujours NULL comme distinct de tout autre
-- NULL, partiel ou non.
drop index historique_idempotence_visite;
create unique index historique_idempotence_visite
  on statuts_produit_magasin_historique (magasin_id, produit_id, visite_id);
