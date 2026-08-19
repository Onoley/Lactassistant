-- supabase/migrations/0011_opportunites_schema.sql
create table opportunites (
  id uuid primary key default gen_random_uuid(),
  magasin_id uuid not null references magasins(id),
  produit_canonique_id uuid not null references produits(id),
  type_mission text not null check (type_mission in (
    'anticiper_promo','revendre_promo','constater_promo',
    'referencer_produit','corriger_rupture','securiser_commande',
    'suivre_engagement','optimiser_implantation','proposer_test_ht','verifier_information'
  )),
  promo_id uuid references promos(id),
  constraint promo_id_coherent_avec_type check (
    (type_mission in ('anticiper_promo','revendre_promo','constater_promo') and promo_id is not null)
    or (type_mission not in ('anticiper_promo','revendre_promo','constater_promo') and promo_id is null)
  ),
  statut text not null default 'detectee' check (statut in (
    'detectee','a_preparer','presentee','accord_obtenu','en_attente',
    'refusee','commandee','mise_en_place','a_constater','reussie','abandonnee'
  )),
  niveau_priorite text check (niveau_priorite in ('P1','P2','P3')),
  score integer,
  confiance text check (confiance in ('donnees_confirmees','recommandation_probable','information_a_verifier')),
  raisons_actuelles jsonb,
  score_calcule_at timestamptz,
  fingerprint text,
  version_moteur text,
  cycle integer not null default 1,
  derniere_reouverture_at timestamptz,
  cree_at timestamptz not null default now(),
  cloture_at timestamptz,
  prochaine_action_at date
);

create unique index opportunites_identite_promo
  on opportunites (magasin_id, produit_canonique_id, type_mission, promo_id) where promo_id is not null;
create unique index opportunites_identite_structurelle
  on opportunites (magasin_id, produit_canonique_id, type_mission) where promo_id is null;
create index opportunites_magasin_statut_niveau on opportunites (magasin_id, statut, niveau_priorite);
create index opportunites_promo on opportunites (promo_id) where promo_id is not null;

create table opportunite_evenements (
  id uuid primary key default gen_random_uuid(),
  opportunite_id uuid not null references opportunites(id) on delete cascade,
  type text not null check (type in (
    'creation','recalcul_score','changement_statut','preuve_ajoutee',
    'preuve_retiree','reouverture','presentee','decision','commentaire','cloture'
  )),
  visite_id uuid references visites(id),
  score_a_ce_moment integer,
  raisons jsonb,
  statut_avant text,
  statut_apres text,
  raison_refus text,
  commentaire text,
  cree_par uuid references profiles(id),
  cree_at timestamptz not null default now()
);
create index opportunite_evenements_opportunite_at on opportunite_evenements (opportunite_id, cree_at desc);

create table opportunite_promos_preuves (
  opportunite_id uuid not null references opportunites(id) on delete cascade,
  promo_id uuid not null references promos(id) on delete cascade,
  ajoute_at timestamptz not null default now(),
  primary key (opportunite_id, promo_id)
);

create or replace function verifier_preuve_promo_distincte()
returns trigger as $$
begin
  if exists (select 1 from opportunites where id = new.opportunite_id and promo_id = new.promo_id) then
    raise exception 'Une opportunité ne peut pas citer sa propre promotion principale comme preuve complémentaire';
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger trg_verifier_preuve_promo_distincte
  before insert or update on opportunite_promos_preuves
  for each row execute function verifier_preuve_promo_distincte();

create table statuts_produit_magasin_historique (
  id uuid primary key default gen_random_uuid(),
  magasin_id uuid not null references magasins(id),
  produit_id uuid not null references produits(id),
  statut text not null check (statut in ('present','manquant','rupture')),
  raison_absence text,
  visite_id uuid references visites(id),
  signale_par uuid references profiles(id),
  signale_at timestamptz not null default now()
);
create unique index historique_idempotence_visite
  on statuts_produit_magasin_historique (magasin_id, produit_id, visite_id) where visite_id is not null;
create index statuts_historique_recurrence on statuts_produit_magasin_historique (magasin_id, produit_id, signale_at desc);

-- RLS
alter table opportunites enable row level security;
create policy "opportunites_select_visible" on opportunites for select
  using (magasin_id in (select id from magasins where secteur_id in (select visible_secteurs())));
create policy "opportunites_write_own_secteur" on opportunites for all
  using (
    (select role from current_profile()) = 'admin'
    or ((select role from current_profile()) = 'commercial'
        and magasin_id in (select id from magasins where secteur_id = (select secteur_id from current_profile())))
  );

alter table opportunite_evenements enable row level security;
create policy "opportunite_evenements_select_visible" on opportunite_evenements for select
  using (opportunite_id in (
    select id from opportunites where magasin_id in (select id from magasins where secteur_id in (select visible_secteurs()))
  ));
create policy "opportunite_evenements_insert_own_secteur" on opportunite_evenements for insert
  with check (
    (select role from current_profile()) = 'admin'
    or ((select role from current_profile()) = 'commercial'
        and opportunite_id in (
          select id from opportunites where magasin_id in (select id from magasins where secteur_id = (select secteur_id from current_profile()))
        ))
  );

alter table opportunite_promos_preuves enable row level security;
create policy "opportunite_promos_preuves_select_visible" on opportunite_promos_preuves for select
  using (opportunite_id in (
    select id from opportunites where magasin_id in (select id from magasins where secteur_id in (select visible_secteurs()))
  ));
create policy "opportunite_promos_preuves_admin_write" on opportunite_promos_preuves for all
  using ((select role from current_profile()) = 'admin');

alter table statuts_produit_magasin_historique enable row level security;
create policy "statuts_historique_select_visible" on statuts_produit_magasin_historique for select
  using (magasin_id in (select id from magasins where secteur_id in (select visible_secteurs())));
create policy "statuts_historique_insert_own_secteur" on statuts_produit_magasin_historique for insert
  with check (
    (select role from current_profile()) = 'admin'
    or ((select role from current_profile()) = 'commercial'
        and magasin_id in (select id from magasins where secteur_id = (select secteur_id from current_profile())))
  );
