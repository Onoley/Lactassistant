-- Backfill statuts_produit_magasin_historique with exactly one row per existing row
-- of statuts_produit_magasin. Single initial observation never alone triggers
-- recurrence threshold (≥2 distinct observations per spec §12.3).
insert into statuts_produit_magasin_historique (magasin_id, produit_id, statut, raison_absence, visite_id, signale_par, signale_at)
select magasin_id, produit_id, statut, raison_absence, null, signale_par, signale_at
from statuts_produit_magasin;
