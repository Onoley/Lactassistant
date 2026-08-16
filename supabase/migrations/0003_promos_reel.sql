-- Aligne le schéma promos sur la structure réelle des exports PPE (2026) :
-- date_installation/date_constat deviennent optionnelles (pas de source fiable dans l'export),
-- ajout des champs présents dans les exports (thème, support, statut, OP Trade, niveau, dates de revente/fin).
alter table promos
  alter column date_installation drop not null,
  alter column date_constat drop not null,
  add column theme text,
  add column support_op text,
  add column statut text,
  add column op_trade text,
  add column niveau_operation text,
  add column date_fin_vente date,
  add column revente_fin date;

alter table promo_produits
  add column libelle_produit text,
  add column ca_nego numeric,
  add column ca_real numeric;
