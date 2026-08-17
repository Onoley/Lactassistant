-- Surface (m²) du magasin, présente dans le fichier source réel mais jamais
-- importée jusqu'ici. Affine la comparabilité entre magasins au-delà de
-- enseigne+taille (lib/engine/similarity.ts).
alter table magasins add column surface numeric;
