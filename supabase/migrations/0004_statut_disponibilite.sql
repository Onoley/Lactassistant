-- Statut de disponibilité par enseigne : verrouille toute action de commande
-- tant qu'un produit n'est pas réellement commandable dans cette enseigne
-- (déréférencé, arrêt industriel, ou en attente de référencement).
alter table produits_enseigne
  add column statut_disponibilite text not null default 'commandable'
  check (statut_disponibilite in ('commandable', 'non_commandable', 'arret_industriel', 'en_attente_referencement'));
