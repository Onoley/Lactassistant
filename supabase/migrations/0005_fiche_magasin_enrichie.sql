-- Raison d'absence d'un produit manquant, saisie par le commercial.
alter table statuts_produit_magasin
  add column raison_absence text
  check (raison_absence in ('pas_de_place_rayon', 'frein_prix', 'jamais_reference', 'concurrence_privilegiee', 'autre'));

-- PDL (part de linéaire) par magasin — données de suivi manuel, optionnelles,
-- non utilisées dans le calcul du moteur pour ce sous-projet.
create table pdl_magasin (
  magasin_id uuid primary key references magasins(id) on delete cascade,
  pdl_generale numeric,
  pdl_yaos numeric,
  pdl_siggis numeric,
  pdl_dessert numeric,
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id)
);

alter table pdl_magasin enable row level security;
create policy "pdl_select_visible" on pdl_magasin for select
  using (magasin_id in (select id from magasins where secteur_id in (select visible_secteurs())));
create policy "pdl_write_own_secteur" on pdl_magasin for insert
  with check (
    ((select role from current_profile()) = 'commercial' and magasin_id in (select id from magasins where secteur_id = (select secteur_id from current_profile())))
    or (select role from current_profile()) = 'admin'
  );
create policy "pdl_update_own_secteur" on pdl_magasin for update
  using (
    ((select role from current_profile()) = 'commercial' and magasin_id in (select id from magasins where secteur_id = (select secteur_id from current_profile())))
    or (select role from current_profile()) = 'admin'
  );

-- VMH national — un repère par produit, importé depuis un export panel
-- (une seule ligne par EAN, toute la catégorie). Référentiel global, lisible
-- par tous, éditable par l'admin uniquement (import).
create table vmh_national (
  produit_id uuid primary key references produits(id) on delete cascade,
  vmh_hyper numeric,
  vmh_super numeric,
  dv_hmsm numeric,
  dv_hyper numeric,
  dv_super numeric,
  prix_moyen numeric,
  periode_reference text,
  updated_at timestamptz not null default now()
);

alter table vmh_national enable row level security;
create policy "vmh_national_select_all" on vmh_national for select using (auth.role() = 'authenticated');
create policy "vmh_national_admin_write" on vmh_national for all
  using ((select role from current_profile()) = 'admin');
