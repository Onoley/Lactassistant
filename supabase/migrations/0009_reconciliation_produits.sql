alter table produits add column produit_canonique_id uuid references produits(id);
alter table produits add column famille text;
alter table produits add column segment text;
alter table produits add column statut_catalogue text not null default 'permanent'
  check (statut_catalogue in ('permanent', 'a_qualifier', 'variante_promo', 'arrete'));
alter table produits add column type_liaison text
  check (type_liaison in ('conditionnement_promo', 'ancien_ean', 'repackaging'));

create index idx_produits_canonique on produits(produit_canonique_id);

-- Empêche l'auto-référence et tout chaînage : un produit ne peut pointer que
-- vers un produit dont le produit_canonique_id est lui-même null (un vrai
-- canonique). Empêche mécaniquement boucles et chaînes de plus d'un niveau.
create or replace function verifier_produit_canonique() returns trigger as $$
begin
  if new.produit_canonique_id is not null then
    if new.produit_canonique_id = new.id then
      raise exception 'Un produit ne peut pas être son propre canonique';
    end if;
    if exists (
      select 1 from produits
      where id = new.produit_canonique_id and produit_canonique_id is not null
    ) then
      raise exception 'Le produit canonique référencé (%) est lui-même une variante — pas de chaînage', new.produit_canonique_id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_verifier_produit_canonique
  before insert or update of produit_canonique_id on produits
  for each row execute function verifier_produit_canonique();

alter table produits_enseigne add column actif boolean not null default true;

-- Historique des imports "plan de vente" pour audit — un import ne supprime
-- jamais silencieusement, ce tableau permet de comprendre un écart constaté
-- plus tard.
create table imports_plan_de_vente (
  id uuid primary key default gen_random_uuid(),
  importe_par uuid references profiles(id),
  importe_at timestamptz not null default now(),
  resume jsonb not null
  -- resume: { [enseigne]: { references, ajouts, mises_a_jour, retraits, ean_inconnus } }
);

alter table imports_plan_de_vente enable row level security;
create policy "imports_plan_de_vente_select_all" on imports_plan_de_vente for select using (auth.role() = 'authenticated');
create policy "imports_plan_de_vente_admin_write" on imports_plan_de_vente for all
  using ((select role from current_profile()) = 'admin');
