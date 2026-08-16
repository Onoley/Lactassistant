# Outil de préparation de visite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire une v1 fonctionnelle et déployable de l'outil de préparation de visite pour la force de vente Lactalis Ultra-frais France.

**Architecture:** Application web unique (Next.js App Router) avec Supabase comme backend (Postgres + Auth + Storage). Les écrans lisent directement Supabase via des Server Components ; les écritures passent par des Server Actions. Le contrôle d'accès par rôle/secteur est appliqué au niveau base de données (Row Level Security), jamais uniquement côté application.

**Tech Stack:** Next.js 14+ (TypeScript, App Router), Supabase (Postgres, Auth par lien magique, Storage), Tailwind CSS, Vitest pour les tests unitaires, déploiement Vercel.

**Spec:** [docs/superpowers/specs/2026-08-16-outil-force-vente-design.md](../specs/2026-08-16-outil-force-vente-design.md)

**Prérequis avant de commencer (hors plan, actions manuelles) :**
- Créer un projet Supabase (noter `Project URL`, `anon key`, `service_role key`)
- Créer un compte/projet Vercel pour le déploiement (peut attendre la fin du plan)

## Global Constraints

- Trois rôles exacts et uniquement ceux-là : `admin`, `manager`, `commercial` (valeur textuelle utilisée telle quelle en base et en TypeScript).
- Le contrôle d'accès par secteur/équipe est toujours vérifié en base (Row Level Security), jamais seulement dans l'interface.
- Authentification v1 : lien magique par email uniquement. Pas de mot de passe, pas de SSO Azure AD.
- Seul le rôle `admin` peut importer des données ou créer des utilisateurs.
- Import : upsert par identifiant naturel (jamais de duplication) ; les lignes invalides sont listées dans un rapport d'erreurs, les lignes valides sont importées quand même.
- `StatutProduitMagasin` et `Visite` ne conservent que le dernier état connu, pas un journal d'historique complet.
- Toutes les colonnes/objets TypeScript utilisent le même style `snake_case` que Postgres (pas de couche de mapping camelCase/snake_case).

---

### Task 1: Scaffolding du projet Next.js

**Files:**
- Create: projet Next.js complet (généré par la CLI : `package.json`, `tsconfig.json`, `app/`, `tailwind.config.ts`, etc.)
- Create: `vitest.config.ts`
- Create: `.env.local.example`
- Modify: `package.json` (script `test`)

**Interfaces:**
- Produces: commandes `npm run dev`, `npm run build`, `npm test` fonctionnelles.

- [ ] **Step 1: Générer le projet Next.js**

Run: `npx create-next-app@latest . --typescript --tailwind --eslint --app --no-src-dir --import-alias "@/*"`

Répondre "Yes" si demandé d'utiliser le répertoire non vide (il ne contient que `.git`, `.claude`, `docs`).

- [ ] **Step 2: Installer Vitest**

Run: `npm install -D vitest vite-tsconfig-paths`

- [ ] **Step 3: Créer la config Vitest**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { environment: 'node' },
})
```

- [ ] **Step 4: Ajouter le script de test**

Modifier `package.json`, section `scripts`, ajouter :
```json
"test": "vitest run --passWithNoTests"
```

- [ ] **Step 5: Créer le fichier d'exemple des variables d'environnement**

```bash
# .env.local.example
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Copier ce fichier en `.env.local` et remplir avec les valeurs du projet Supabase créé en prérequis. `.env.local` est déjà ignoré par le `.gitignore` généré par create-next-app.

- [ ] **Step 6: Vérifier**

Run: `npm test`
Expected: passe sans erreur (aucun fichier de test trouvé, c'est attendu à ce stade)

Run: `npm run build`
Expected: build réussi

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Next.js project with Tailwind and Vitest"
```

---

### Task 2: Schéma de base de données et Row Level Security

**Files:**
- Create: `supabase/migrations/0001_schema_and_rls.sql`

**Interfaces:**
- Produces: tables `secteurs`, `profiles`, `magasins`, `produits`, `priorites_produits`, `promos`, `promo_produits`, `statuts_produit_magasin`, `visites` ; fonctions SQL `current_profile()`, `visible_secteurs()`.

- [ ] **Step 1: Écrire la migration complète**

```sql
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
$$ language sql stable security definer;

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
$$ language sql stable security definer;

-- Lie automatiquement un profil pré-créé par l'admin au compte auth.users
-- créé au premier login (appariement par email).
create or replace function public.handle_new_auth_user()
returns trigger as $$
begin
  update public.profiles set user_id = new.id
  where email = new.email and user_id is null;
  return new;
end;
$$ language plpgsql security definer;

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
    magasin_id in (select id from magasins where secteur_id = (select secteur_id from current_profile()))
    or (select role from current_profile()) = 'admin'
  );
create policy "statuts_update_own_secteur" on statuts_produit_magasin for update
  using (
    magasin_id in (select id from magasins where secteur_id = (select secteur_id from current_profile()))
    or (select role from current_profile()) = 'admin'
  );

-- visites
create policy "visites_select_visible" on visites for select
  using (magasin_id in (select id from magasins where secteur_id in (select visible_secteurs())));
create policy "visites_write_own" on visites for insert
  with check (commercial_id = (select id from current_profile()));
create policy "visites_update_own" on visites for update
  using (commercial_id = (select id from current_profile()));
create policy "visites_delete_own" on visites for delete
  using (commercial_id = (select id from current_profile()));
```

- [ ] **Step 2: Appliquer la migration**

Dans le dashboard Supabase du projet créé en prérequis, ouvrir l'éditeur SQL, coller le contenu de `0001_schema_and_rls.sql`, exécuter.

Expected: toutes les tables apparaissent dans l'onglet Table Editor, sans erreur.

- [ ] **Step 3: Vérifier manuellement l'isolation par secteur**

Dans l'éditeur SQL Supabase, créer deux secteurs et deux profils de test (un par secteur), puis un magasin par secteur. Se connecter avec `set local role authenticated; set local request.jwt.claims...` n'est pas trivial en SQL editor — reporter ce test au Task 3 une fois le login réel fonctionnel (deux commerciaux de secteurs différents doivent voir des listes de magasins différentes).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_schema_and_rls.sql
git commit -m "feat: database schema and row level security policies"
```

---

### Task 3: Clients Supabase, types partagés et connexion par lien magique

**Files:**
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/admin.ts`
- Create: `lib/types.ts`
- Create: `middleware.ts`
- Create: `app/login/page.tsx`
- Create: `app/auth/callback/route.ts`
- Modify: `app/page.tsx`

**Interfaces:**
- Consumes: variables d'environnement `.env.local` (Task 1), tables `profiles` (Task 2)
- Produces: `createClient()` (browser), `createServerClient()` + `getCurrentProfile(supabase)` (server), `createAdminClient()`, tous les types de `lib/types.ts` réutilisés par toutes les tâches suivantes.

- [ ] **Step 1: Installer les dépendances Supabase**

Run: `npm install @supabase/supabase-js @supabase/ssr`

- [ ] **Step 2: Créer les types partagés**

```typescript
// lib/types.ts
export type Role = 'admin' | 'manager' | 'commercial'

export interface Profile {
  id: string
  email: string
  role: Role
  secteur_id: string | null
  manager_id: string | null
  user_id: string | null
}

export interface Magasin {
  id: string
  code: string
  nom: string
  enseigne: string
  taille: string
  adresse: string | null
  secteur_id: string
  contact_nom: string | null
  contact_telephone: string | null
  contact_email: string | null
}

export interface Produit {
  id: string
  code: string
  nom: string
  categorie: string | null
}

export interface PrioriteProduit {
  produit_id: string
  rang: 20 | 50 | 70
}

export interface Promo {
  id: string
  code: string
  enseigne: string
  mecanique: string
  date_installation: string
  date_debut_vente: string
  date_constat: string
}

export type StatutProduit = 'present' | 'manquant' | 'rupture'

export interface StatutProduitMagasin {
  magasin_id: string
  produit_id: string
  statut: StatutProduit
  signale_par: string | null
  signale_at: string
}

export type StatutVisite = 'planifie' | 'realise'

export interface Visite {
  id: string
  magasin_id: string
  commercial_id: string
  semaine: string
  jour: string
  statut: StatutVisite
}
```

- [ ] **Step 3: Créer le client navigateur**

```typescript
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
```

- [ ] **Step 4: Créer le client serveur et `getCurrentProfile`**

```typescript
// lib/supabase/server.ts
import { createServerClient as createSupabaseServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Profile } from '@/lib/types'

export function createServerClient() {
  const cookieStore = cookies()
  return createSupabaseServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    }
  )
}

export async function getCurrentProfile(
  supabase: ReturnType<typeof createServerClient>
): Promise<Profile | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('profiles').select('*').eq('user_id', user.id).single()
  return data as Profile | null
}
```

- [ ] **Step 5: Créer le client admin (service role)**

```typescript
// lib/supabase/admin.ts
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
```

- [ ] **Step 6: Créer le middleware de protection des routes**

```typescript
// middleware.ts
import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  const isPublicRoute = request.nextUrl.pathname.startsWith('/login') || request.nextUrl.pathname.startsWith('/auth/callback')

  if (!user && !isPublicRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (user && request.nextUrl.pathname.startsWith('/login')) {
    return NextResponse.redirect(new URL('/', request.url))
  }
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
```

- [ ] **Step 7: Créer la page de connexion**

```tsx
// app/login/page.tsx
'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [envoye, setEnvoye] = useState(false)
  const [erreur, setErreur] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) setErreur(error.message)
    else setEnvoye(true)
  }

  if (envoye) return <p className="p-6">Un lien de connexion a été envoyé à {email}.</p>

  return (
    <form onSubmit={handleSubmit} className="p-6 max-w-sm mx-auto space-y-3">
      <h1 className="text-xl font-bold">Connexion</h1>
      <input
        type="email"
        required
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="vous@lactalis.fr"
        className="border rounded px-3 py-2 w-full"
      />
      {erreur && <p className="text-red-600 text-sm">{erreur}</p>}
      <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded w-full">
        Recevoir le lien de connexion
      </button>
    </form>
  )
}
```

- [ ] **Step 8: Créer la route de callback du lien magique**

```typescript
// app/auth/callback/route.ts
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (code) {
    const supabase = createServerClient()
    await supabase.auth.exchangeCodeForSession(code)
  }

  return NextResponse.redirect(`${origin}/`)
}
```

- [ ] **Step 9: Rediriger la page d'accueil selon le rôle**

```tsx
// app/page.tsx
import { redirect } from 'next/navigation'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'

export default async function HomePage() {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) redirect('/login')
  if (profile.role === 'admin') redirect('/admin/import')
  if (profile.role === 'manager') redirect('/equipe')
  redirect('/semaine')
}
```

- [ ] **Step 10: Vérification manuelle**

Dans l'éditeur SQL Supabase, insérer un profil admin de test :
```sql
insert into profiles (email, role) values ('ton-email@example.com', 'admin');
```

Run: `npm run dev`

Aller sur `http://localhost:3000`, se connecter avec cet email, cliquer le lien reçu. Vérifier la redirection (échouera vers `/admin/import` en 404 pour l'instant, c'est attendu — les pages suivantes n'existent pas encore ; ce qui compte est que l'URL finale soit bien `/admin/import`).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: Supabase clients, shared types, and magic link login"
```

---

### Task 4: Import — parsing et validation de fichiers Excel/CSV

**Files:**
- Create: `lib/import/parser.ts`
- Create: `lib/import/mappers.ts`
- Test: `lib/import/parser.test.ts`
- Test: `lib/import/mappers.test.ts`

**Interfaces:**
- Produces: `readSpreadsheet(buffer)`, `parseRows(rows, mapRow)`, `ParseResult<T>`, `ImportError`, `mapMagasinRow`, `mapProduitRow`, `mapPromoRow`.

- [ ] **Step 1: Installer la librairie de lecture Excel/CSV**

Run: `npm install xlsx`

- [ ] **Step 2: Écrire le test du parseur générique**

```typescript
// lib/import/parser.test.ts
import { describe, expect, it } from 'vitest'
import { parseRows } from './parser'

describe('parseRows', () => {
  it('sépare les lignes valides des lignes en erreur', () => {
    const rows = [{ nom: 'A' }, { nom: '' }, { nom: 'C' }]
    const result = parseRows(rows, (row) => {
      if (!row.nom) throw new Error('nom manquant')
      return { nom: row.nom }
    })
    expect(result.valid).toEqual([{ nom: 'A' }, { nom: 'C' }])
    expect(result.errors).toEqual([{ row: 3, message: 'nom manquant' }])
  })
})
```

- [ ] **Step 3: Lancer le test, vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL, `parser.ts` n'existe pas

- [ ] **Step 4: Implémenter le parseur générique**

```typescript
// lib/import/parser.ts
import * as XLSX from 'xlsx'

export interface ImportError {
  row: number
  message: string
}

export interface ParseResult<T> {
  valid: T[]
  errors: ImportError[]
}

export function readSpreadsheet(buffer: ArrayBuffer): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
}

export function parseRows<T>(
  rows: Record<string, string>[],
  mapRow: (row: Record<string, string>) => T
): ParseResult<T> {
  const valid: T[] = []
  const errors: ImportError[] = []
  rows.forEach((row, index) => {
    try {
      valid.push(mapRow(row))
    } catch (err) {
      errors.push({ row: index + 2, message: (err as Error).message })
    }
  })
  return { valid, errors }
}
```

(`row: index + 2` : ligne 1 = en-têtes, index 0-based → première ligne de données = ligne 2 du fichier.)

- [ ] **Step 5: Lancer le test, vérifier qu'il passe**

Run: `npm test`
Expected: PASS

- [ ] **Step 6: Écrire le test des mappers métier**

```typescript
// lib/import/mappers.test.ts
import { describe, expect, it } from 'vitest'
import { mapMagasinRow, mapProduitRow, mapPromoRow } from './mappers'

describe('mapMagasinRow', () => {
  it('accepte une ligne valide', () => {
    const result = mapMagasinRow({ code: 'M1', nom: 'Carrefour Test', enseigne: 'Carrefour', taille: 'super', secteur: 'Nord', adresse: '', contact_nom: '', contact_telephone: '', contact_email: '' })
    expect(result.code).toBe('M1')
    expect(result.secteurNom).toBe('Nord')
  })

  it("rejette une ligne sans code", () => {
    expect(() => mapMagasinRow({ nom: 'X', enseigne: 'Carrefour', taille: 'super', secteur: 'Nord' })).toThrow('code')
  })
})

describe('mapProduitRow', () => {
  it('rejette un rang invalide', () => {
    expect(() => mapProduitRow({ code: 'P1', nom: 'Yaourt', rang: '30' })).toThrow('Rang')
  })

  it('accepte un rang valide', () => {
    const result = mapProduitRow({ code: 'P1', nom: 'Yaourt', rang: '20', categorie: 'Ultra-frais' })
    expect(result.rang).toBe(20)
  })
})

describe('mapPromoRow', () => {
  it('rejette une date mal formatée', () => {
    expect(() => mapPromoRow({
      code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%',
      date_installation: '01/09/2026', date_debut_vente: '2026-09-05', date_constat: '2026-09-10',
      produits_codes: 'P1;P2',
    })).toThrow('AAAA-MM-JJ')
  })

  it('découpe les codes produits multiples', () => {
    const result = mapPromoRow({
      code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%',
      date_installation: '2026-09-01', date_debut_vente: '2026-09-05', date_constat: '2026-09-10',
      produits_codes: 'P1; P2',
    })
    expect(result.produitsCodes).toEqual(['P1', 'P2'])
  })
})
```

- [ ] **Step 7: Lancer les tests, vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL, `mappers.ts` n'existe pas

- [ ] **Step 8: Implémenter les mappers**

```typescript
// lib/import/mappers.ts
export interface MagasinImport {
  code: string
  nom: string
  enseigne: string
  taille: string
  secteurNom: string
  adresse: string | null
  contactNom: string | null
  contactTelephone: string | null
  contactEmail: string | null
}

export interface ProduitImport {
  code: string
  nom: string
  categorie: string | null
  rang: 20 | 50 | 70
}

export interface PromoImport {
  code: string
  enseigne: string
  mecanique: string
  dateInstallation: string
  dateDebutVente: string
  dateConstat: string
  produitsCodes: string[]
}

function requireField(row: Record<string, string>, field: string): string {
  const value = row[field]?.trim()
  if (!value) throw new Error(`Champ "${field}" manquant ou vide`)
  return value
}

function requireDate(row: Record<string, string>, field: string): string {
  const value = requireField(row, field)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Champ "${field}" doit être au format AAAA-MM-JJ, reçu "${value}"`)
  }
  return value
}

export function mapMagasinRow(row: Record<string, string>): MagasinImport {
  return {
    code: requireField(row, 'code'),
    nom: requireField(row, 'nom'),
    enseigne: requireField(row, 'enseigne'),
    taille: requireField(row, 'taille'),
    secteurNom: requireField(row, 'secteur'),
    adresse: row.adresse?.trim() || null,
    contactNom: row.contact_nom?.trim() || null,
    contactTelephone: row.contact_telephone?.trim() || null,
    contactEmail: row.contact_email?.trim() || null,
  }
}

export function mapProduitRow(row: Record<string, string>): ProduitImport {
  const code = requireField(row, 'code')
  const nom = requireField(row, 'nom')
  const rangRaw = requireField(row, 'rang')
  const rang = Number(rangRaw)
  if (![20, 50, 70].includes(rang)) {
    throw new Error(`Rang "${rangRaw}" invalide, attendu 20, 50 ou 70`)
  }
  return { code, nom, categorie: row.categorie?.trim() || null, rang: rang as 20 | 50 | 70 }
}

export function mapPromoRow(row: Record<string, string>): PromoImport {
  return {
    code: requireField(row, 'code'),
    enseigne: requireField(row, 'enseigne'),
    mecanique: requireField(row, 'mecanique'),
    dateInstallation: requireDate(row, 'date_installation'),
    dateDebutVente: requireDate(row, 'date_debut_vente'),
    dateConstat: requireDate(row, 'date_constat'),
    produitsCodes: requireField(row, 'produits_codes').split(';').map(c => c.trim()).filter(Boolean),
  }
}
```

- [ ] **Step 9: Lancer les tests, vérifier qu'ils passent**

Run: `npm test`
Expected: PASS (tous les tests)

- [ ] **Step 10: Commit**

```bash
git add lib/import/parser.ts lib/import/mappers.ts lib/import/parser.test.ts lib/import/mappers.test.ts
git commit -m "feat: spreadsheet parsing and validation for data imports"
```

---

### Task 5: Pipeline d'import (Server Actions + interface admin)

**Files:**
- Create: `lib/import/actions.ts`
- Create: `app/admin/import/page.tsx`

**Interfaces:**
- Consumes: `readSpreadsheet`, `parseRows`, `mapMagasinRow`, `mapProduitRow`, `mapPromoRow` (Task 4) ; `getCurrentProfile`, `createServerClient`, `createAdminClient` (Task 3)
- Produces: `importMagasins(formData)`, `importProduits(formData)`, `importPromos(formData)`, chacune retournant `ImportSummary`.

- [ ] **Step 1: Implémenter les Server Actions d'import**

```typescript
// lib/import/actions.ts
'use server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { readSpreadsheet, parseRows, type ImportError } from './parser'
import { mapMagasinRow, mapProduitRow, mapPromoRow } from './mappers'

export interface ImportSummary {
  imported: number
  errors: ImportError[]
}

async function assertAdmin() {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (profile?.role !== 'admin') throw new Error('Réservé aux administrateurs')
}

export async function importMagasins(formData: FormData): Promise<ImportSummary> {
  await assertAdmin()
  const file = formData.get('file') as File
  const rows = readSpreadsheet(await file.arrayBuffer())
  const { valid, errors } = parseRows(rows, mapMagasinRow)

  const admin = createAdminClient()
  const secteurNoms = [...new Set(valid.map(m => m.secteurNom))]
  const { data: secteurs, error: secteursError } = await admin
    .from('secteurs')
    .upsert(secteurNoms.map(nom => ({ nom })), { onConflict: 'nom' })
    .select('id, nom')
  if (secteursError) throw secteursError

  const secteurIdByNom = new Map((secteurs ?? []).map(s => [s.nom, s.id]))
  const { error } = await admin.from('magasins').upsert(
    valid.map(m => ({
      code: m.code,
      nom: m.nom,
      enseigne: m.enseigne,
      taille: m.taille,
      adresse: m.adresse,
      secteur_id: secteurIdByNom.get(m.secteurNom),
      contact_nom: m.contactNom,
      contact_telephone: m.contactTelephone,
      contact_email: m.contactEmail,
    })),
    { onConflict: 'code' }
  )
  if (error) throw error

  return { imported: valid.length, errors }
}

export async function importProduits(formData: FormData): Promise<ImportSummary> {
  await assertAdmin()
  const file = formData.get('file') as File
  const rows = readSpreadsheet(await file.arrayBuffer())
  const { valid, errors } = parseRows(rows, mapProduitRow)

  const admin = createAdminClient()
  const { data: produits, error: produitsError } = await admin
    .from('produits')
    .upsert(valid.map(p => ({ code: p.code, nom: p.nom, categorie: p.categorie })), { onConflict: 'code' })
    .select('id, code')
  if (produitsError) throw produitsError

  const idByCode = new Map((produits ?? []).map(p => [p.code, p.id]))
  const { error: prioritesError } = await admin.from('priorites_produits').upsert(
    valid.map(p => ({ produit_id: idByCode.get(p.code), rang: p.rang })),
    { onConflict: 'produit_id' }
  )
  if (prioritesError) throw prioritesError

  return { imported: valid.length, errors }
}

export async function importPromos(formData: FormData): Promise<ImportSummary> {
  await assertAdmin()
  const file = formData.get('file') as File
  const rows = readSpreadsheet(await file.arrayBuffer())
  const { valid, errors } = parseRows(rows, mapPromoRow)

  const admin = createAdminClient()
  const { data: promos, error: promosError } = await admin
    .from('promos')
    .upsert(
      valid.map(p => ({
        code: p.code,
        enseigne: p.enseigne,
        mecanique: p.mecanique,
        date_installation: p.dateInstallation,
        date_debut_vente: p.dateDebutVente,
        date_constat: p.dateConstat,
      })),
      { onConflict: 'code' }
    )
    .select('id, code')
  if (promosError) throw promosError

  const { data: produits } = await admin.from('produits').select('id, code')
  const produitIdByCode = new Map((produits ?? []).map(p => [p.code, p.id]))
  const promoIdByCode = new Map((promos ?? []).map(p => [p.code, p.id]))

  const links = valid.flatMap(p => {
    const promoId = promoIdByCode.get(p.code)
    return p.produitsCodes
      .map(code => produitIdByCode.get(code))
      .filter((id): id is string => Boolean(id))
      .map(produitId => ({ promo_id: promoId, produit_id: produitId }))
  })

  if (links.length > 0) {
    const { error: linksError } = await admin.from('promo_produits').upsert(links, { onConflict: 'promo_id,produit_id' })
    if (linksError) throw linksError
  }

  return { imported: valid.length, errors }
}
```

- [ ] **Step 2: Créer l'interface d'import admin**

```tsx
// app/admin/import/page.tsx
'use client'
import { useState } from 'react'
import { importMagasins, importProduits, importPromos, type ImportSummary } from '@/lib/import/actions'

function ImportForm({ label, action }: { label: string; action: (formData: FormData) => Promise<ImportSummary> }) {
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(formData: FormData) {
    setPending(true)
    try {
      setSummary(await action(formData))
    } finally {
      setPending(false)
    }
  }

  return (
    <form action={handleSubmit} className="space-y-2 border rounded p-4">
      <h2 className="font-semibold">{label}</h2>
      <input type="file" name="file" accept=".csv,.xlsx" required />
      <button type="submit" disabled={pending} className="bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50">
        {pending ? 'Import en cours...' : 'Importer'}
      </button>
      {summary && (
        <div>
          <p>{summary.imported} ligne(s) importée(s).</p>
          {summary.errors.length > 0 && (
            <ul className="text-red-600 text-sm">
              {summary.errors.map(e => <li key={e.row}>Ligne {e.row} : {e.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </form>
  )
}

export default function ImportPage() {
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-bold">Import de données</h1>
      <ImportForm label="Magasins" action={importMagasins} />
      <ImportForm label="Produits et priorités" action={importProduits} />
      <ImportForm label="Promos catalogue" action={importPromos} />
    </div>
  )
}
```

- [ ] **Step 3: Vérification manuelle**

Créer un fichier `test-magasins.csv` :
```csv
code,nom,enseigne,taille,secteur,adresse,contact_nom,contact_telephone,contact_email
M1,Carrefour Test Nord,Carrefour,super,Nord,1 rue Test,Jean Dupont,0102030405,jean@test.fr
M2,,Carrefour,super,Nord,,,,
```

Run: `npm run dev`

Se connecter en admin, aller sur `/admin/import`, importer ce fichier.
Expected: "1 ligne(s) importée(s)" et une erreur listée pour la ligne 3 (nom manquant). Réimporter le même fichier : toujours 1 ligne importée, pas de doublon dans la table `magasins` (vérifier dans le Table Editor Supabase).

- [ ] **Step 4: Commit**

```bash
git add lib/import/actions.ts app/admin/import/page.tsx
git commit -m "feat: admin data import pipeline with error reporting"
```

---

### Task 6: Gestion des utilisateurs (admin)

**Files:**
- Create: `lib/utilisateurs/actions.ts`
- Create: `app/admin/utilisateurs/page.tsx`
- Create: `app/admin/utilisateurs/utilisateur-form.tsx`

**Interfaces:**
- Consumes: `getCurrentProfile`, `createServerClient`, `createAdminClient` (Task 3), `Role` (Task 3)
- Produces: `creerUtilisateur(email, role, secteurId, managerId)`

- [ ] **Step 1: Implémenter la Server Action**

```typescript
// lib/utilisateurs/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Role } from '@/lib/types'

export async function creerUtilisateur(
  email: string,
  role: Role,
  secteurId: string | null,
  managerId: string | null
) {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (profile?.role !== 'admin') throw new Error('Réservé aux administrateurs')

  const admin = createAdminClient()
  const { error } = await admin.from('profiles').insert({
    email, role, secteur_id: secteurId, manager_id: managerId,
  })
  if (error) throw error
  revalidatePath('/admin/utilisateurs')
}
```

- [ ] **Step 2: Créer le formulaire client**

```tsx
// app/admin/utilisateurs/utilisateur-form.tsx
'use client'
import { useState } from 'react'
import { creerUtilisateur } from '@/lib/utilisateurs/actions'
import type { Role } from '@/lib/types'

export function UtilisateurForm({ secteurs, managers }: { secteurs: { id: string; nom: string }[]; managers: { id: string; email: string }[] }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('commercial')
  const [secteurId, setSecteurId] = useState('')
  const [managerId, setManagerId] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    await creerUtilisateur(email, role, secteurId || null, managerId || null)
    setEmail('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-end flex-wrap">
      <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email" className="border rounded px-2 py-1" />
      <select value={role} onChange={e => setRole(e.target.value as Role)} className="border rounded px-2 py-1">
        <option value="commercial">Commercial</option>
        <option value="manager">Manager</option>
        <option value="admin">Admin</option>
      </select>
      {role === 'commercial' && (
        <>
          <select value={secteurId} onChange={e => setSecteurId(e.target.value)} className="border rounded px-2 py-1">
            <option value="">Secteur...</option>
            {secteurs.map(s => <option key={s.id} value={s.id}>{s.nom}</option>)}
          </select>
          <select value={managerId} onChange={e => setManagerId(e.target.value)} className="border rounded px-2 py-1">
            <option value="">Manager...</option>
            {managers.map(m => <option key={m.id} value={m.id}>{m.email}</option>)}
          </select>
        </>
      )}
      <button type="submit" className="bg-blue-600 text-white px-3 py-1 rounded">Ajouter</button>
    </form>
  )
}
```

- [ ] **Step 3: Créer la page admin**

```tsx
// app/admin/utilisateurs/page.tsx
import { createServerClient } from '@/lib/supabase/server'
import { UtilisateurForm } from './utilisateur-form'

export default async function UtilisateursPage() {
  const supabase = createServerClient()
  const { data: profiles } = await supabase.from('profiles').select('*').order('email')
  const { data: secteurs } = await supabase.from('secteurs').select('*').order('nom')
  const managers = (profiles ?? []).filter(p => p.role === 'manager')

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Utilisateurs</h1>
      <UtilisateurForm secteurs={secteurs ?? []} managers={managers} />
      <table className="w-full text-sm">
        <thead><tr><th className="text-left">Email</th><th className="text-left">Rôle</th><th className="text-left">Secteur</th></tr></thead>
        <tbody>
          {(profiles ?? []).map(p => (
            <tr key={p.id}>
              <td>{p.email}</td>
              <td>{p.role}</td>
              <td>{secteurs?.find(s => s.id === p.secteur_id)?.nom ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Vérification manuelle**

Run: `npm run dev`, se connecter en admin, aller sur `/admin/utilisateurs`, créer un commercial avec un secteur (créé au Task 5 via l'import). Vérifier qu'il apparaît dans le tableau.

- [ ] **Step 5: Commit**

```bash
git add lib/utilisateurs/actions.ts app/admin/utilisateurs/
git commit -m "feat: admin user management"
```

---

### Task 7: Liste des magasins et fiche magasin

**Files:**
- Create: `app/magasins/page.tsx`
- Create: `app/magasins/[id]/page.tsx`

**Interfaces:**
- Consumes: `createServerClient` (Task 3), table `magasins`/`produits`/`statuts_produit_magasin` (Task 2)

- [ ] **Step 1: Créer la liste des magasins**

```tsx
// app/magasins/page.tsx
import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'

export default async function MagasinsPage() {
  const supabase = createServerClient()
  const { data: magasins } = await supabase.from('magasins').select('*').order('nom')

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Mes magasins</h1>
      <ul className="space-y-1">
        {(magasins ?? []).map(m => (
          <li key={m.id}>
            <Link href={`/magasins/${m.id}`} className="text-blue-600 underline">{m.nom} — {m.enseigne}</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Créer la fiche magasin**

```tsx
// app/magasins/[id]/page.tsx
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { StatutProduit } from '@/lib/types'

export default async function FicheMagasinPage({ params }: { params: { id: string } }) {
  const supabase = createServerClient()
  const { data: magasin } = await supabase.from('magasins').select('*').eq('id', params.id).single()
  if (!magasin) notFound()

  const { data: produits } = await supabase.from('produits').select('*').order('nom')
  const { data: statuts } = await supabase.from('statuts_produit_magasin').select('*').eq('magasin_id', magasin.id)
  const statutParProduit = new Map((statuts ?? []).map(s => [s.produit_id, s.statut as StatutProduit]))

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">{magasin.nom} — {magasin.enseigne}</h1>
      <p className="text-sm text-gray-600">{magasin.adresse}</p>
      {magasin.contact_nom && (
        <p className="text-sm">Contact : {magasin.contact_nom} — {magasin.contact_telephone} — {magasin.contact_email}</p>
      )}

      <table className="w-full text-sm">
        <thead><tr><th className="text-left">Produit</th><th className="text-left">Statut</th></tr></thead>
        <tbody>
          {(produits ?? []).map(p => (
            <tr key={p.id}>
              <td>{p.nom}</td>
              <td>{statutParProduit.get(p.id) ?? 'present'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Vérification manuelle**

Se connecter en commercial (rattaché au secteur "Nord" créé au Task 5), aller sur `/magasins`. Vérifier que seul le magasin de son secteur apparaît (la RLS du Task 2 filtre automatiquement). Cliquer dessus, vérifier l'affichage du contact et de la liste produits.

- [ ] **Step 4: Commit**

```bash
git add app/magasins/
git commit -m "feat: store list and store detail page"
```

---

### Task 8: Signalement du statut produit

**Files:**
- Create: `lib/statuts/actions.ts`
- Create: `app/magasins/[id]/statut-select.tsx`
- Modify: `app/magasins/[id]/page.tsx`

**Interfaces:**
- Consumes: `getCurrentProfile`, `createServerClient` (Task 3), `StatutProduit` (Task 3)
- Produces: `updateStatutProduit(magasinId, produitId, statut)`

- [ ] **Step 1: Implémenter la Server Action**

```typescript
// lib/statuts/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import type { StatutProduit } from '@/lib/types'

export async function updateStatutProduit(magasinId: string, produitId: string, statut: StatutProduit) {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) throw new Error('Non authentifié')

  const { error } = await supabase.from('statuts_produit_magasin').upsert(
    { magasin_id: magasinId, produit_id: produitId, statut, signale_par: profile.id, signale_at: new Date().toISOString() },
    { onConflict: 'magasin_id,produit_id' }
  )
  if (error) throw error
  revalidatePath(`/magasins/${magasinId}`)
}
```

- [ ] **Step 2: Créer le sélecteur client**

```tsx
// app/magasins/[id]/statut-select.tsx
'use client'
import { useTransition } from 'react'
import { updateStatutProduit } from '@/lib/statuts/actions'
import type { StatutProduit } from '@/lib/types'

export function StatutSelect({ magasinId, produitId, statutActuel }: { magasinId: string; produitId: string; statutActuel: StatutProduit }) {
  const [pending, startTransition] = useTransition()

  return (
    <select
      defaultValue={statutActuel}
      disabled={pending}
      onChange={e => startTransition(() => updateStatutProduit(magasinId, produitId, e.target.value as StatutProduit))}
      className="border rounded px-2 py-1"
    >
      <option value="present">Présent</option>
      <option value="manquant">Manquant</option>
      <option value="rupture">Rupture</option>
    </select>
  )
}
```

- [ ] **Step 3: Intégrer le sélecteur dans la fiche magasin**

Modifier `app/magasins/[id]/page.tsx`, ajouter l'import et remplacer la cellule statut :

```typescript
import { StatutSelect } from './statut-select'
```

```tsx
<td>
  <StatutSelect
    magasinId={magasin.id}
    produitId={p.id}
    statutActuel={statutParProduit.get(p.id) ?? 'present'}
  />
</td>
```

- [ ] **Step 4: Vérification manuelle**

Sur la fiche magasin en tant que commercial, changer le statut d'un produit à "rupture". Rafraîchir la page : le statut reste "rupture" (persisté). Essayer de modifier un magasin d'un autre secteur en forçant l'URL : la requête doit échouer côté RLS (le magasin n'apparaît même pas, `notFound()`).

- [ ] **Step 5: Commit**

```bash
git add lib/statuts/actions.ts app/magasins/[id]/
git commit -m "feat: report product status on store detail page"
```

---

### Task 9: Moteur de similarité entre magasins

**Files:**
- Create: `lib/engine/similarity.ts`
- Test: `lib/engine/similarity.test.ts`

**Interfaces:**
- Consumes: `Magasin` (Task 3)
- Produces: `magasinsSimilaires(cible, tousLesMagasins, critere)`, type `CritereSimilarite`

- [ ] **Step 1: Écrire le test**

```typescript
// lib/engine/similarity.test.ts
import { describe, expect, it } from 'vitest'
import { magasinsSimilaires } from './similarity'
import type { Magasin } from '@/lib/types'

function magasin(overrides: Partial<Magasin>): Magasin {
  return {
    id: 'm', code: 'c', nom: 'n', enseigne: 'Carrefour', taille: 'super',
    adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null,
    ...overrides,
  }
}

describe('magasinsSimilaires', () => {
  const cible = magasin({ id: '1', enseigne: 'Carrefour', taille: 'super' })
  const tous = [
    cible,
    magasin({ id: '2', enseigne: 'Carrefour', taille: 'super' }),
    magasin({ id: '3', enseigne: 'Carrefour', taille: 'hyper' }),
    magasin({ id: '4', enseigne: 'Leclerc', taille: 'super' }),
  ]

  it('exclut le magasin cible lui-même', () => {
    const result = magasinsSimilaires(cible, tous, 'les_deux')
    expect(result.find(m => m.id === '1')).toBeUndefined()
  })

  it('filtre par enseigne seule', () => {
    const result = magasinsSimilaires(cible, tous, 'enseigne')
    expect(result.map(m => m.id).sort()).toEqual(['2', '3'])
  })

  it('filtre par taille seule', () => {
    const result = magasinsSimilaires(cible, tous, 'taille')
    expect(result.map(m => m.id).sort()).toEqual(['2', '4'])
  })

  it('filtre par enseigne et taille', () => {
    const result = magasinsSimilaires(cible, tous, 'les_deux')
    expect(result.map(m => m.id)).toEqual(['2'])
  })
})
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL, `similarity.ts` n'existe pas

- [ ] **Step 3: Implémenter**

```typescript
// lib/engine/similarity.ts
import type { Magasin } from '@/lib/types'

export type CritereSimilarite = 'enseigne' | 'taille' | 'les_deux'

export function magasinsSimilaires(
  cible: Magasin,
  tousLesMagasins: Magasin[],
  critere: CritereSimilarite
): Magasin[] {
  return tousLesMagasins.filter(m => {
    if (m.id === cible.id) return false
    if (critere === 'enseigne') return m.enseigne === cible.enseigne
    if (critere === 'taille') return m.taille === cible.taille
    return m.enseigne === cible.enseigne && m.taille === cible.taille
  })
}
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/engine/similarity.ts lib/engine/similarity.test.ts
git commit -m "feat: store similarity engine"
```

---

### Task 10: Moteur de score de priorité

**Files:**
- Create: `lib/engine/scoring.ts`
- Test: `lib/engine/scoring.test.ts`

**Interfaces:**
- Produces: `scoreRangProduit(rang)`, `scoreUrgenceDate(dateIso, aujourdHui?)`, `scorePriorite(rang, dateProchainJalonIso, aujourdHui?)`, type `Rang`

- [ ] **Step 1: Écrire le test**

```typescript
// lib/engine/scoring.test.ts
import { describe, expect, it } from 'vitest'
import { scoreRangProduit, scoreUrgenceDate, scorePriorite } from './scoring'

describe('scoreRangProduit', () => {
  it('donne un score plus élevé aux rangs prioritaires', () => {
    expect(scoreRangProduit(20)).toBeGreaterThan(scoreRangProduit(50))
    expect(scoreRangProduit(50)).toBeGreaterThan(scoreRangProduit(70))
  })
})

describe('scoreUrgenceDate', () => {
  const aujourdHui = new Date('2026-08-16')

  it('score maximal pour une échéance dans la semaine', () => {
    expect(scoreUrgenceDate('2026-08-20', aujourdHui)).toBe(100)
  })

  it('score moyen pour une échéance dans 10 jours', () => {
    expect(scoreUrgenceDate('2026-08-26', aujourdHui)).toBe(60)
  })

  it('score faible pour une échéance lointaine', () => {
    expect(scoreUrgenceDate('2026-10-01', aujourdHui)).toBe(20)
  })

  it('score intermédiaire pour une date passée récemment', () => {
    expect(scoreUrgenceDate('2026-08-10', aujourdHui)).toBe(40)
  })
})

describe('scorePriorite', () => {
  it('combine rang et urgence', () => {
    const aujourdHui = new Date('2026-08-16')
    expect(scorePriorite(20, '2026-08-20', aujourdHui)).toBe(scoreRangProduit(20) + 100)
  })
})
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL, `scoring.ts` n'existe pas

- [ ] **Step 3: Implémenter**

```typescript
// lib/engine/scoring.ts
export type Rang = 20 | 50 | 70

const SCORE_PAR_RANG: Record<Rang, number> = { 20: 100, 50: 60, 70: 30 }

// ponytail: poids de score arbitraires (rang et urgence) — à recalibrer avec des
// retours terrain réels une fois l'outil utilisé en conditions réelles.
export function scoreRangProduit(rang: Rang): number {
  return SCORE_PAR_RANG[rang]
}

export function scoreUrgenceDate(dateIso: string, aujourdHui: Date = new Date()): number {
  const jours = Math.ceil((new Date(dateIso).getTime() - aujourdHui.getTime()) / 86_400_000)
  if (jours < 0) return 40
  if (jours <= 7) return 100
  if (jours <= 14) return 60
  return 20
}

export function scorePriorite(rang: Rang, dateProchainJalonIso: string, aujourdHui?: Date): number {
  return scoreRangProduit(rang) + scoreUrgenceDate(dateProchainJalonIso, aujourdHui)
}
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/engine/scoring.ts lib/engine/scoring.test.ts
git commit -m "feat: priority scoring engine"
```

---

### Task 11: Argumentaire et agrégation des priorités

**Files:**
- Create: `lib/engine/arguments.ts`
- Create: `lib/engine/priorites.ts`
- Test: `lib/engine/arguments.test.ts`
- Test: `lib/engine/priorites.test.ts`

**Interfaces:**
- Consumes: `magasinsSimilaires` (Task 9), `scoreRangProduit`/`scorePriorite` (Task 10), types `Magasin`/`Produit`/`Promo`/`PrioriteProduit`/`StatutProduitMagasin`/`StatutProduit` (Task 3)
- Produces: `genererArguments(...)` → `{ arguments: Argument[]; score: number }` ; `calculerPrioritesMagasins(...)` → `PrioriteMagasin[]`

- [ ] **Step 1: Écrire le test de l'argumentaire**

```typescript
// lib/engine/arguments.test.ts
import { describe, expect, it } from 'vitest'
import { genererArguments } from './arguments'
import type { Magasin, Produit, Promo, StatutProduit } from '@/lib/types'

function magasin(id: string, overrides: Partial<Magasin> = {}): Magasin {
  return { id, code: id, nom: id, enseigne: 'Carrefour', taille: 'super', adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null, ...overrides }
}

const produit: Produit = { id: 'p1', code: 'P1', nom: 'Yaourt nature', categorie: null }

describe('genererArguments', () => {
  it('signale les magasins similaires qui ont le produit', () => {
    const cible = magasin('1')
    const tous = [cible, magasin('2'), magasin('3', { enseigne: 'Leclerc' })]
    const statuts = new Map<string, StatutProduit>([['2', 'present']])
    const { arguments: args } = genererArguments(cible, produit, 20, tous, statuts, [], 'les_deux')
    expect(args.some(a => a.type === 'magasins_similaires' && a.message.includes('1'))).toBe(true)
  })

  it('signale les promos et calcule un score', () => {
    const cible = magasin('1')
    const promo: Promo = { id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%', date_installation: '2026-08-18', date_debut_vente: '2026-08-20', date_constat: '2026-08-25' }
    const { arguments: args, score } = genererArguments(cible, produit, 20, [cible], new Map(), [promo], 'les_deux')
    expect(args.some(a => a.type === 'promo')).toBe(true)
    expect(score).toBeGreaterThan(0)
  })

  it("score basé sur le rang seul en l'absence de promo", () => {
    const cible = magasin('1')
    const { score } = genererArguments(cible, produit, 20, [cible], new Map(), [], 'les_deux')
    expect(score).toBe(100)
  })
})
```

- [ ] **Step 2: Écrire le test de l'agrégation**

```typescript
// lib/engine/priorites.test.ts
import { describe, expect, it } from 'vitest'
import { calculerPrioritesMagasins } from './priorites'
import type { Magasin, Produit, PrioriteProduit, StatutProduitMagasin } from '@/lib/types'

function magasin(id: string): Magasin {
  return { id, code: id, nom: `Magasin ${id}`, enseigne: 'Carrefour', taille: 'super', adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null }
}

describe('calculerPrioritesMagasins', () => {
  it('trie les magasins par score décroissant et ignore ceux sans manque', () => {
    const magasins = [magasin('1'), magasin('2'), magasin('3')]
    const produits = new Map<string, Produit>([['p1', { id: 'p1', code: 'P1', nom: 'Yaourt', categorie: null }]])
    const priorites = new Map<string, PrioriteProduit>([['p1', { produit_id: 'p1', rang: 20 }]])
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
      { magasin_id: '2', produit_id: 'p1', statut: 'present', signale_par: null, signale_at: '' },
    ]

    const result = calculerPrioritesMagasins(magasins, statuts, produits, priorites, new Map())

    expect(result).toHaveLength(1)
    expect(result[0].magasin.id).toBe('1')
    expect(result[0].raisons).toContain('Yaourt (manquant)')
  })
})
```

- [ ] **Step 3: Lancer les tests, vérifier qu'ils échouent**

Run: `npm test`
Expected: FAIL, `arguments.ts` et `priorites.ts` n'existent pas

- [ ] **Step 4: Implémenter l'argumentaire**

```typescript
// lib/engine/arguments.ts
import type { Magasin, Produit, Promo, StatutProduit } from '@/lib/types'
import { magasinsSimilaires, type CritereSimilarite } from './similarity'
import { scoreRangProduit, scorePriorite, type Rang } from './scoring'

export interface Argument {
  type: 'magasins_similaires' | 'promo'
  message: string
}

export function genererArguments(
  magasin: Magasin,
  produit: Produit,
  rang: Rang,
  tousLesMagasins: Magasin[],
  statutsParMagasin: Map<string, StatutProduit>,
  promosDuProduit: Promo[],
  critere: CritereSimilarite
): { arguments: Argument[]; score: number } {
  const args: Argument[] = []
  const similaires = magasinsSimilaires(magasin, tousLesMagasins, critere)
  const presentsChezSimilaires = similaires.filter(m => statutsParMagasin.get(m.id) === 'present')

  if (presentsChezSimilaires.length > 0) {
    args.push({
      type: 'magasins_similaires',
      message: `Présent dans ${presentsChezSimilaires.length} magasin(s) similaire(s) sur ${similaires.length}.`,
    })
  }

  for (const promo of promosDuProduit) {
    args.push({
      type: 'promo',
      message: `Promo "${promo.mecanique}" chez ${promo.enseigne} : installation le ${promo.date_installation}, vente le ${promo.date_debut_vente}.`,
    })
  }

  const score = promosDuProduit.length > 0
    ? Math.max(...promosDuProduit.map(p => scorePriorite(rang, [p.date_installation, p.date_debut_vente, p.date_constat].sort()[0])))
    : scoreRangProduit(rang)

  return { arguments: args, score }
}
```

- [ ] **Step 5: Implémenter l'agrégation par secteur**

```typescript
// lib/engine/priorites.ts
import type { Magasin, Produit, PrioriteProduit, Promo, StatutProduitMagasin } from '@/lib/types'
import { scoreRangProduit, scorePriorite } from './scoring'

export interface PrioriteMagasin {
  magasin: Magasin
  score: number
  raisons: string[]
}

export function calculerPrioritesMagasins(
  magasins: Magasin[],
  statuts: StatutProduitMagasin[],
  produitsParId: Map<string, Produit>,
  prioritesParProduitId: Map<string, PrioriteProduit>,
  promosParProduitId: Map<string, Promo[]>
): PrioriteMagasin[] {
  const statutsParMagasin = new Map<string, StatutProduitMagasin[]>()
  for (const s of statuts) {
    if (s.statut === 'present') continue
    const liste = statutsParMagasin.get(s.magasin_id) ?? []
    liste.push(s)
    statutsParMagasin.set(s.magasin_id, liste)
  }

  return magasins
    .map(magasin => {
      const manquants = statutsParMagasin.get(magasin.id) ?? []
      let score = 0
      const raisons: string[] = []
      for (const statut of manquants) {
        const priorite = prioritesParProduitId.get(statut.produit_id)
        if (!priorite) continue
        const produit = produitsParId.get(statut.produit_id)
        const promos = promosParProduitId.get(statut.produit_id) ?? []
        const scoreProduit = promos.length > 0
          ? Math.max(...promos.map(p => scorePriorite(priorite.rang, [p.date_installation, p.date_debut_vente, p.date_constat].sort()[0])))
          : scoreRangProduit(priorite.rang)
        if (scoreProduit > score) score = scoreProduit
        if (produit) raisons.push(`${produit.nom} (${statut.statut})`)
      }
      return { magasin, score, raisons }
    })
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
}
```

- [ ] **Step 6: Lancer les tests, vérifier qu'ils passent**

Run: `npm test`
Expected: PASS (tous les tests)

- [ ] **Step 7: Commit**

```bash
git add lib/engine/arguments.ts lib/engine/priorites.ts lib/engine/arguments.test.ts lib/engine/priorites.test.ts
git commit -m "feat: sales argument generation and store priority aggregation"
```

---

### Task 12: Intégration de l'argumentaire sur la fiche magasin

**Files:**
- Create: `lib/engine/fiche-magasin.ts`
- Modify: `app/magasins/[id]/page.tsx`

**Interfaces:**
- Consumes: `genererArguments` (Task 11), `createAdminClient` (Task 3), `createServerClient` (Task 3)
- Produces: `chargerArgumentsFicheMagasin(magasinId, critere)` → `LigneProduitAvecArguments[]`

- [ ] **Step 1: Implémenter le chargement des arguments**

```typescript
// lib/engine/fiche-magasin.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { genererArguments, type Argument } from './arguments'
import type { CritereSimilarite } from './similarity'
import type { StatutProduit } from '@/lib/types'

export interface LigneProduitAvecArguments {
  produitId: string
  produitNom: string
  statut: StatutProduit
  arguments: Argument[]
  score: number
}

export async function chargerArgumentsFicheMagasin(
  magasinId: string,
  critere: CritereSimilarite = 'les_deux'
): Promise<LigneProduitAvecArguments[]> {
  const supabase = createServerClient()
  const { data: magasin } = await supabase.from('magasins').select('*').eq('id', magasinId).single()
  if (!magasin) return []

  const { data: produits } = await supabase.from('produits').select('*')
  const { data: statuts } = await supabase.from('statuts_produit_magasin').select('*').eq('magasin_id', magasinId)
  const { data: priorites } = await supabase.from('priorites_produits').select('*')

  const prioriteParProduit = new Map((priorites ?? []).map(p => [p.produit_id, p]))
  const statutParProduit = new Map((statuts ?? []).map(s => [s.produit_id, s.statut as StatutProduit]))
  const manquants = (produits ?? []).filter(p => {
    const s = statutParProduit.get(p.id)
    return s === 'manquant' || s === 'rupture'
  })
  if (manquants.length === 0) return []

  // Lecture parc entier via client admin : nécessaire pour comparer avec des
  // magasins hors du secteur du commercial connecté (RLS ne l'autoriserait pas).
  const admin = createAdminClient()
  const { data: tousLesMagasins } = await admin.from('magasins').select('*')
  const { data: tousLesStatuts } = await admin
    .from('statuts_produit_magasin')
    .select('*')
    .in('produit_id', manquants.map(p => p.id))
  const { data: promoLiens } = await admin
    .from('promo_produits')
    .select('produit_id, promos(*)')
    .in('produit_id', manquants.map(p => p.id))

  const promosParProduit = new Map<string, any[]>()
  for (const lien of promoLiens ?? []) {
    const liste = promosParProduit.get(lien.produit_id) ?? []
    liste.push(lien.promos)
    promosParProduit.set(lien.produit_id, liste)
  }

  return manquants.map(produit => {
    const priorite = prioriteParProduit.get(produit.id)
    const statut = statutParProduit.get(produit.id)!
    if (!priorite) return { produitId: produit.id, produitNom: produit.nom, statut, arguments: [], score: 0 }

    const statutsPourCeProduit = new Map<string, StatutProduit>(
      (tousLesStatuts ?? []).filter(s => s.produit_id === produit.id).map(s => [s.magasin_id, s.statut as StatutProduit])
    )

    const { arguments: args, score } = genererArguments(
      magasin, produit, priorite.rang as 20 | 50 | 70,
      tousLesMagasins ?? [], statutsPourCeProduit,
      promosParProduit.get(produit.id) ?? [], critere
    )

    return { produitId: produit.id, produitNom: produit.nom, statut, arguments: args, score }
  })
}
```

- [ ] **Step 2: Afficher les arguments sur la fiche magasin**

Modifier `app/magasins/[id]/page.tsx` : ajouter l'import et charger les arguments, puis les afficher sous chaque ligne concernée.

```typescript
import { chargerArgumentsFicheMagasin } from '@/lib/engine/fiche-magasin'
```

Dans le composant, après le chargement de `statuts` :
```typescript
const lignesAvecArguments = await chargerArgumentsFicheMagasin(magasin.id)
const argumentsParProduit = new Map(lignesAvecArguments.map(l => [l.produitId, l]))
```

Modifier la ligne du tableau produit pour ajouter une ligne d'arguments :
```tsx
<tr key={p.id}>
  <td>{p.nom}</td>
  <td><StatutSelect magasinId={magasin.id} produitId={p.id} statutActuel={statutParProduit.get(p.id) ?? 'present'} /></td>
</tr>
{argumentsParProduit.get(p.id)?.arguments.map((arg, i) => (
  <tr key={`${p.id}-arg-${i}`}>
    <td colSpan={2} className="text-sm text-amber-700 pl-4">{arg.message}</td>
  </tr>
))}
```

- [ ] **Step 3: Vérification manuelle**

Créer un deuxième magasin de même enseigne/taille dans un secteur différent (via l'import admin), marquer un produit "present" dessus, et "manquant" sur le premier magasin. Recharger la fiche du premier magasin : le message "Présent dans 1 magasin(s) similaire(s)..." doit apparaître. Importer une promo sur ce même produit dans la même enseigne, avec une date proche : le message promo doit aussi apparaître.

- [ ] **Step 4: Commit**

```bash
git add lib/engine/fiche-magasin.ts app/magasins/[id]/page.tsx
git commit -m "feat: sales arguments on store detail page"
```

---

### Task 13: Visites — planification et confirmation

**Files:**
- Create: `lib/visites/actions.ts`

**Interfaces:**
- Consumes: `getCurrentProfile`, `createServerClient` (Task 3)
- Produces: `planifierVisite(magasinId, semaine, jour)`, `marquerRealisee(visiteId)`, `retirerVisite(visiteId)`

- [ ] **Step 1: Implémenter les Server Actions**

```typescript
// lib/visites/actions.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'

export async function planifierVisite(magasinId: string, semaine: string, jour: string) {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) throw new Error('Non authentifié')

  const { error } = await supabase.from('visites').insert({
    magasin_id: magasinId, commercial_id: profile.id, semaine, jour, statut: 'planifie',
  })
  if (error) throw error
  revalidatePath('/semaine')
}

export async function marquerRealisee(visiteId: string) {
  const supabase = createServerClient()
  const { error } = await supabase.from('visites').update({ statut: 'realise' }).eq('id', visiteId)
  if (error) throw error
  revalidatePath('/semaine')
}

export async function retirerVisite(visiteId: string) {
  const supabase = createServerClient()
  const { error } = await supabase.from('visites').delete().eq('id', visiteId)
  if (error) throw error
  revalidatePath('/semaine')
}
```

- [ ] **Step 2: Vérification manuelle**

Ces actions seront exercées visuellement au Task 14 (aucune UI ne les appelle encore). Vérifier seulement que le fichier compile.

Run: `npm run build`
Expected: build réussi

- [ ] **Step 3: Commit**

```bash
git add lib/visites/actions.ts
git commit -m "feat: visit planning server actions"
```

---

### Task 14: "Ma semaine" — planning et suggestions

**Files:**
- Create: `lib/semaine.ts`
- Test: `lib/semaine.test.ts`
- Create: `app/semaine/page.tsx`
- Create: `app/semaine/calendrier-semaine.tsx`

**Interfaces:**
- Consumes: `calculerPrioritesMagasins` (Task 11), `planifierVisite`/`marquerRealisee`/`retirerVisite` (Task 13), `getCurrentProfile` (Task 3)
- Produces: `numeroSemaineCourante(date?)` → `string` (format `AAAA-Www`)

- [ ] **Step 1: Écrire le test du calcul de semaine ISO**

```typescript
// lib/semaine.test.ts
import { describe, expect, it } from 'vitest'
import { numeroSemaineCourante } from './semaine'

describe('numeroSemaineCourante', () => {
  it('calcule la semaine ISO correcte', () => {
    expect(numeroSemaineCourante(new Date('2026-08-16'))).toBe('2026-W34')
  })

  it('gère le passage d\'année', () => {
    expect(numeroSemaineCourante(new Date('2026-01-01'))).toBe('2026-W01')
  })
})
```

- [ ] **Step 2: Lancer le test, vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL, `semaine.ts` n'existe pas

- [ ] **Step 3: Implémenter**

```typescript
// lib/semaine.ts
export function numeroSemaineCourante(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const jourNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - jourNum + 3)
  const premierJeudi = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const semaine = 1 + Math.round(
    ((d.getTime() - premierJeudi.getTime()) / 86_400_000 - 3 + ((premierJeudi.getUTCDay() + 6) % 7)) / 7
  )
  return `${d.getUTCFullYear()}-W${String(semaine).padStart(2, '0')}`
}

export function dateDuJour(semaine: string, jourIndex: number): string {
  const [annee, num] = semaine.split('-W').map(Number)
  const janvier4 = new Date(Date.UTC(annee, 0, 4))
  const jourSemaineJanvier4 = (janvier4.getUTCDay() + 6) % 7
  const lundiSemaine1 = new Date(janvier4)
  lundiSemaine1.setUTCDate(janvier4.getUTCDate() - jourSemaineJanvier4)
  const lundiCible = new Date(lundiSemaine1)
  lundiCible.setUTCDate(lundiSemaine1.getUTCDate() + (num - 1) * 7 + jourIndex)
  return lundiCible.toISOString().slice(0, 10)
}
```

- [ ] **Step 4: Lancer le test, vérifier qu'il passe**

Run: `npm test`
Expected: PASS

- [ ] **Step 5: Créer le calendrier client**

```tsx
// app/semaine/calendrier-semaine.tsx
'use client'
import { useTransition } from 'react'
import { planifierVisite, marquerRealisee, retirerVisite } from '@/lib/visites/actions'
import { dateDuJour } from '@/lib/semaine'
import type { Magasin, Visite } from '@/lib/types'

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']

export function CalendrierSemaine({ semaine, magasins, visites }: { semaine: string; magasins: Magasin[]; visites: Visite[] }) {
  const [pending, startTransition] = useTransition()
  const magasinParId = new Map(magasins.map(m => [m.id, m]))

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Ma semaine ({semaine})</h1>
      <div className="grid grid-cols-5 gap-2">
        {JOURS.map((jour, i) => (
          <div key={jour} className="border rounded p-2">
            <h2 className="font-semibold text-sm mb-2">{jour}</h2>
            {visites.filter(v => v.jour === dateDuJour(semaine, i)).map(v => (
              <div key={v.id} className="text-xs border-b py-1">
                <p>{magasinParId.get(v.magasin_id)?.nom}</p>
                <p className="text-gray-500">{v.statut}</p>
                {v.statut === 'planifie' && (
                  <button disabled={pending} onClick={() => startTransition(() => marquerRealisee(v.id))} className="underline mr-2">
                    Réalisée
                  </button>
                )}
                <button disabled={pending} onClick={() => startTransition(() => retirerVisite(v.id))} className="underline">
                  Retirer
                </button>
              </div>
            ))}
            <select
              onChange={e => e.target.value && startTransition(() => planifierVisite(e.target.value, semaine, dateDuJour(semaine, i)))}
              defaultValue=""
              className="text-xs border rounded mt-2 w-full"
            >
              <option value="">+ ajouter magasin</option>
              {magasins.map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Créer la page "Ma semaine"**

```tsx
// app/semaine/page.tsx
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { calculerPrioritesMagasins } from '@/lib/engine/priorites'
import { numeroSemaineCourante } from '@/lib/semaine'
import { CalendrierSemaine } from './calendrier-semaine'

export default async function SemainePage() {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) return null

  const semaine = numeroSemaineCourante()

  const [{ data: magasins }, { data: produits }, { data: priorites }, { data: promoLiens }, { data: visites }] = await Promise.all([
    supabase.from('magasins').select('*'),
    supabase.from('produits').select('*'),
    supabase.from('priorites_produits').select('*'),
    supabase.from('promo_produits').select('produit_id, promos(*)'),
    supabase.from('visites').select('*').eq('semaine', semaine).eq('commercial_id', profile.id),
  ])

  const magasinIds = (magasins ?? []).map(m => m.id)
  const { data: statuts } = await supabase
    .from('statuts_produit_magasin')
    .select('*')
    .in('magasin_id', magasinIds.length ? magasinIds : ['00000000-0000-0000-0000-000000000000'])

  const produitsParId = new Map((produits ?? []).map(p => [p.id, p]))
  const prioritesParProduitId = new Map((priorites ?? []).map(p => [p.produit_id, p]))
  const promosParProduitId = new Map<string, any[]>()
  for (const lien of promoLiens ?? []) {
    const liste = promosParProduitId.get(lien.produit_id) ?? []
    liste.push(lien.promos)
    promosParProduitId.set(lien.produit_id, liste)
  }

  const prioritesMagasins = calculerPrioritesMagasins(
    magasins ?? [], statuts ?? [], produitsParId, prioritesParProduitId, promosParProduitId
  )

  const magasinIdsPlanifies = new Set((visites ?? []).map(v => v.magasin_id))
  const nonCouvertes = prioritesMagasins.filter(p => !magasinIdsPlanifies.has(p.magasin.id)).slice(0, 10)

  return (
    <div className="p-6 grid grid-cols-2 gap-6">
      <div>
        <h1 className="text-xl font-bold mb-4">Priorités suggérées</h1>
        {nonCouvertes.length > 0 && (
          <div className="bg-amber-100 border border-amber-400 rounded p-3 mb-4 text-sm">
            {nonCouvertes.length} magasin(s) prioritaire(s) ne sont pas dans votre semaine.
          </div>
        )}
        <ul className="space-y-2">
          {prioritesMagasins.slice(0, 15).map(p => (
            <li key={p.magasin.id} className="border rounded p-2">
              <p className="font-medium">{p.magasin.nom} — score {p.score}</p>
              <p className="text-sm text-gray-600">{p.raisons.join(', ')}</p>
            </li>
          ))}
        </ul>
      </div>
      <CalendrierSemaine semaine={semaine} magasins={magasins ?? []} visites={visites ?? []} />
    </div>
  )
}
```

- [ ] **Step 7: Vérification manuelle**

Se connecter en commercial, aller sur `/semaine`. Vérifier que les magasins avec produits manquants apparaissent dans "Priorités suggérées", triés par score. Ajouter un des magasins suggérés à un jour via le sélecteur : la bannière d'alerte diminue d'une unité. Marquer une visite "Réalisée", vérifier que le statut change et persiste au rafraîchissement.

- [ ] **Step 8: Commit**

```bash
git add lib/semaine.ts lib/semaine.test.ts app/semaine/
git commit -m "feat: weekly visit planning with priority suggestions and coverage alert"
```

---

### Task 15: Vue manager — priorités de l'équipe

**Files:**
- Create: `app/equipe/page.tsx`

**Interfaces:**
- Consumes: `calculerPrioritesMagasins` (Task 11), `getCurrentProfile`/`createServerClient` (Task 3)

- [ ] **Step 1: Créer la vue équipe**

```tsx
// app/equipe/page.tsx
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { calculerPrioritesMagasins } from '@/lib/engine/priorites'

export default async function EquipePage() {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) return null

  const [{ data: magasins }, { data: produits }, { data: priorites }, { data: promoLiens }, { data: commerciaux }] = await Promise.all([
    supabase.from('magasins').select('*'),
    supabase.from('produits').select('*'),
    supabase.from('priorites_produits').select('*'),
    supabase.from('promo_produits').select('produit_id, promos(*)'),
    supabase.from('profiles').select('*').eq('manager_id', profile.id),
  ])

  const magasinIds = (magasins ?? []).map(m => m.id)
  const { data: statuts } = await supabase
    .from('statuts_produit_magasin')
    .select('*')
    .in('magasin_id', magasinIds.length ? magasinIds : ['00000000-0000-0000-0000-000000000000'])

  const produitsParId = new Map((produits ?? []).map(p => [p.id, p]))
  const prioritesParProduitId = new Map((priorites ?? []).map(p => [p.produit_id, p]))
  const promosParProduitId = new Map<string, any[]>()
  for (const lien of promoLiens ?? []) {
    const liste = promosParProduitId.get(lien.produit_id) ?? []
    liste.push(lien.promos)
    promosParProduitId.set(lien.produit_id, liste)
  }

  const priorites_ = calculerPrioritesMagasins(magasins ?? [], statuts ?? [], produitsParId, prioritesParProduitId, promosParProduitId)
  const emailParSecteur = new Map((commerciaux ?? []).map(c => [c.secteur_id, c.email]))

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Mon équipe — priorités</h1>
      <table className="w-full text-sm">
        <thead><tr><th className="text-left">Magasin</th><th className="text-left">Commercial</th><th className="text-left">Score</th><th className="text-left">Raisons</th></tr></thead>
        <tbody>
          {priorites_.map(p => (
            <tr key={p.magasin.id}>
              <td>{p.magasin.nom}</td>
              <td>{emailParSecteur.get(p.magasin.secteur_id) ?? '-'}</td>
              <td>{p.score}</td>
              <td>{p.raisons.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Vérification manuelle**

Créer un utilisateur manager (Task 6), rattacher le commercial existant à ce manager (modifier `manager_id` du profil commercial dans Supabase Table Editor si le formulaire du Task 6 ne le permet pas encore rétroactivement). Se connecter en manager, aller sur `/equipe` : le magasin avec produit manquant du commercial doit apparaître. Vérifier qu'un magasin d'un secteur sans commercial rattaché à ce manager n'apparaît pas (RLS via `visible_secteurs()`).

- [ ] **Step 3: Commit**

```bash
git add app/equipe/
git commit -m "feat: manager team priority view"
```

---

### Task 16: Navigation et garde de rôle

**Files:**
- Modify: `app/layout.tsx`
- Create: `app/sign-out-button.tsx`

**Interfaces:**
- Consumes: `getCurrentProfile`/`createServerClient` (Task 3), `createClient` (Task 3)

- [ ] **Step 1: Créer le bouton de déconnexion**

```tsx
// app/sign-out-button.tsx
'use client'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export function SignOutButton() {
  const router = useRouter()
  return (
    <button
      onClick={async () => {
        await createClient().auth.signOut()
        router.push('/login')
        router.refresh()
      }}
      className="text-sm underline"
    >
      Déconnexion
    </button>
  )
}
```

- [ ] **Step 2: Ajouter la navigation conditionnelle au layout racine**

Remplacer le contenu de `app/layout.tsx` (conserver les imports de police/`globals.css` générés par create-next-app) :

```tsx
// app/layout.tsx
import './globals.css'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { SignOutButton } from './sign-out-button'

export const metadata = { title: 'Prépa visite' }

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)

  return (
    <html lang="fr">
      <body>
        {profile && (
          <nav className="flex gap-4 border-b p-4 items-center">
            {profile.role === 'commercial' && (
              <>
                <a href="/semaine">Ma semaine</a>
                <a href="/magasins">Mes magasins</a>
              </>
            )}
            {profile.role === 'manager' && <a href="/equipe">Mon équipe</a>}
            {profile.role === 'admin' && (
              <>
                <a href="/admin/import">Import</a>
                <a href="/admin/utilisateurs">Utilisateurs</a>
              </>
            )}
            <span className="ml-auto text-sm text-gray-500">{profile.email}</span>
            <SignOutButton />
          </nav>
        )}
        <main>{children}</main>
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Vérification manuelle complète (parcours de bout en bout)**

Run: `npm run build` puis `npm run dev`

1. Se connecter en admin → nav affiche "Import" / "Utilisateurs" → importer magasins/produits/promos → créer un commercial et un manager, rattacher le commercial au manager.
2. Se connecter en commercial → nav affiche "Ma semaine" / "Mes magasins" → marquer un produit manquant sur un magasin → vérifier l'argumentaire → planifier ce magasin dans la semaine → vérifier que l'alerte de couverture disparaît.
3. Se connecter en manager → nav affiche "Mon équipe" → vérifier que le magasin du commercial apparaît avec le bon score.
4. Cliquer "Déconnexion" depuis n'importe quel rôle → redirigé vers `/login`.

- [ ] **Step 4: Commit**

```bash
git add app/layout.tsx app/sign-out-button.tsx
git commit -m "feat: role-aware navigation shell"
```

---

## Après ce plan (déploiement)

Une fois les 16 tâches validées : connecter le dépôt à Vercel, renseigner les 3 variables d'environnement Supabase dans les réglages du projet Vercel, déployer. Configurer le template d'email "Magic Link" dans Supabase Auth (URL de redirection = domaine Vercel + `/auth/callback`) avant la mise à disposition aux commerciaux.
