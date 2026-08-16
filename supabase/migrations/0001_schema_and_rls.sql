-- supabase/migrations/0001_schema_and_rls.sql
create extension if not exists pgcrypto;

-- ============ SCHEMA ============

create table secteurs (
  id uuid primary key default gen_random_uuid(),
  nom text not null unique
);

create table profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('admin', 'manager', 'commercial')),
  secteur_id uuid references secteurs(id),
  manager_id uuid references profiles(id),
  user_id uuid unique references auth.users(id),
  created_at timestamptz not null default now()
);

create table magasins (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  nom text not null,
  enseigne text not null,
  taille text not null,
  adresse text,
  secteur_id uuid not null references secteurs(id),
  contact_nom text,
  contact_telephone text,
  contact_email text
);

create table produits (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  nom text not null,
  categorie text
);

create table priorites_produits (
  produit_id uuid primary key references produits(id),
  rang integer not null check (rang in (20, 50, 70)),
  updated_at timestamptz not null default now()
);

create table promos (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  enseigne text not null,
  mecanique text not null,
  date_installation date not null,
  date_debut_vente date not null,
  date_constat date not null,
  created_at timestamptz not null default now()
);

create table promo_produits (
  promo_id uuid not null references promos(id) on delete cascade,
  produit_id uuid not null references produits(id),
  primary key (promo_id, produit_id)
);

create table statuts_produit_magasin (
  magasin_id uuid not null references magasins(id),
  produit_id uuid not null references produits(id),
  statut text not null check (statut in ('present', 'manquant', 'rupture')),
  signale_par uuid references profiles(id),
  signale_at timestamptz not null default now(),
  primary key (magasin_id, produit_id)
);

create table visites (
  id uuid primary key default gen_random_uuid(),
  magasin_id uuid not null references magasins(id),
  commercial_id uuid not null references profiles(id),
  semaine text not null,
  jour date not null,
  statut text not null default 'planifie' check (statut in ('planifie', 'realise')),
  created_at timestamptz not null default now()
);

-- ============ HELPER FUNCTIONS ============

create or replace function public.current_profile()
returns profiles as $$
  select * from profiles where user_id = auth.uid();
$$ language sql stable security definer set search_path = public;

create or replace function public.visible_secteurs()
returns setof uuid as $$
  select id from secteurs where
    (select role from current_profile()) = 'admin'
    or (
      (select role from current_profile()) = 'manager'
      and id in (select secteur_id from profiles where manager_id = (select id from current_profile()))
    )
    or (
      (select role from current_profile()) = 'commercial'
      and id = (select secteur_id from current_profile())
    );
$$ language sql stable security definer set search_path = public;

-- Lie automatiquement un profil pré-créé par l'admin au compte auth.users
-- créé au premier login (appariement par email).
create or replace function public.handle_new_auth_user()
returns trigger as $$
begin
  update public.profiles set user_id = new.id
  where lower(email) = lower(new.email) and user_id is null;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ============ ROW LEVEL SECURITY ============

alter table secteurs enable row level security;
alter table profiles enable row level security;
alter table magasins enable row level security;
alter table produits enable row level security;
alter table priorites_produits enable row level security;
alter table promos enable row level security;
alter table promo_produits enable row level security;
alter table statuts_produit_magasin enable row level security;
alter table visites enable row level security;

-- secteurs
create policy "secteurs_select_visible" on secteurs for select
  using (id in (select visible_secteurs()));
create policy "secteurs_admin_write" on secteurs for all
  using ((select role from current_profile()) = 'admin');

-- profiles
create policy "profiles_select_own" on profiles for select
  using (user_id = auth.uid());
create policy "profiles_select_team" on profiles for select
  using (manager_id = (select id from current_profile()));
create policy "profiles_admin_all" on profiles for all
  using ((select role from current_profile()) = 'admin');

-- magasins
create policy "magasins_select_visible" on magasins for select
  using (secteur_id in (select visible_secteurs()));
create policy "magasins_admin_write" on magasins for all
  using ((select role from current_profile()) = 'admin');

-- produits, priorites_produits, promos, promo_produits : référentiel global lisible par tous
create policy "produits_select_all" on produits for select using (auth.role() = 'authenticated');
create policy "produits_admin_write" on produits for all
  using ((select role from current_profile()) = 'admin');

create policy "priorites_select_all" on priorites_produits for select using (auth.role() = 'authenticated');
create policy "priorites_admin_write" on priorites_produits for all
  using ((select role from current_profile()) = 'admin');

create policy "promos_select_all" on promos for select using (auth.role() = 'authenticated');
create policy "promos_admin_write" on promos for all
  using ((select role from current_profile()) = 'admin');

create policy "promo_produits_select_all" on promo_produits for select using (auth.role() = 'authenticated');
create policy "promo_produits_admin_write" on promo_produits for all
  using ((select role from current_profile()) = 'admin');

-- statuts_produit_magasin
create policy "statuts_select_visible" on statuts_produit_magasin for select
  using (magasin_id in (select id from magasins where secteur_id in (select visible_secteurs())));
create policy "statuts_write_own_secteur" on statuts_produit_magasin for insert
  with check (
    ((select role from current_profile()) = 'commercial' and magasin_id in (select id from magasins where secteur_id = (select secteur_id from current_profile())))
    or (select role from current_profile()) = 'admin'
  );
create policy "statuts_update_own_secteur" on statuts_produit_magasin for update
  using (
    ((select role from current_profile()) = 'commercial' and magasin_id in (select id from magasins where secteur_id = (select secteur_id from current_profile())))
    or (select role from current_profile()) = 'admin'
  );

-- visites
create policy "visites_select_visible" on visites for select
  using (magasin_id in (select id from magasins where secteur_id in (select visible_secteurs())));
create policy "visites_write_own" on visites for insert
  with check (
    (select role from current_profile()) = 'admin'
    or (
      (select role from current_profile()) = 'commercial'
      and commercial_id = (select id from current_profile())
      and magasin_id in (select id from magasins where secteur_id = (select secteur_id from current_profile()))
    )
  );
create policy "visites_update_own" on visites for update
  using (
    (select role from current_profile()) = 'admin'
    or (
      (select role from current_profile()) = 'commercial'
      and commercial_id = (select id from current_profile())
      and magasin_id in (select id from magasins where secteur_id = (select secteur_id from current_profile()))
    )
  );
create policy "visites_delete_own" on visites for delete
  using (
    (select role from current_profile()) = 'admin'
    or (
      (select role from current_profile()) = 'commercial'
      and commercial_id = (select id from current_profile())
      and magasin_id in (select id from magasins where secteur_id = (select secteur_id from current_profile()))
    )
  );
