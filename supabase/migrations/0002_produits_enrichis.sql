-- Enrichissement du référentiel produit avec les données réelles (EAN, marque, gamme, parfum, format)
alter table produits add column marque text;
alter table produits add column gamme text;
alter table produits add column parfum text;
alter table produits add column format text;

-- Typologie/assortiment par enseigne : indépendant du rang de priorité (priorites_produits.rang),
-- sert à détecter les produits qu'une enseigne référence mais qu'un magasin ne signale pas.
create table produits_enseigne (
  produit_id uuid not null references produits(id) on delete cascade,
  enseigne text not null,
  typologie text,
  primary key (produit_id, enseigne)
);

alter table produits_enseigne enable row level security;

create policy "produits_enseigne_select_all" on produits_enseigne for select using (auth.role() = 'authenticated');
create policy "produits_enseigne_admin_write" on produits_enseigne for all
  using ((select role from current_profile()) = 'admin');
