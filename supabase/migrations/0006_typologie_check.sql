-- Contrainte ajoutée avec NOT VALID : empêche toute NOUVELLE valeur hors
-- 'obligatoire'/'picking' à partir de maintenant, sans invalider ni toucher
-- les lignes existantes qui portent encore un ancien schéma de classification
-- (T1-T4, H1-H4, MN, MD, Région) — leur réconciliation est une décision
-- métier distincte, hors périmètre de cette contrainte.
alter table produits_enseigne
  add constraint produits_enseigne_typologie_check
  check (typologie in ('obligatoire', 'picking')) not valid;
