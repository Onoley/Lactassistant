-- supabase/migrations/0017_vue_comparaison_priorites.sql
-- Lecture seule, admin uniquement — permet de rapprocher, par magasin, la
-- sortie du nouveau moteur des opportunités existantes avant toute
-- activation d'écran (spec §12.6). Ne remplace aucune requête existante.
create view vue_opportunites_actives as
select
  o.id, o.magasin_id, m.nom as magasin_nom, m.enseigne,
  o.produit_canonique_id, p.nom as produit_nom, p.code as produit_code,
  o.type_mission, o.promo_id, o.statut, o.niveau_priorite, o.score, o.confiance,
  o.score_calcule_at, o.cycle
from opportunites o
join magasins m on m.id = o.magasin_id
join produits p on p.id = o.produit_canonique_id
where o.niveau_priorite is not null
  and o.statut not in ('reussie', 'abandonnee');

alter view vue_opportunites_actives owner to postgres;
grant select on vue_opportunites_actives to authenticated;
