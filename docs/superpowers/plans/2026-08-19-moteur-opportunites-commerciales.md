# Moteur d'opportunités commerciales — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer le modèle de données des opportunités commerciales et le pipeline pur qui les détecte, les classe (P1/P2/P3), les score, leur attribue un niveau de confiance, et les persiste de façon transactionnelle et idempotente — puis intégrer ce moteur en shadow mode (calcule et enregistre, sans remplacer les écrans actuels).

**Architecture:** Quatre nouvelles tables Postgres (`opportunites`, `opportunite_evenements`, `opportunite_promos_preuves`, `statuts_produit_magasin_historique`) plus une fonction Postgres transactionnelle (`rattacher_opportunite`) pour toute écriture. Le pipeline lui-même est une suite de fonctions TypeScript pures (exclusion → détection → classification → score → confiance → fingerprint) orchestrées par une seule fonction (`rattacherOpportunite`) qui appelle la fonction Postgres via RPC. Le moteur est câblé aux Server Actions existantes qui modifient statuts/promos/assortiment, plus un point d'entrée HTTP pour le recalcul planifié.

**Tech Stack:** Next.js 16 (Server Actions + Route Handlers), Supabase Postgres (RLS, fonctions `plpgsql`, RPC), TypeScript, Zod (nouvelle dépendance), Vitest.

**Spec:** [docs/superpowers/specs/2026-08-19-moteur-opportunites-commerciales-design.md](../specs/2026-08-19-moteur-opportunites-commerciales-design.md)

## Global Constraints

- Le niveau P1/P2/P3 se fixe **avant** le score et n'est **jamais** recalculé à partir de lui — une pénalité de score ne change jamais de niveau (spec §4, §7).
- Toute écriture sur les 4 nouvelles tables passe par `rattacher_opportunite` (RPC) — aucun autre code n'écrit directement dedans (spec §4.7, §12.4).
- Résolution canonique obligatoire : ce plan ne travaille jamais avec un `produit.id` qui pourrait être une variante promo — toujours `produit_canonique_id` résolu via `resoudreCanonique` (déjà livré, `lib/engine/priorites.ts`).
- Aucun nouvel écran commercial dans ce sous-projet — shadow mode uniquement (spec §9, §12.6). Les pages `/magasins/[id]`, `/semaine`, `/equipe` ne sont pas modifiées.
- `raisons_actuelles` et tout JSON de raisons valident `RaisonsActuellesSchema` (Zod) avant écriture — jamais de JSON libre non validé (spec §7).
- Une donnée contradictoire ne transforme jamais une opportunité existante en `verifier_information` — une opportunité séparée est créée, l'originale voit sa confiance abaissée (spec §4.6).
- Migrations appliquées via l'outil MCP Supabase `apply_migration`, jamais de SQL exécuté à la main hors migration versionnée — même convention que les 10 migrations précédentes de ce projet.

---

### Task 1: Schéma — 4 tables, contraintes, triggers, index, RLS

**Files:**
- Create: `supabase/migrations/0011_opportunites_schema.sql`

**Interfaces:**
- Produces: tables `opportunites`, `opportunite_evenements`, `opportunite_promos_preuves`, `statuts_produit_magasin_historique` — schéma exact ci-dessous, consommé par toutes les tâches suivantes.

- [ ] **Step 1: Écrire la migration complète**

```sql
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
```

- [ ] **Step 2: Appliquer la migration**

Utiliser l'outil MCP Supabase `apply_migration` (project_id `yymriulkcytkbuenorvm`, name `opportunites_schema`) avec le SQL ci-dessus.

- [ ] **Step 3: Vérifier en base**

```sql
select table_name from information_schema.tables
where table_name in ('opportunites','opportunite_evenements','opportunite_promos_preuves','statuts_produit_magasin_historique');
-- expect 4 rows
select conname from pg_constraint where conname = 'promo_id_coherent_avec_type'; -- expect 1 row
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0011_opportunites_schema.sql
git commit -m "feat: schéma des opportunités commerciales (4 tables, contraintes, RLS)"
```

---

### Task 2: Types TypeScript + schéma Zod des raisons

**Files:**
- Modify: `lib/types.ts`
- Create: `lib/engine/raison.ts`
- Test: `lib/engine/raison.test.ts`
- Modify: `package.json` (ajout de `zod`)

**Interfaces:**
- Consumes: table `opportunites` (Task 1).
- Produces: `TypeMission`, `StatutOpportunite`, `NiveauPrioriteOpportunite`, `Confiance`, `Opportunite`, `TypeEvenementOpportunite`, `OpportuniteEvenement`, `OpportunitePromoPreuve`, `StatutProduitMagasinHistorique` (dans `lib/types.ts`) ; `RaisonSchema`, `RaisonsActuellesSchema`, `Raison`, `RaisonsActuelles` (dans `lib/engine/raison.ts`) — utilisés par toutes les tâches suivantes.

- [ ] **Step 1: Ajouter la dépendance Zod**

```bash
npm install zod
```

- [ ] **Step 2: Écrire le test du schéma Zod**

```ts
// lib/engine/raison.test.ts
import { describe, expect, it } from 'vitest'
import { RaisonsActuellesSchema } from './raison'

describe('RaisonsActuellesSchema', () => {
  it('valide une structure conforme', () => {
    const valide = {
      version: 1,
      raisons: [{
        version: 1,
        codeSignal: 'promo_a_constater',
        source: { type: 'promo', id: 'p1' },
        observedAt: '2026-08-19T00:00:00.000Z',
        fraicheur: 'fraiche',
        contributionScore: 40,
        niveauDeclenche: 'P1',
        texteCommercial: 'Promo à constater.',
      }],
    }
    expect(() => RaisonsActuellesSchema.parse(valide)).not.toThrow()
  })

  it('rejette une fraicheur hors énumération', () => {
    const invalide = {
      version: 1,
      raisons: [{
        version: 1, codeSignal: 'x', source: { type: 'promo', id: 'p1' },
        observedAt: '2026-08-19T00:00:00.000Z', fraicheur: 'douteuse',
        contributionScore: 10, niveauDeclenche: null, texteCommercial: 'x',
      }],
    }
    expect(() => RaisonsActuellesSchema.parse(invalide)).toThrow()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/engine/raison.test.ts`
Expected: FAIL — `Cannot find module './raison'`

- [ ] **Step 4: Créer `lib/engine/raison.ts`**

```ts
// lib/engine/raison.ts
import { z } from 'zod'

export const RaisonSchema = z.object({
  version: z.literal(1),
  codeSignal: z.string(),
  source: z.object({ type: z.string(), id: z.string() }),
  observedAt: z.string(),
  fraicheur: z.enum(['fraiche', 'a_verifier', 'perimee']),
  contributionScore: z.number(),
  niveauDeclenche: z.enum(['P1', 'P2', 'P3']).nullable(),
  texteCommercial: z.string(),
})

export const RaisonsActuellesSchema = z.object({
  version: z.literal(1),
  raisons: z.array(RaisonSchema),
})

export type Raison = z.infer<typeof RaisonSchema>
export type RaisonsActuelles = z.infer<typeof RaisonsActuellesSchema>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/engine/raison.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Ajouter les types dans `lib/types.ts`**

Ajouter à la fin du fichier `lib/types.ts` :

```ts
import type { RaisonsActuelles } from './engine/raison'

export type TypeMission =
  | 'anticiper_promo' | 'revendre_promo' | 'constater_promo'
  | 'referencer_produit' | 'corriger_rupture' | 'securiser_commande'
  | 'suivre_engagement' | 'optimiser_implantation' | 'proposer_test_ht' | 'verifier_information'

export const TYPES_MISSION_PROMO: readonly TypeMission[] = ['anticiper_promo', 'revendre_promo', 'constater_promo']

export type StatutOpportunite =
  | 'detectee' | 'a_preparer' | 'presentee' | 'accord_obtenu' | 'en_attente'
  | 'refusee' | 'commandee' | 'mise_en_place' | 'a_constater' | 'reussie' | 'abandonnee'

export type NiveauPrioriteOpportunite = 'P1' | 'P2' | 'P3'
export type Confiance = 'donnees_confirmees' | 'recommandation_probable' | 'information_a_verifier'

export interface Opportunite {
  id: string
  magasin_id: string
  produit_canonique_id: string
  type_mission: TypeMission
  promo_id: string | null
  statut: StatutOpportunite
  niveau_priorite: NiveauPrioriteOpportunite | null
  score: number | null
  confiance: Confiance | null
  raisons_actuelles: RaisonsActuelles | null
  score_calcule_at: string | null
  fingerprint: string | null
  version_moteur: string | null
  cycle: number
  derniere_reouverture_at: string | null
  cree_at: string
  cloture_at: string | null
  prochaine_action_at: string | null
}

export type TypeEvenementOpportunite =
  | 'creation' | 'recalcul_score' | 'changement_statut' | 'preuve_ajoutee'
  | 'preuve_retiree' | 'reouverture' | 'presentee' | 'decision' | 'commentaire' | 'cloture'

export interface OpportuniteEvenement {
  id: string
  opportunite_id: string
  type: TypeEvenementOpportunite
  visite_id: string | null
  score_a_ce_moment: number | null
  raisons: RaisonsActuelles | null
  statut_avant: string | null
  statut_apres: string | null
  raison_refus: string | null
  commentaire: string | null
  cree_par: string | null
  cree_at: string
}

export interface OpportunitePromoPreuve {
  opportunite_id: string
  promo_id: string
  ajoute_at: string
}

export interface StatutProduitMagasinHistorique {
  id: string
  magasin_id: string
  produit_id: string
  statut: StatutProduit
  raison_absence: RaisonAbsence | null
  visite_id: string | null
  signale_par: string | null
  signale_at: string
}
```

- [ ] **Step 7: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 8: Commit**

```bash
git add lib/types.ts lib/engine/raison.ts lib/engine/raison.test.ts package.json package-lock.json
git commit -m "feat: types opportunités + schéma Zod des raisons"
```

---

### Task 3: Configuration du moteur — poids, seuils, indicateur d'activation

**Files:**
- Create: `lib/engine/config-moteur.ts`
- Test: `lib/engine/config-moteur.test.ts`

**Interfaces:**
- Produces: `ConfigMoteur` interface, `CONFIG_MOTEUR_DEFAUT`, `moteurActif(): boolean` — consommés par les tâches de détection (6), score (10), historique des ruptures (5), et le câblage des déclencheurs (15, 16).

- [ ] **Step 1: Écrire le test**

```ts
// lib/engine/config-moteur.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest'
import { CONFIG_MOTEUR_DEFAUT, moteurActif } from './config-moteur'

describe('config-moteur', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('expose les poids et seuils par défaut validés dans la spec', () => {
    expect(CONFIG_MOTEUR_DEFAUT.seuilRecurrenceRuptures).toBe(2)
    expect(CONFIG_MOTEUR_DEFAUT.fenetreRecurrenceJours).toBe(60)
    expect(CONFIG_MOTEUR_DEFAUT.cooldownRefusJours).toBe(30)
    expect(CONFIG_MOTEUR_DEFAUT.penaliteReouvertureApresRefus).toBe(-25)
    expect(CONFIG_MOTEUR_DEFAUT.score.urgenceMax).toBe(40)
    expect(CONFIG_MOTEUR_DEFAUT.score.impactMax).toBe(25)
    expect(CONFIG_MOTEUR_DEFAUT.score.pertinenceMax).toBe(20)
    expect(CONFIG_MOTEUR_DEFAUT.score.faisabiliteMax).toBe(15)
  })

  it('moteurActif() lit MOTEUR_OPPORTUNITES_ACTIF, activé par défaut', () => {
    vi.stubEnv('MOTEUR_OPPORTUNITES_ACTIF', undefined as unknown as string)
    expect(moteurActif()).toBe(true)
  })

  it('moteurActif() retourne false quand explicitement désactivé', () => {
    vi.stubEnv('MOTEUR_OPPORTUNITES_ACTIF', 'false')
    expect(moteurActif()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/config-moteur.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```ts
// lib/engine/config-moteur.ts
export interface ConfigMoteurScore {
  urgenceMax: number
  impactMax: number
  pertinenceMax: number
  faisabiliteMax: number
}

export interface ConfigMoteur {
  version: string
  seuilRecurrenceRuptures: number
  fenetreRecurrenceJours: number
  cooldownRefusJours: number
  penaliteReouvertureApresRefus: number
  score: ConfigMoteurScore
}

// Valeurs par défaut validées dans la spec (§4.2, §5, §6) — isolées ici pour
// rester testables et modifiables sans toucher à la logique du pipeline.
// Édition admin hors scope de ce sous-projet (spec §9).
export const CONFIG_MOTEUR_DEFAUT: ConfigMoteur = {
  version: '1',
  seuilRecurrenceRuptures: 2,
  fenetreRecurrenceJours: 60,
  cooldownRefusJours: 30,
  penaliteReouvertureApresRefus: -25,
  score: { urgenceMax: 40, impactMax: 25, pertinenceMax: 20, faisabiliteMax: 15 },
}

// Shadow mode (spec §12.7) : indicateur d'activation lu depuis l'environnement,
// jamais depuis une suppression de données — désactiver n'efface rien.
export function moteurActif(): boolean {
  return process.env.MOTEUR_OPPORTUNITES_ACTIF !== 'false'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/config-moteur.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/engine/config-moteur.ts lib/engine/config-moteur.test.ts
git commit -m "feat: configuration du moteur d'opportunités (poids, seuils, indicateur d'activation)"
```

---

### Task 4: Migration de données — backfill de l'historique des relevés

**Files:**
- Create: `supabase/migrations/0012_backfill_statuts_historique.sql`

**Interfaces:**
- Consumes: `statuts_produit_magasin` (existant), `statuts_produit_magasin_historique` (Task 1).

- [ ] **Step 1: Écrire la migration de backfill**

```sql
-- supabase/migrations/0012_backfill_statuts_historique.sql
-- Exactement une ligne par ligne existante de statuts_produit_magasin — jamais
-- plusieurs lignes synthétiques (spec §12.3) : un seul relevé initial ne peut
-- par construction jamais déclencher le seuil de récurrence (≥2).
insert into statuts_produit_magasin_historique (magasin_id, produit_id, statut, raison_absence, visite_id, signale_par, signale_at)
select magasin_id, produit_id, statut, raison_absence, null, signale_par, signale_at
from statuts_produit_magasin;
```

- [ ] **Step 2: Appliquer la migration**

Utiliser `apply_migration` (project_id `yymriulkcytkbuenorvm`, name `backfill_statuts_historique`).

- [ ] **Step 3: Vérifier en base**

```sql
select
  (select count(*) from statuts_produit_magasin) as source,
  (select count(*) from statuts_produit_magasin_historique) as historique;
-- expect source = historique (le backfill est la seule écriture jusque là)
select count(*) from statuts_produit_magasin_historique where visite_id is not null;
-- expect 0
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0012_backfill_statuts_historique.sql
git commit -m "feat: backfill de l'historique des relevés depuis statuts_produit_magasin"
```

---

### Task 5: `updateStatutProduit` écrit l'historique, idempotent par visite

**Files:**
- Modify: `lib/statuts/actions.ts`
- Test: `lib/statuts/actions.test.ts` (créer)

**Interfaces:**
- Consumes: `statuts_produit_magasin_historique` (Task 1), `Produit` (résolution canonique existante).
- Produces: `updateStatutProduit(magasinId, produitId, statut, visiteId?: string | null)` — nouvelle signature, `visiteId` optionnel pour compatibilité avec les appels existants.

Aucun test unitaire n'existe aujourd'hui pour `lib/statuts/actions.ts` (fonctions Server Action à effet de bord Supabase, pas de mock établi dans ce projet pour ce fichier). Ce plan introduit un premier test avec un client Supabase in-memory minimal, pattern à réutiliser pour les tâches suivantes qui touchent des Server Actions.

- [ ] **Step 1: Lire le fichier actuel**

`lib/statuts/actions.ts` contient déjà `updateStatutProduit` (upsert sur `statuts_produit_magasin`, résolution canonique) et `definirRaisonAbsence`. Ne pas toucher `definirRaisonAbsence`.

- [ ] **Step 2: Modifier `updateStatutProduit`**

```ts
export async function updateStatutProduit(
  magasinId: string,
  produitId: string,
  statut: StatutProduit,
  visiteId: string | null = null
) {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) throw new Error('Non authentifié')

  const { data: produit } = await supabase.from('produits').select('produit_canonique_id').eq('id', produitId).single()
  const idEffectif = produit?.produit_canonique_id ?? produitId

  const { error } = await supabase.from('statuts_produit_magasin').upsert(
    { magasin_id: magasinId, produit_id: idEffectif, statut, signale_par: profile.id, signale_at: new Date().toISOString() },
    { onConflict: 'magasin_id,produit_id' }
  )
  if (error) throw error

  // Historique append-only, idempotent par visite (spec §3.4, §8) — plusieurs
  // clics pendant la même visite mettent à jour la même ligne au lieu d'en
  // empiler plusieurs.
  if (visiteId) {
    const { error: histError } = await supabase.from('statuts_produit_magasin_historique').upsert(
      { magasin_id: magasinId, produit_id: idEffectif, statut, visite_id: visiteId, signale_par: profile.id, signale_at: new Date().toISOString() },
      { onConflict: 'magasin_id,produit_id,visite_id' }
    )
    if (histError) throw histError
  } else {
    const { error: histError } = await supabase.from('statuts_produit_magasin_historique').insert(
      { magasin_id: magasinId, produit_id: idEffectif, statut, signale_par: profile.id, signale_at: new Date().toISOString() }
    )
    if (histError) throw histError
  }

  revalidatePath(`/magasins/${magasinId}`)
}
```

Note de périmètre : `visiteId` reste optionnel et non câblé depuis l'UI dans ce sous-projet (aucun écran ne connaît la « visite en cours » aujourd'hui, spec §9). Les appels existants (composant `StatutSelect`) continuent de fonctionner sans le passer — leurs relevés vont dans l'historique sans idempotence de visite, ce qui reste correct (une ligne par appel). Le câblage UI de la visite active est un travail de sous-projet ultérieur.

- [ ] **Step 3: Écrire un test avec idempotence par visite**

```ts
// lib/statuts/actions.test.ts
import { describe, expect, it, vi } from 'vitest'

const upsertCalls: unknown[] = []
const insertCalls: unknown[] = []

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { produit_canonique_id: null } }) }) }),
      upsert: (payload: unknown, opts: unknown) => {
        upsertCalls.push({ table, payload, opts })
        return Promise.resolve({ error: null })
      },
      insert: (payload: unknown) => {
        insertCalls.push({ table, payload })
        return Promise.resolve({ error: null })
      },
    }),
  }),
  getCurrentProfile: async () => ({ id: 'commercial-1' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { updateStatutProduit } from './actions'

describe('updateStatutProduit — historique', () => {
  it('upsert sur (magasin,produit,visite) quand une visite est fournie', async () => {
    upsertCalls.length = 0
    await updateStatutProduit('m1', 'p1', 'rupture', 'v1')
    const historiqueCall = upsertCalls.find(c => (c as { table: string }).table === 'statuts_produit_magasin_historique')
    expect(historiqueCall).toBeDefined()
    expect((historiqueCall as { opts: { onConflict: string } }).opts.onConflict).toBe('magasin_id,produit_id,visite_id')
  })

  it('insert simple quand aucune visite n\'est fournie', async () => {
    insertCalls.length = 0
    await updateStatutProduit('m1', 'p1', 'rupture')
    const historiqueCall = insertCalls.find(c => (c as { table: string }).table === 'statuts_produit_magasin_historique')
    expect(historiqueCall).toBeDefined()
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run lib/statuts/actions.test.ts`
Expected: FAIL — `updateStatutProduit` ne touche pas encore l'historique.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/statuts/actions.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/statuts/actions.ts lib/statuts/actions.test.ts
git commit -m "feat: updateStatutProduit écrit l'historique des relevés, idempotent par visite"
```

---

### Task 6: Comptage des ruptures récurrentes

**Files:**
- Create: `lib/engine/historique-ruptures.ts`
- Test: `lib/engine/historique-ruptures.test.ts`

**Interfaces:**
- Consumes: `StatutProduitMagasinHistorique[]` (Task 2), `ConfigMoteur` (Task 3).
- Produces: `compterRupturesRecurrentes(historique, aujourdHui, config): { nombre: number; recurrente: boolean }` — consommé par le détecteur de rupture récurrente (Task 7).

- [ ] **Step 1: Écrire le test**

```ts
// lib/engine/historique-ruptures.test.ts
import { describe, expect, it } from 'vitest'
import { compterRupturesRecurrentes } from './historique-ruptures'
import { CONFIG_MOTEUR_DEFAUT } from './config-moteur'
import type { StatutProduitMagasinHistorique } from '@/lib/types'

function releve(statut: 'present' | 'manquant' | 'rupture', joursAvant: number, visiteId: string | null): StatutProduitMagasinHistorique {
  const date = new Date('2026-08-19T00:00:00.000Z')
  date.setDate(date.getDate() - joursAvant)
  return { id: `r-${joursAvant}-${visiteId}`, magasin_id: 'm1', produit_id: 'p1', statut, raison_absence: null, visite_id: visiteId, signale_par: null, signale_at: date.toISOString() }
}

describe('compterRupturesRecurrentes', () => {
  it('deux ruptures sur deux visites distinctes en 60 jours = récurrente', () => {
    const historique = [releve('rupture', 10, 'v1'), releve('rupture', 40, 'v2')]
    const resultat = compterRupturesRecurrentes(historique, new Date('2026-08-19'), CONFIG_MOTEUR_DEFAUT)
    expect(resultat.nombre).toBe(2)
    expect(resultat.recurrente).toBe(true)
  })

  it('une seule rupture ne déclenche jamais la récurrence', () => {
    const historique = [releve('rupture', 10, 'v1')]
    const resultat = compterRupturesRecurrentes(historique, new Date('2026-08-19'), CONFIG_MOTEUR_DEFAUT)
    expect(resultat.recurrente).toBe(false)
  })

  it('ignore les ruptures hors fenêtre de 60 jours', () => {
    const historique = [releve('rupture', 10, 'v1'), releve('rupture', 90, 'v2')]
    const resultat = compterRupturesRecurrentes(historique, new Date('2026-08-19'), CONFIG_MOTEUR_DEFAUT)
    expect(resultat.nombre).toBe(1)
    expect(resultat.recurrente).toBe(false)
  })

  it('ignore les relevés qui ne sont pas des ruptures', () => {
    const historique = [releve('rupture', 10, 'v1'), releve('present', 20, 'v2')]
    const resultat = compterRupturesRecurrentes(historique, new Date('2026-08-19'), CONFIG_MOTEUR_DEFAUT)
    expect(resultat.nombre).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/historique-ruptures.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```ts
// lib/engine/historique-ruptures.ts
import type { StatutProduitMagasinHistorique } from '@/lib/types'
import type { ConfigMoteur } from './config-moteur'

export function compterRupturesRecurrentes(
  historique: StatutProduitMagasinHistorique[],
  aujourdHui: Date,
  config: ConfigMoteur
): { nombre: number; recurrente: boolean } {
  const limite = new Date(aujourdHui)
  limite.setDate(limite.getDate() - config.fenetreRecurrenceJours)

  const nombre = historique.filter(h => h.statut === 'rupture' && new Date(h.signale_at) >= limite).length

  return { nombre, recurrente: nombre >= config.seuilRecurrenceRuptures }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/historique-ruptures.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/engine/historique-ruptures.ts lib/engine/historique-ruptures.test.ts
git commit -m "feat: comptage des ruptures récurrentes sur fenêtre glissante"
```

---

### Task 7: Exclusion par type de mission

**Files:**
- Create: `lib/engine/exclusion.ts`
- Test: `lib/engine/exclusion.test.ts`

**Interfaces:**
- Consumes: `TypeMission`, `StatutDisponibilite`, `StatutProduit`, `Produit['statut_catalogue']`, `StadePromo` (existant, `lib/engine/stade-promo.ts`).
- Produces: `typesExclus(ctx: ContexteExclusion): Set<TypeMission>` — consommé par l'orchestrateur (Task 14).

Le cas « opportunité déjà `reussie`/`abandonnee` sans nouveau déclencheur » (ligne 4 du tableau §4.1) est géré par le rattachement (Task 12/13), pas ici — éviter la duplication entre exclusion et réouverture.

- [ ] **Step 1: Écrire le test**

```ts
// lib/engine/exclusion.test.ts
import { describe, expect, it } from 'vitest'
import { typesExclus, type ContexteExclusion } from './exclusion'

function ctx(overrides: Partial<ContexteExclusion> = {}): ContexteExclusion {
  return {
    statutDisponibilite: 'commandable',
    statutCatalogue: 'permanent',
    statutProduitMagasin: 'manquant',
    promoStade: null,
    constaterDejaActionne: false,
    ...overrides,
  }
}

describe('typesExclus', () => {
  it('produit non commandable exclut tous les types', () => {
    const exclus = typesExclus(ctx({ statutDisponibilite: 'non_commandable' }))
    expect(exclus.has('referencer_produit')).toBe(true)
    expect(exclus.has('revendre_promo')).toBe(true)
    expect(exclus.size).toBe(10)
  })

  it('produit déjà présent exclut referencer_produit mais jamais revendre_promo/constater_promo/securiser_commande/optimiser_implantation', () => {
    const exclus = typesExclus(ctx({ statutProduitMagasin: 'present' }))
    expect(exclus.has('referencer_produit')).toBe(true)
    expect(exclus.has('revendre_promo')).toBe(false)
    expect(exclus.has('constater_promo')).toBe(false)
    expect(exclus.has('securiser_commande')).toBe(false)
    expect(exclus.has('optimiser_implantation')).toBe(false)
  })

  it('hors plan de vente (a_qualifier) exclut tout sauf verifier_information', () => {
    const exclus = typesExclus(ctx({ statutCatalogue: 'a_qualifier' }))
    expect(exclus.has('verifier_information')).toBe(false)
    expect(exclus.has('referencer_produit')).toBe(true)
  })

  it('promo au stade constater déjà actionnée exclut constater_promo pour cette promo', () => {
    const exclus = typesExclus(ctx({ promoStade: 'constater', constaterDejaActionne: true }))
    expect(exclus.has('constater_promo')).toBe(true)
  })

  it('promo au stade constater pas encore actionnée n\'exclut rien de plus', () => {
    const exclus = typesExclus(ctx({ promoStade: 'constater', constaterDejaActionne: false }))
    expect(exclus.has('constater_promo')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/exclusion.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```ts
// lib/engine/exclusion.ts
import type { StatutDisponibilite, StatutProduit, Produit, TypeMission } from '@/lib/types'
import type { StadePromo } from './stade-promo'

const TOUS_TYPES_MISSION: TypeMission[] = [
  'anticiper_promo', 'revendre_promo', 'constater_promo',
  'referencer_produit', 'corriger_rupture', 'securiser_commande',
  'suivre_engagement', 'optimiser_implantation', 'proposer_test_ht', 'verifier_information',
]

export interface ContexteExclusion {
  statutDisponibilite: StatutDisponibilite
  statutCatalogue: Produit['statut_catalogue']
  statutProduitMagasin: StatutProduit
  promoStade: StadePromo | null
  constaterDejaActionne: boolean
}

export function typesExclus(ctx: ContexteExclusion): Set<TypeMission> {
  if (ctx.statutDisponibilite === 'non_commandable' || ctx.statutDisponibilite === 'arret_industriel') {
    return new Set(TOUS_TYPES_MISSION)
  }

  const exclus = new Set<TypeMission>()

  if (ctx.statutCatalogue === 'a_qualifier') {
    for (const t of TOUS_TYPES_MISSION) {
      if (t !== 'verifier_information') exclus.add(t)
    }
  }

  if (ctx.statutProduitMagasin === 'present') {
    exclus.add('referencer_produit')
  }

  if (ctx.promoStade === 'constater' && ctx.constaterDejaActionne) {
    exclus.add('constater_promo')
  }

  return exclus
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/exclusion.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/engine/exclusion.ts lib/engine/exclusion.test.ts
git commit -m "feat: exclusion des types de mission dépendante du contexte produit"
```

---

### Task 8: Détecteurs de signaux

**Files:**
- Create: `lib/engine/signal.ts`
- Create: `lib/engine/detecteurs.ts`
- Test: `lib/engine/detecteurs.test.ts`

**Interfaces:**
- Consumes: `stadePromo` (existant), `compterRupturesRecurrentes` (Task 6), `ConfigMoteur` (Task 3).
- Produces: `SignalDetecte` (interface), `ContexteDetection` (interface), `detecterSignaux(ctx, config): SignalDetecte[]` — consommé par la classification (Task 9), le score (Task 10), l'orchestrateur (Task 14).

Convention à respecter (documentée en commentaire dans le fichier) : quand un signal référence une promo comme **preuve** plutôt que comme identité de la mission (ex. le permanent manquant cite la promo qui justifie l'urgence, mais la mission reste `referencer_produit`), le signal porte `promoId: null` et `sourceType: 'promo'`/`sourceId: <promo.id>` — c'est ce couple que l'orchestrateur (Task 14) utilise pour peupler `opportunite_promos_preuves`. Un signal qui porte `promoId` non nul EST l'identité de la mission (types `anticiper_promo`/`revendre_promo`/`constater_promo`).

Sur les 8 détecteurs listés en §4.2, 6 sont modélisés comme des blocs de code distincts ci-dessous (`constater_promo`, `revendre_promo`, `referencer_produit`+promo proche, `ope_trade`, `suivre_engagement`, `corriger_rupture` récurrente). Les deux derniers (« accord à sécuriser », « action promise non exécutée ») ne reçoivent pas de détecteur séparé — ce sont des variantes du même fait qu'« engagement échu » (un accord ou une action promise sans exécution constatée avant `prochaine_action_at`) et sont donc couverts par le détecteur `suivre_engagement` ci-dessous plutôt que dupliqués. Documenté explicitement plutôt que revendiqué comme 8 détecteurs distincts.

- [ ] **Step 1: Créer `lib/engine/signal.ts`**

```ts
// lib/engine/signal.ts
import type { TypeMission } from '@/lib/types'

export type SourceSignal = 'promo' | 'statut' | 'engagement' | 'vmh' | 'top' | 'typologie' | 'comparable' | 'historique_rupture'

export interface SignalDetecte {
  typeMission: TypeMission
  promoId: string | null
  niveauDeclenche: 'P1' | 'P2' | 'P3'
  codeSignal: string
  sourceType: SourceSignal
  sourceId: string
  observedAt: string
  expiresAt: string | null
  force: number
  donneesArgumentaire: Record<string, unknown>
}
```

- [ ] **Step 2: Écrire le test des détecteurs**

```ts
// lib/engine/detecteurs.test.ts
import { describe, expect, it } from 'vitest'
import { detecterSignaux, type ContexteDetection } from './detecteurs'
import { CONFIG_MOTEUR_DEFAUT } from './config-moteur'
import type { Magasin, Produit, Promo, Opportunite } from '@/lib/types'

const magasin: Magasin = { id: 'm1', code: 'M1', nom: 'Test', enseigne: 'Carrefour', taille: 'hyper', adresse: null, secteur_id: 's1', contact_nom: null, contact_telephone: null, contact_email: null, surface: null }
const produit: Produit = { id: 'p1', code: 'EAN1', nom: 'Produit Test', categorie: null, produit_canonique_id: null, famille: null, segment: null, statut_catalogue: 'permanent', type_liaison: null }

function promo(overrides: Partial<Promo> = {}): Promo {
  return { id: 'promo1', code: 'PR1', enseigne: 'Carrefour', mecanique: 'ODR', date_installation: null, date_debut_vente: '2026-08-20', date_constat: null, date_fin_vente: null, op_trade: null, ...overrides }
}

function ctx(overrides: Partial<ContexteDetection> = {}): ContexteDetection {
  return {
    magasin, produit,
    statutProduitMagasin: 'manquant',
    promosApplicables: [],
    opportunitesExistantes: [],
    rangTop: null,
    historiqueRuptures: [],
    aujourdHui: new Date('2026-08-19'),
    ...overrides,
  }
}

describe('detecterSignaux', () => {
  it('promo au stade constater produit un signal constater_promo P1', () => {
    const signaux = detecterSignaux(ctx({ promosApplicables: [promo({ date_debut_vente: '2026-07-01', date_fin_vente: '2026-08-10' })] }), CONFIG_MOTEUR_DEFAUT)
    const signal = signaux.find(s => s.typeMission === 'constater_promo')
    expect(signal).toBeDefined()
    expect(signal!.niveauDeclenche).toBe('P1')
    expect(signal!.promoId).toBe('promo1')
  })

  it('permanent manquant + promo à J-14 produit un signal referencer_produit citant la promo en preuve', () => {
    const signaux = detecterSignaux(ctx({ promosApplicables: [promo({ date_installation: '2026-09-02', date_debut_vente: '2026-09-05' })] }), CONFIG_MOTEUR_DEFAUT)
    const signal = signaux.find(s => s.typeMission === 'referencer_produit')
    expect(signal).toBeDefined()
    expect(signal!.promoId).toBeNull()
    expect(signal!.sourceType).toBe('promo')
    expect(signal!.sourceId).toBe('promo1')
    expect(signal!.niveauDeclenche).toBe('P1')
  })

  it('produit présent n\'émet aucun signal referencer_produit même avec promo proche', () => {
    const signaux = detecterSignaux(ctx({ statutProduitMagasin: 'present', promosApplicables: [promo({ date_installation: '2026-09-02', date_debut_vente: '2026-09-05' })] }), CONFIG_MOTEUR_DEFAUT)
    expect(signaux.find(s => s.typeMission === 'referencer_produit')).toBeUndefined()
  })

  it('engagement échu produit un signal suivre_engagement P1', () => {
    const opp: Opportunite = {
      id: 'o1', magasin_id: 'm1', produit_canonique_id: 'p1', type_mission: 'referencer_produit', promo_id: null,
      statut: 'accord_obtenu', niveau_priorite: 'P1', score: 80, confiance: 'donnees_confirmees', raisons_actuelles: null,
      score_calcule_at: null, fingerprint: null, version_moteur: null, cycle: 1, derniere_reouverture_at: null,
      cree_at: '2026-08-01', cloture_at: null, prochaine_action_at: '2026-08-15',
    }
    const signaux = detecterSignaux(ctx({ opportunitesExistantes: [opp] }), CONFIG_MOTEUR_DEFAUT)
    const signal = signaux.find(s => s.typeMission === 'suivre_engagement')
    expect(signal).toBeDefined()
    expect(signal!.niveauDeclenche).toBe('P1')
  })

  it('rupture récurrente sur Top 20 produit un signal corriger_rupture P1', () => {
    const historique = [
      { id: 'h1', magasin_id: 'm1', produit_id: 'p1', statut: 'rupture' as const, raison_absence: null, visite_id: 'v1', signale_par: null, signale_at: '2026-08-01' },
      { id: 'h2', magasin_id: 'm1', produit_id: 'p1', statut: 'rupture' as const, raison_absence: null, visite_id: 'v2', signale_par: null, signale_at: '2026-08-10' },
    ]
    const signaux = detecterSignaux(ctx({ rangTop: 20, historiqueRuptures: historique }), CONFIG_MOTEUR_DEFAUT)
    const signal = signaux.find(s => s.typeMission === 'corriger_rupture')
    expect(signal).toBeDefined()
    expect(signal!.niveauDeclenche).toBe('P1')
  })

  it('ope_trade produit un signal P1 quel que soit le stade', () => {
    const signaux = detecterSignaux(ctx({ promosApplicables: [promo({ date_debut_vente: '2026-10-01', op_trade: 'oui' })] }), CONFIG_MOTEUR_DEFAUT)
    expect(signaux.some(s => s.codeSignal === 'ope_trade' && s.niveauDeclenche === 'P1')).toBe(true)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/engine/detecteurs.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 4: Implémenter**

```ts
// lib/engine/detecteurs.ts
import type { Magasin, Produit, Promo, Opportunite, StatutProduit, StatutProduitMagasinHistorique } from '@/lib/types'
import { stadePromo } from './stade-promo'
import { compterRupturesRecurrentes } from './historique-ruptures'
import type { ConfigMoteur } from './config-moteur'
import type { SignalDetecte } from './signal'

export interface ContexteDetection {
  magasin: Magasin
  produit: Produit
  statutProduitMagasin: StatutProduit
  promosApplicables: Promo[]
  opportunitesExistantes: Opportunite[]
  rangTop: 20 | 50 | 70 | null
  historiqueRuptures: StatutProduitMagasinHistorique[]
  aujourdHui: Date
}

function joursEntre(dateIso: string, aujourdHui: Date): number {
  return Math.ceil((new Date(dateIso).getTime() - aujourdHui.getTime()) / 86_400_000)
}

export function detecterSignaux(ctx: ContexteDetection, config: ConfigMoteur): SignalDetecte[] {
  const signaux: SignalDetecte[] = []
  const manquant = ctx.statutProduitMagasin === 'manquant' || ctx.statutProduitMagasin === 'rupture'

  for (const promo of ctx.promosApplicables) {
    const stade = stadePromo(promo, ctx.aujourdHui)

    if (stade === 'constater') {
      signaux.push({
        typeMission: 'constater_promo', promoId: promo.id, niveauDeclenche: 'P1',
        codeSignal: 'promo_a_constater', sourceType: 'promo', sourceId: promo.id,
        observedAt: ctx.aujourdHui.toISOString(), expiresAt: null, force: 40,
        donneesArgumentaire: { mecanique: promo.mecanique, dateFinVente: promo.date_fin_vente },
      })
    }

    if (stade === 'revendre') {
      signaux.push({
        typeMission: 'revendre_promo', promoId: promo.id, niveauDeclenche: 'P1',
        codeSignal: 'promo_a_revendre', sourceType: 'promo', sourceId: promo.id,
        observedAt: ctx.aujourdHui.toISOString(), expiresAt: promo.date_debut_vente, force: 35,
        donneesArgumentaire: { mecanique: promo.mecanique, dateDebutVente: promo.date_debut_vente },
      })
    }

    if (stade === 'anticiper' && manquant) {
      const jalon = promo.date_installation ?? promo.date_debut_vente
      const jours = joursEntre(jalon, ctx.aujourdHui)
      if (jours <= 28) {
        signaux.push({
          typeMission: 'referencer_produit', promoId: null, niveauDeclenche: jours <= 14 ? 'P1' : 'P2',
          codeSignal: 'permanent_manquant_promo_proche', sourceType: 'promo', sourceId: promo.id,
          observedAt: ctx.aujourdHui.toISOString(), expiresAt: jalon, force: jours <= 14 ? 35 : 25,
          donneesArgumentaire: { mecanique: promo.mecanique, jours },
        })
      }
    }

    if (promo.op_trade) {
      signaux.push({
        typeMission: stade === 'constater' ? 'constater_promo' : stade === 'controler' || stade === 'revendre' ? 'securiser_commande' : 'anticiper_promo',
        promoId: stade === 'anticiper' || stade === 'revendre' || stade === 'constater' ? promo.id : null,
        niveauDeclenche: 'P1', codeSignal: 'ope_trade', sourceType: 'promo', sourceId: promo.id,
        observedAt: ctx.aujourdHui.toISOString(), expiresAt: promo.date_debut_vente, force: 40,
        donneesArgumentaire: { mecanique: promo.mecanique, opTrade: promo.op_trade },
      })
    }
  }

  for (const opp of ctx.opportunitesExistantes) {
    if (opp.prochaine_action_at && (opp.statut === 'accord_obtenu' || opp.statut === 'commandee')) {
      const echu = new Date(opp.prochaine_action_at) <= ctx.aujourdHui
      if (echu) {
        signaux.push({
          typeMission: 'suivre_engagement', promoId: opp.promo_id, niveauDeclenche: 'P1',
          codeSignal: 'engagement_echu', sourceType: 'engagement', sourceId: opp.id,
          observedAt: ctx.aujourdHui.toISOString(), expiresAt: null, force: 35,
          donneesArgumentaire: { prochaineActionAt: opp.prochaine_action_at, statutPrecedent: opp.statut },
        })
      }
    }
  }

  const recurrence = compterRupturesRecurrentes(ctx.historiqueRuptures, ctx.aujourdHui, config)
  if (recurrence.recurrente) {
    signaux.push({
      typeMission: 'corriger_rupture', promoId: null, niveauDeclenche: ctx.rangTop === 20 ? 'P1' : 'P2',
      codeSignal: 'rupture_recurrente', sourceType: 'historique_rupture', sourceId: `${ctx.magasin.id}:${ctx.produit.id}`,
      observedAt: ctx.aujourdHui.toISOString(), expiresAt: null, force: 25,
      donneesArgumentaire: { nombreRuptures: recurrence.nombre, fenetreJours: config.fenetreRecurrenceJours },
    })
  }

  return signaux
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/engine/detecteurs.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Commit**

```bash
git add lib/engine/signal.ts lib/engine/detecteurs.ts lib/engine/detecteurs.test.ts
git commit -m "feat: détecteurs de signaux du moteur d'opportunités"
```

---

### Task 9: Classification P1/P2/P3

**Files:**
- Create: `lib/engine/classification.ts`
- Test: `lib/engine/classification.test.ts`

**Interfaces:**
- Consumes: `SignalDetecte[]` (Task 8).
- Produces: `classifierNiveau(signaux: SignalDetecte[]): { niveau: NiveauPrioriteOpportunite; raisonPrincipale: string } | null` — consommé par l'orchestrateur (Task 14) et le calcul du fingerprint.

- [ ] **Step 1: Écrire le test**

```ts
// lib/engine/classification.test.ts
import { describe, expect, it } from 'vitest'
import { classifierNiveau } from './classification'
import type { SignalDetecte } from './signal'

function signal(overrides: Partial<SignalDetecte>): SignalDetecte {
  return {
    typeMission: 'referencer_produit', promoId: null, niveauDeclenche: 'P3',
    codeSignal: 'test', sourceType: 'statut', sourceId: 's1',
    observedAt: '2026-08-19T00:00:00.000Z', expiresAt: null, force: 10,
    donneesArgumentaire: {}, ...overrides,
  }
}

describe('classifierNiveau', () => {
  it('retient le niveau le plus fort parmi plusieurs signaux', () => {
    const resultat = classifierNiveau([signal({ niveauDeclenche: 'P3', force: 5 }), signal({ niveauDeclenche: 'P1', force: 40, codeSignal: 'promo_a_constater' })])
    expect(resultat?.niveau).toBe('P1')
  })

  it('ne somme jamais plusieurs signaux P2 pour atteindre P1', () => {
    const resultat = classifierNiveau([signal({ niveauDeclenche: 'P2', force: 25 }), signal({ niveauDeclenche: 'P2', force: 25 })])
    expect(resultat?.niveau).toBe('P2')
  })

  it('retourne null pour une liste vide', () => {
    expect(classifierNiveau([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/classification.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```ts
// lib/engine/classification.ts
import type { NiveauPrioriteOpportunite } from '@/lib/types'
import type { SignalDetecte } from './signal'

const ORDRE_NIVEAU: Record<NiveauPrioriteOpportunite, number> = { P3: 1, P2: 2, P1: 3 }

export function classifierNiveau(signaux: SignalDetecte[]): { niveau: NiveauPrioriteOpportunite; raisonPrincipale: string } | null {
  if (signaux.length === 0) return null

  const meilleur = signaux.reduce((a, b) => (ORDRE_NIVEAU[b.niveauDeclenche] > ORDRE_NIVEAU[a.niveauDeclenche] ? b : a))

  return {
    niveau: meilleur.niveauDeclenche,
    raisonPrincipale: meilleur.codeSignal,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/classification.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/engine/classification.ts lib/engine/classification.test.ts
git commit -m "feat: classification P1/P2/P3 par signal le plus fort"
```

---

### Task 10: Score

**Files:**
- Modify: `lib/engine/scoring.ts`
- Test: `lib/engine/scoring.test.ts` (existant, étendre)

**Interfaces:**
- Consumes: `SignalDetecte[]` (Task 8), `ConfigMoteur` (Task 3).
- Produces: `calculerScoreOpportunite(signaux: SignalDetecte[], penalite: number, config: ConfigMoteur): number` — consommé par l'orchestrateur (Task 14).

Étend `scoring.ts` (déjà porteur de `SCORE_PAR_RANG`/`SCORE_OP_TRADE`), ne le remplace pas — nouvelle fonction ajoutée au fichier existant.

- [ ] **Step 1: Lire le fichier existant**

`lib/engine/scoring.ts` contient déjà `Rang`, `scoreRangProduit`, `scoreUrgenceDate`, `SCORE_OP_TRADE`, `scoreMagasinsSimilaires`. Ajouter à la suite, ne rien renommer.

- [ ] **Step 2: Écrire le test**

Sur les 4 composants de la grille (§6), ce sous-projet en couvre honnêtement 3 : urgence (tous les détecteurs), impact (`ope_trade` + Top, tous deux produits par les détecteurs du Task 8), faisabilité (accord déjà obtenu, dérivable de `opportuniteExistante.statut`). **Pertinence magasin reste à 0** — son seul déclencheur possible dans la grille (« attendu selon typologie ») est explicitement bloqué (§4.2/§9) et aucun détecteur de ce sous-projet ne produit de signal `comparable`/`typologie`. Ne pas plafonner silencieusement à la valeur max comme dans une première version envisagée — un score qui prétend 20/20 de pertinence sans aucune donnée serait une affirmation inventée, contraire à la contrainte globale du plan.

```ts
// lib/engine/scoring.test.ts — ajouter à la suite des tests existants
import { calculerScoreOpportunite } from './scoring'
import { CONFIG_MOTEUR_DEFAUT } from './config-moteur'
import type { SignalDetecte } from './signal'

describe('calculerScoreOpportunite', () => {
  function signal(overrides: Partial<SignalDetecte>): SignalDetecte {
    return {
      typeMission: 'referencer_produit', promoId: null, niveauDeclenche: 'P1',
      codeSignal: 'x', sourceType: 'statut', sourceId: 's1',
      observedAt: '2026-08-19T00:00:00.000Z', expiresAt: null, force: 10,
      donneesArgumentaire: {}, ...overrides,
    }
  }
  const contexteVide = { rangTop: null, accordDejaObtenu: false }

  it('retient le signal d\'urgence le plus fort, ne somme jamais plusieurs urgences', () => {
    const score = calculerScoreOpportunite([signal({ codeSignal: 'promo_a_constater', force: 40 }), signal({ codeSignal: 'permanent_manquant_promo_proche', force: 25 })], contexteVide, 0, CONFIG_MOTEUR_DEFAUT)
    expect(score).toBe(40)
  })

  it('ope_trade et Top 20 s\'ajoutent en impact, exclusifs entre eux pour le rang', () => {
    const score = calculerScoreOpportunite([signal({ codeSignal: 'ope_trade', force: 40 })], { rangTop: 20, accordDejaObtenu: false }, 0, CONFIG_MOTEUR_DEFAUT)
    expect(score).toBe(40 + 15 + 15) // urgence 40 + ope_trade 15 + Top20 15
  })

  it('Top 50 et Top 70 ne s\'ajoutent jamais à Top 20', () => {
    const score50 = calculerScoreOpportunite([signal({ force: 10 })], { rangTop: 50, accordDejaObtenu: false }, 0, CONFIG_MOTEUR_DEFAUT)
    expect(score50).toBe(10 + 10)
  })

  it('accord déjà obtenu ajoute la faisabilité', () => {
    const score = calculerScoreOpportunite([signal({ force: 10 })], { rangTop: null, accordDejaObtenu: true }, 0, CONFIG_MOTEUR_DEFAUT)
    expect(score).toBe(10 + 10)
  })

  it('une pénalité de réouverture après refus réduit le score sans jamais le faire sortir de sa plage', () => {
    const scoreAvecPenalite = calculerScoreOpportunite([signal({ codeSignal: 'promo_a_constater', force: 40 })], contexteVide, CONFIG_MOTEUR_DEFAUT.penaliteReouvertureApresRefus, CONFIG_MOTEUR_DEFAUT)
    expect(scoreAvecPenalite).toBe(15)
  })

  it('score minimal jamais négatif', () => {
    const score = calculerScoreOpportunite([signal({ force: 5 })], contexteVide, -100, CONFIG_MOTEUR_DEFAUT)
    expect(score).toBe(0)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run lib/engine/scoring.test.ts`
Expected: FAIL — `calculerScoreOpportunite` n'existe pas encore.

- [ ] **Step 4: Ajouter la fonction dans `lib/engine/scoring.ts`**

```ts
// Ajouté à lib/engine/scoring.ts
import type { SignalDetecte } from './signal'
import type { ConfigMoteur } from './config-moteur'

export interface ContexteScoreOpportunite {
  rangTop: 20 | 50 | 70 | null
  accordDejaObtenu: boolean
}

// Grille validée (spec §6). Urgence retient le signal le plus fort, jamais
// une somme. Impact/faisabilité n'agrègent que ce que les détecteurs de ce
// sous-projet produisent réellement (ope_trade, Top, accord déjà obtenu).
// Pertinence magasin reste à 0 : son seul déclencheur (typologie) est
// bloqué (§4.2/§9) — jamais plafonnée artificiellement à sa valeur max.
export function calculerScoreOpportunite(
  signaux: SignalDetecte[],
  contexte: ContexteScoreOpportunite,
  penalite: number,
  config: ConfigMoteur
): number {
  const urgence = signaux.length > 0 ? Math.min(Math.max(...signaux.map(s => s.force)), config.score.urgenceMax) : 0

  let impact = 0
  if (signaux.some(s => s.codeSignal === 'ope_trade')) impact += 15
  if (contexte.rangTop === 20) impact += 15
  else if (contexte.rangTop === 50) impact += 10
  else if (contexte.rangTop === 70) impact += 5
  impact = Math.min(impact, config.score.impactMax)

  const pertinence = 0

  let faisabilite = 0
  if (contexte.accordDejaObtenu) faisabilite += 10
  faisabilite = Math.min(faisabilite, config.score.faisabiliteMax)

  const brut = urgence + impact + pertinence + faisabilite + penalite
  const plafond = config.score.urgenceMax + config.score.impactMax + config.score.pertinenceMax + config.score.faisabiliteMax
  return Math.max(0, Math.min(brut, plafond))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run lib/engine/scoring.test.ts`
Expected: PASS (tests existants + 6 nouveaux)

- [ ] **Step 6: Commit**

```bash
git add lib/engine/scoring.ts lib/engine/scoring.test.ts
git commit -m "feat: calcul du score d'opportunité (urgence retenue, pas sommée, pénalités bornées)"
```

---

### Task 11: Confiance et détection de contradiction

**Files:**
- Create: `lib/engine/confiance.ts`
- Test: `lib/engine/confiance.test.ts`

**Interfaces:**
- Consumes: `SignalDetecte[]` (Task 8).
- Produces: `determinerConfiance(signaux: SignalDetecte[]): { confiance: Confiance; contradiction: boolean }` — consommé par l'orchestrateur (Task 14).

Une contradiction ici = deux signaux du même `sourceType` avec des `niveauDeclenche` fortement divergents (P1 vs P3) sur le même `(typeMission, promoId)` — signe que les données sources se contredisent plutôt que de converger.

- [ ] **Step 1: Écrire le test**

```ts
// lib/engine/confiance.test.ts
import { describe, expect, it } from 'vitest'
import { determinerConfiance } from './confiance'
import type { SignalDetecte } from './signal'

function signal(overrides: Partial<SignalDetecte>): SignalDetecte {
  return {
    typeMission: 'referencer_produit', promoId: null, niveauDeclenche: 'P1',
    codeSignal: 'promo_a_constater', sourceType: 'promo', sourceId: 's1',
    observedAt: '2026-08-19T00:00:00.000Z', expiresAt: null, force: 40,
    donneesArgumentaire: {}, ...overrides,
  }
}

describe('determinerConfiance', () => {
  it('signal direct daté (promo) → donnees_confirmees', () => {
    const resultat = determinerConfiance([signal({ sourceType: 'promo' })])
    expect(resultat.confiance).toBe('donnees_confirmees')
    expect(resultat.contradiction).toBe(false)
  })

  it('signal indirect (vmh/comparable) sans déclencheur direct → recommandation_probable', () => {
    const resultat = determinerConfiance([signal({ sourceType: 'vmh', codeSignal: 'vmh_favorable' })])
    expect(resultat.confiance).toBe('recommandation_probable')
  })

  it('deux signaux P1 et P3 sur le même type de mission → contradiction, information_a_verifier', () => {
    const resultat = determinerConfiance([
      signal({ typeMission: 'referencer_produit', promoId: null, niveauDeclenche: 'P1', sourceType: 'promo' }),
      signal({ typeMission: 'referencer_produit', promoId: null, niveauDeclenche: 'P3', sourceType: 'statut', codeSignal: 'statut_incoherent' }),
    ])
    expect(resultat.contradiction).toBe(true)
    expect(resultat.confiance).toBe('information_a_verifier')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/confiance.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```ts
// lib/engine/confiance.ts
import type { Confiance } from '@/lib/types'
import type { SignalDetecte } from './signal'

const SOURCES_DIRECTES: SignalDetecte['sourceType'][] = ['promo', 'engagement', 'historique_rupture']

export function determinerConfiance(signaux: SignalDetecte[]): { confiance: Confiance; contradiction: boolean } {
  const parTypeEtPromo = new Map<string, SignalDetecte[]>()
  for (const s of signaux) {
    const cle = `${s.typeMission}:${s.promoId ?? ''}`
    const liste = parTypeEtPromo.get(cle) ?? []
    liste.push(s)
    parTypeEtPromo.set(cle, liste)
  }

  const contradiction = [...parTypeEtPromo.values()].some(groupe => {
    const niveaux = new Set(groupe.map(s => s.niveauDeclenche))
    return niveaux.has('P1') && niveaux.has('P3')
  })

  if (contradiction) return { confiance: 'information_a_verifier', contradiction: true }

  const aUnSignalDirect = signaux.some(s => SOURCES_DIRECTES.includes(s.sourceType))
  return { confiance: aUnSignalDirect ? 'donnees_confirmees' : 'recommandation_probable', contradiction: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/confiance.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/engine/confiance.ts lib/engine/confiance.test.ts
git commit -m "feat: détermination de la confiance et détection de contradiction"
```

---

### Task 12: Fingerprint

**Files:**
- Create: `lib/engine/fingerprint.ts`
- Test: `lib/engine/fingerprint.test.ts`

**Interfaces:**
- Consumes: `RaisonsActuelles` (Task 2), `NiveauPrioriteOpportunite`, `Confiance`, `StatutOpportunite`.
- Produces: `calculerFingerprint(resultat): string` — consommé par l'orchestrateur (Task 14) et transmis à la fonction Postgres (Task 13).

- [ ] **Step 1: Écrire le test**

```ts
// lib/engine/fingerprint.test.ts
import { describe, expect, it } from 'vitest'
import { calculerFingerprint } from './fingerprint'
import type { RaisonsActuelles } from './raison'

const raisons: RaisonsActuelles = {
  version: 1,
  raisons: [{ version: 1, codeSignal: 'promo_a_constater', source: { type: 'promo', id: 'p1' }, observedAt: '2026-08-19', fraicheur: 'fraiche', contributionScore: 40, niveauDeclenche: 'P1', texteCommercial: 'x' }],
}

describe('calculerFingerprint', () => {
  it('produit le même fingerprint pour un résultat identique', () => {
    const a = calculerFingerprint({ niveauPriorite: 'P1', score: 80, confiance: 'donnees_confirmees', raisons, statut: 'detectee' })
    const b = calculerFingerprint({ niveauPriorite: 'P1', score: 80, confiance: 'donnees_confirmees', raisons, statut: 'detectee' })
    expect(a).toBe(b)
  })

  it('produit un fingerprint différent si le score change', () => {
    const a = calculerFingerprint({ niveauPriorite: 'P1', score: 80, confiance: 'donnees_confirmees', raisons, statut: 'detectee' })
    const b = calculerFingerprint({ niveauPriorite: 'P1', score: 55, confiance: 'donnees_confirmees', raisons, statut: 'detectee' })
    expect(a).not.toBe(b)
  })

  it('est indépendant de l\'ordre des raisons', () => {
    const raisons2: RaisonsActuelles = { version: 1, raisons: [...raisons.raisons].reverse() }
    const a = calculerFingerprint({ niveauPriorite: 'P1', score: 80, confiance: 'donnees_confirmees', raisons, statut: 'detectee' })
    const b = calculerFingerprint({ niveauPriorite: 'P1', score: 80, confiance: 'donnees_confirmees', raisons: raisons2, statut: 'detectee' })
    expect(a).toBe(b)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/fingerprint.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```ts
// lib/engine/fingerprint.ts
import { createHash } from 'crypto'
import type { Confiance, NiveauPrioriteOpportunite, StatutOpportunite } from '@/lib/types'
import type { RaisonsActuelles } from './raison'

export interface ResultatMoteur {
  niveauPriorite: NiveauPrioriteOpportunite | null
  score: number | null
  confiance: Confiance | null
  raisons: RaisonsActuelles | null
  statut: StatutOpportunite
}

export function calculerFingerprint(resultat: ResultatMoteur): string {
  const canonique = {
    niveauPriorite: resultat.niveauPriorite,
    score: resultat.score,
    confiance: resultat.confiance,
    raisons: (resultat.raisons?.raisons ?? [])
      .map(r => ({ code: r.codeSignal, source: r.source, contribution: r.contributionScore, niveau: r.niveauDeclenche }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    statut: resultat.statut,
  }
  return createHash('sha256').update(JSON.stringify(canonique)).digest('hex')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/fingerprint.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/engine/fingerprint.ts lib/engine/fingerprint.test.ts
git commit -m "feat: fingerprint canonique du résultat du moteur"
```

---

### Task 13: Fonction Postgres transactionnelle `rattacher_opportunite`

**Files:**
- Create: `supabase/migrations/0013_rattacher_opportunite.sql`

**Interfaces:**
- Consumes: tables du Task 1.
- Produces: fonction RPC `rattacher_opportunite(...)` — appelée par l'orchestrateur TS (Task 14).

- [ ] **Step 1: Écrire la migration**

```sql
-- supabase/migrations/0013_rattacher_opportunite.sql
create or replace function rattacher_opportunite(
  p_magasin_id uuid,
  p_produit_canonique_id uuid,
  p_type_mission text,
  p_promo_id uuid,
  p_niveau_priorite text,
  p_score integer,
  p_confiance text,
  p_raisons jsonb,
  p_fingerprint text,
  p_version_moteur text,
  p_declencheur_reel boolean,
  p_preuves_promo_ids uuid[],
  p_visite_id uuid default null
) returns opportunites as $$
declare
  v_id uuid;
  v_ancien_fingerprint text;
  v_ancien_statut text;
  v_opportunite opportunites;
begin
  select id, fingerprint, statut into v_id, v_ancien_fingerprint, v_ancien_statut
  from opportunites
  where magasin_id = p_magasin_id
    and produit_canonique_id = p_produit_canonique_id
    and type_mission = p_type_mission
    and (promo_id = p_promo_id or (promo_id is null and p_promo_id is null))
  for update;

  if v_id is null then
    insert into opportunites (
      magasin_id, produit_canonique_id, type_mission, promo_id,
      niveau_priorite, score, confiance, raisons_actuelles, score_calcule_at, fingerprint, version_moteur
    ) values (
      p_magasin_id, p_produit_canonique_id, p_type_mission, p_promo_id,
      p_niveau_priorite, p_score, p_confiance, p_raisons, now(), p_fingerprint, p_version_moteur
    ) returning * into v_opportunite;

    insert into opportunite_evenements (opportunite_id, type, visite_id, score_a_ce_moment, raisons, statut_apres)
    values (v_opportunite.id, 'creation', p_visite_id, p_score, p_raisons, v_opportunite.statut);

  elsif v_ancien_statut in ('reussie', 'abandonnee', 'refusee') and not p_declencheur_reel then
    select * into v_opportunite from opportunites where id = v_id;

  elsif v_ancien_statut in ('reussie', 'abandonnee') or (v_ancien_statut = 'refusee' and p_declencheur_reel) then
    update opportunites set
      statut = 'detectee', niveau_priorite = p_niveau_priorite, score = p_score, confiance = p_confiance,
      raisons_actuelles = p_raisons, score_calcule_at = now(), fingerprint = p_fingerprint,
      version_moteur = p_version_moteur, cycle = cycle + 1, derniere_reouverture_at = now(), cloture_at = null
    where id = v_id
    returning * into v_opportunite;

    insert into opportunite_evenements (opportunite_id, type, visite_id, score_a_ce_moment, raisons, statut_avant, statut_apres)
    values (v_id, 'reouverture', p_visite_id, p_score, p_raisons, v_ancien_statut, 'detectee');

  elsif v_ancien_fingerprint is distinct from p_fingerprint then
    update opportunites set
      niveau_priorite = p_niveau_priorite, score = p_score, confiance = p_confiance,
      raisons_actuelles = p_raisons, score_calcule_at = now(), fingerprint = p_fingerprint, version_moteur = p_version_moteur
    where id = v_id
    returning * into v_opportunite;

    insert into opportunite_evenements (opportunite_id, type, visite_id, score_a_ce_moment, raisons, statut_avant, statut_apres)
    values (v_id, 'recalcul_score', p_visite_id, p_score, p_raisons, v_ancien_statut, v_opportunite.statut);

  else
    update opportunites set score_calcule_at = now() where id = v_id returning * into v_opportunite;
  end if;

  with actuelles as (
    select promo_id from opportunite_promos_preuves where opportunite_id = v_opportunite.id
  ),
  cible as (
    select unnest(coalesce(p_preuves_promo_ids, array[]::uuid[])) as promo_id
  ),
  ajouts as (select promo_id from cible except select promo_id from actuelles),
  retraits as (select promo_id from actuelles except select promo_id from cible)
  insert into opportunite_evenements (opportunite_id, type, visite_id, raisons)
  select v_opportunite.id, 'preuve_ajoutee', p_visite_id, jsonb_build_object('promo_id', promo_id) from ajouts
  union all
  select v_opportunite.id, 'preuve_retiree', p_visite_id, jsonb_build_object('promo_id', promo_id) from retraits;

  delete from opportunite_promos_preuves
  where opportunite_id = v_opportunite.id
    and promo_id != all(coalesce(p_preuves_promo_ids, array[]::uuid[]));

  insert into opportunite_promos_preuves (opportunite_id, promo_id)
  select v_opportunite.id, unnest(coalesce(p_preuves_promo_ids, array[]::uuid[]))
  on conflict (opportunite_id, promo_id) do nothing;

  return v_opportunite;
end;
$$ language plpgsql security definer set search_path = public;
```

- [ ] **Step 2: Appliquer la migration**

Utiliser `apply_migration` (project_id `yymriulkcytkbuenorvm`, name `rattacher_opportunite`).

- [ ] **Step 3: Vérifier avec un appel manuel**

```sql
select (rattacher_opportunite(
  (select id from magasins limit 1),
  (select id from produits limit 1),
  'referencer_produit', null, 'P2', 60, 'recommandation_probable',
  '{"version":1,"raisons":[]}'::jsonb, 'test-fingerprint-1', '1', true, array[]::uuid[], null
)).*;
-- expect une ligne avec statut = 'detectee', cycle = 1
select count(*) from opportunite_evenements where type = 'creation';
-- expect 1

-- Rejouer avec le même fingerprint : ne doit rien insérer dans le journal
select (rattacher_opportunite(
  (select id from magasins limit 1),
  (select id from produits limit 1),
  'referencer_produit', null, 'P2', 60, 'recommandation_probable',
  '{"version":1,"raisons":[]}'::jsonb, 'test-fingerprint-1', '1', true, array[]::uuid[], null
)).*;
select count(*) from opportunite_evenements; -- expect toujours 1

-- Nettoyage de la ligne de test
delete from opportunites where fingerprint = 'test-fingerprint-1';
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0013_rattacher_opportunite.sql
git commit -m "feat: fonction Postgres transactionnelle rattacher_opportunite"
```

---

### Task 14: Orchestrateur TypeScript `rattacherOpportunite`

**Files:**
- Create: `lib/engine/rattachement.ts`
- Test: `lib/engine/rattachement.test.ts`

**Interfaces:**
- Consumes: `typesExclus` (Task 7), `detecterSignaux` (Task 8), `classifierNiveau` (Task 9), `calculerScoreOpportunite` (Task 10), `determinerConfiance` (Task 11), `calculerFingerprint` (Task 12), RPC `rattacher_opportunite` (Task 13).
- Produces: `estDeclencheurReel(signaux, opportuniteExistante): boolean`, `rattacherOpportunite(admin, ctx, config, visiteId?): Promise<{ opportunite: Opportunite; opportuniteVerification: Opportunite | null } | null>` — consommé par le câblage des déclencheurs (Task 15) et le recalcul planifié (Task 16).

- [ ] **Step 1: Écrire le test de `estDeclencheurReel`**

```ts
// lib/engine/rattachement.test.ts
import { describe, expect, it, vi } from 'vitest'
import { estDeclencheurReel, rattacherOpportunite } from './rattachement'
import { CONFIG_MOTEUR_DEFAUT } from './config-moteur'
import type { SignalDetecte } from './signal'
import type { Opportunite, Magasin, Produit } from '@/lib/types'

function signal(overrides: Partial<SignalDetecte>): SignalDetecte {
  return {
    typeMission: 'referencer_produit', promoId: null, niveauDeclenche: 'P2',
    codeSignal: 'x', sourceType: 'vmh', sourceId: 's1',
    observedAt: '2026-08-19T00:00:00.000Z', expiresAt: null, force: 10,
    donneesArgumentaire: {}, ...overrides,
  }
}

describe('estDeclencheurReel', () => {
  it('un signal VMH/comparable/Top seul n\'est jamais un déclencheur réel', () => {
    expect(estDeclencheurReel([signal({ sourceType: 'vmh' }), signal({ sourceType: 'comparable' }), signal({ sourceType: 'top' })], null)).toBe(false)
  })

  it('une promo entrant dans sa fenêtre d\'action est un déclencheur réel', () => {
    expect(estDeclencheurReel([signal({ sourceType: 'promo', codeSignal: 'promo_a_revendre' })], null)).toBe(true)
  })

  it('une rupture nouvellement observée est un déclencheur réel', () => {
    expect(estDeclencheurReel([signal({ sourceType: 'historique_rupture' })], null)).toBe(true)
  })

  it('un engagement échu est un déclencheur réel', () => {
    expect(estDeclencheurReel([signal({ sourceType: 'engagement' })], null)).toBe(true)
  })

  it('aucune opportunité existante = toujours un déclencheur réel (création)', () => {
    expect(estDeclencheurReel([], null)).toBe(true)
  })
})

describe('rattacherOpportunite', () => {
  it('appelle le RPC avec les champs calculés et retourne le résultat', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'o1', statut: 'detectee' }, error: null })
    const admin = { rpc } as unknown as Parameters<typeof rattacherOpportunite>[0]
    const magasin: Magasin = { id: 'm1', code: 'M1', nom: 'T', enseigne: 'Carrefour', taille: 'hyper', adresse: null, secteur_id: 's1', contact_nom: null, contact_telephone: null, contact_email: null, surface: null }
    const produit: Produit = { id: 'p1', code: 'E1', nom: 'P', categorie: null, produit_canonique_id: null, famille: null, segment: null, statut_catalogue: 'permanent', type_liaison: null }

    const resultat = await rattacherOpportunite(admin, {
      magasin, produit, statutProduitMagasin: 'manquant', promosApplicables: [], opportunitesExistantes: [],
      rangTop: null, historiqueRuptures: [], aujourdHui: new Date('2026-08-19'),
      statutDisponibilite: 'commandable',
    }, CONFIG_MOTEUR_DEFAUT, null)

    expect(resultat).toBeNull() // aucun signal détecté sans promo ni rupture -> pas de rattachement
    expect(rpc).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/rattachement.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```ts
// lib/engine/rattachement.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Opportunite, StatutDisponibilite } from '@/lib/types'
import { detecterSignaux, type ContexteDetection } from './detecteurs'
import { typesExclus } from './exclusion'
import { classifierNiveau } from './classification'
import { calculerScoreOpportunite } from './scoring'
import { determinerConfiance } from './confiance'
import { calculerFingerprint } from './fingerprint'
import { RaisonsActuellesSchema, type RaisonsActuelles } from './raison'
import { stadePromo } from './stade-promo'
import type { ConfigMoteur } from './config-moteur'

// Sources qui, seules, ne justifient jamais une réouverture après refus
// (spec §5) — un changement de score/VMH/comparables/Top n'est jamais un
// déclencheur réel à lui seul.
const SOURCES_JAMAIS_SEULES_DECLENCHEUR: Array<import('./signal').SourceSignal> = ['vmh', 'comparable', 'top']

export function estDeclencheurReel(signaux: import('./signal').SignalDetecte[], opportuniteExistante: Opportunite | null): boolean {
  if (!opportuniteExistante) return true
  return signaux.some(s => !SOURCES_JAMAIS_SEULES_DECLENCHEUR.includes(s.sourceType))
}

export type ContexteRattachement = ContexteDetection & { statutDisponibilite: StatutDisponibilite }

export interface ResultatRattachement {
  opportunite: Opportunite
  opportuniteVerification: Opportunite | null
}

export async function rattacherOpportunite(
  admin: SupabaseClient,
  ctx: ContexteRattachement,
  config: ConfigMoteur,
  visiteId: string | null = null
): Promise<ResultatRattachement | null> {
  const signaux = detecterSignaux(ctx, config)
  if (signaux.length === 0) return null

  const promoPrincipale = ctx.promosApplicables[0]
  const exclus = typesExclus({
    statutDisponibilite: ctx.statutDisponibilite,
    statutCatalogue: ctx.produit.statut_catalogue,
    statutProduitMagasin: ctx.statutProduitMagasin,
    promoStade: promoPrincipale ? stadePromo(promoPrincipale, ctx.aujourdHui) : null,
    constaterDejaActionne: ctx.opportunitesExistantes.some(o => o.type_mission === 'constater_promo' && o.statut === 'reussie'),
  })

  const signauxRetenus = signaux.filter(s => !exclus.has(s.typeMission))
  if (signauxRetenus.length === 0) return null

  const signalPrincipal = signauxRetenus.reduce((a, b) => (b.force > a.force ? b : a))
  const preuvesPromoIds = [...new Set(
    signauxRetenus
      .filter(s => s !== signalPrincipal && s.sourceType === 'promo' && s.sourceId !== signalPrincipal.promoId)
      .map(s => s.sourceId)
  )]

  const classification = classifierNiveau(signauxRetenus)
  if (!classification) return null

  const opportuniteExistante = ctx.opportunitesExistantes.find(
    o => o.type_mission === signalPrincipal.typeMission && o.promo_id === signalPrincipal.promoId
  ) ?? null
  const declencheurReel = estDeclencheurReel(signauxRetenus, opportuniteExistante)

  const penalite = opportuniteExistante?.statut === 'refusee' && declencheurReel ? config.penaliteReouvertureApresRefus : 0
  const accordDejaObtenu = opportuniteExistante?.statut === 'accord_obtenu' || opportuniteExistante?.statut === 'commandee'
  const score = calculerScoreOpportunite(signauxRetenus, { rangTop: ctx.rangTop, accordDejaObtenu }, penalite, config)
  const { confiance, contradiction } = determinerConfiance(signauxRetenus)

  const raisons: RaisonsActuelles = {
    version: 1,
    raisons: signauxRetenus.map(s => ({
      version: 1, codeSignal: s.codeSignal, source: { type: s.sourceType, id: s.sourceId },
      observedAt: s.observedAt, fraicheur: 'fraiche', contributionScore: s.force,
      niveauDeclenche: s.niveauDeclenche, texteCommercial: s.codeSignal,
    })),
  }
  RaisonsActuellesSchema.parse(raisons)

  const fingerprint = calculerFingerprint({
    niveauPriorite: classification.niveau, score, confiance: contradiction ? 'information_a_verifier' : confiance,
    raisons, statut: opportuniteExistante?.statut ?? 'detectee',
  })

  const { data, error } = await admin.rpc('rattacher_opportunite', {
    p_magasin_id: ctx.magasin.id,
    p_produit_canonique_id: ctx.produit.id,
    p_type_mission: signalPrincipal.typeMission,
    p_promo_id: signalPrincipal.promoId,
    p_niveau_priorite: classification.niveau,
    p_score: score,
    p_confiance: contradiction ? 'information_a_verifier' : confiance,
    p_raisons: raisons,
    p_fingerprint: fingerprint,
    p_version_moteur: config.version,
    p_declencheur_reel: declencheurReel,
    p_preuves_promo_ids: preuvesPromoIds,
    p_visite_id: visiteId,
  })
  if (error) throw error

  let opportuniteVerification: Opportunite | null = null
  if (contradiction) {
    const raisonsVerif: RaisonsActuelles = { version: 1, raisons: raisons.raisons }
    const { data: dataVerif, error: errorVerif } = await admin.rpc('rattacher_opportunite', {
      p_magasin_id: ctx.magasin.id,
      p_produit_canonique_id: ctx.produit.id,
      p_type_mission: 'verifier_information',
      p_promo_id: null,
      p_niveau_priorite: classification.niveau,
      p_score: score,
      p_confiance: 'information_a_verifier',
      p_raisons: raisonsVerif,
      p_fingerprint: calculerFingerprint({ niveauPriorite: classification.niveau, score, confiance: 'information_a_verifier', raisons: raisonsVerif, statut: 'detectee' }),
      p_version_moteur: config.version,
      p_declencheur_reel: true,
      p_preuves_promo_ids: [],
      p_visite_id: visiteId,
    })
    if (errorVerif) throw errorVerif
    opportuniteVerification = dataVerif as Opportunite
  }

  return { opportunite: data as Opportunite, opportuniteVerification }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/rattachement.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Vérifier la compilation**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add lib/engine/rattachement.ts lib/engine/rattachement.test.ts
git commit -m "feat: orchestrateur du pipeline — rattacherOpportunite"
```

---

### Task 15: Câblage du déclencheur synchrone — relevé de statut

**Files:**
- Modify: `lib/statuts/actions.ts`
- Create: `lib/engine/executer-pipeline.ts`
- Test: `lib/engine/executer-pipeline.test.ts`

**Décision de portée** : seul `updateStatutProduit` est câblé de façon synchrone dans ce sous-projet — un relevé de statut touche exactement un `(magasin, produit)`, donc c'est bon marché. `importPromos`, `confirmerImportPlanDeVente` et `definirAssortiment` touchent potentiellement des dizaines de magasins d'une même enseigne en un seul appel (import ou modification d'assortiment enseigne-large) ; les y câbler de façon synchrone ralentirait ces actions admin de façon disproportionnée. Ces trois déclencheurs (spec §12.5, lignes « import/modification promo » et « changement d'assortiment ») sont couverts par le filet de sécurité périodique du Task 16, pas ici — décision documentée plutôt que silencieusement omise.

**Interfaces:**
- Consumes: `rattacherOpportunite` (Task 14), `moteurActif` (Task 3).
- Produces: `executerPipelinePourProduit(admin, magasinId, produitCanoniqueId, visiteId?): Promise<void>` — appelé depuis les Server Actions modifiées.

- [ ] **Step 1: Écrire le test de la fonction d'exécution**

```ts
// lib/engine/executer-pipeline.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('./config-moteur', () => ({ moteurActif: () => false, CONFIG_MOTEUR_DEFAUT: {} }))

import { executerPipelinePourProduit } from './executer-pipeline'

describe('executerPipelinePourProduit', () => {
  it('ne fait rien quand le moteur est désactivé (shadow mode off)', async () => {
    const admin = { from: vi.fn(), rpc: vi.fn() } as unknown as Parameters<typeof executerPipelinePourProduit>[0]
    await executerPipelinePourProduit(admin, 'm1', 'p1')
    expect(admin.from).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/executer-pipeline.test.ts`
Expected: FAIL — module introuvable.

- [ ] **Step 3: Implémenter**

```ts
// lib/engine/executer-pipeline.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import { moteurActif, CONFIG_MOTEUR_DEFAUT } from './config-moteur'
import { rattacherOpportunite, type ContexteRattachement } from './rattachement'
import type { Magasin, Produit, StatutProduit } from '@/lib/types'

// Point d'entrée unique appelé par les Server Actions qui modifient statuts,
// promos ou assortiment (spec §12.5). Best-effort et silencieux en shadow
// mode : une erreur du moteur ne doit jamais faire échouer l'action métier
// qui l'a déclenché.
export async function executerPipelinePourProduit(
  admin: SupabaseClient,
  magasinId: string,
  produitCanoniqueId: string,
  visiteId: string | null = null
): Promise<void> {
  if (!moteurActif()) return

  try {
    const [{ data: magasin }, { data: produit }, { data: statuts }, { data: produitsEnseigne }, { data: promoLiens }, { data: opportunites }, { data: priorite }, { data: historique }] = await Promise.all([
      admin.from('magasins').select('*').eq('id', magasinId).single(),
      admin.from('produits').select('*').eq('id', produitCanoniqueId).single(),
      admin.from('statuts_produit_magasin').select('*').eq('magasin_id', magasinId).eq('produit_id', produitCanoniqueId).maybeSingle(),
      admin.from('produits_enseigne').select('*').eq('produit_id', produitCanoniqueId),
      admin.from('promo_produits').select('promo_id, promos(*)').eq('produit_id', produitCanoniqueId),
      admin.from('opportunites').select('*').eq('magasin_id', magasinId).eq('produit_canonique_id', produitCanoniqueId),
      admin.from('priorites_produits').select('rang').eq('produit_id', produitCanoniqueId).maybeSingle(),
      admin.from('statuts_produit_magasin_historique').select('*').eq('magasin_id', magasinId).eq('produit_id', produitCanoniqueId),
    ])
    if (!magasin || !produit) return

    const produitEnseigne = (produitsEnseigne ?? []).find((pe: { enseigne: string }) => pe.enseigne === magasin.enseigne)
    const promosApplicables = (promoLiens ?? [])
      .map((l: { promos: unknown }) => l.promos)
      .filter((p: { enseigne: string } | null): p is { enseigne: string } => Boolean(p) && p!.enseigne === magasin.enseigne)

    const ctx: ContexteRattachement = {
      magasin: magasin as Magasin,
      produit: produit as Produit,
      statutProduitMagasin: (statuts?.statut as StatutProduit) ?? 'present',
      promosApplicables: promosApplicables as ContexteRattachement['promosApplicables'],
      opportunitesExistantes: (opportunites ?? []) as ContexteRattachement['opportunitesExistantes'],
      rangTop: (priorite?.rang as 20 | 50 | 70 | undefined) ?? null,
      historiqueRuptures: (historique ?? []) as ContexteRattachement['historiqueRuptures'],
      aujourdHui: new Date(),
      statutDisponibilite: produitEnseigne?.statut_disponibilite ?? 'commandable',
    }

    await rattacherOpportunite(admin, ctx, CONFIG_MOTEUR_DEFAUT, visiteId)
  } catch (err) {
    // Shadow mode : le moteur ne doit jamais casser l'action métier qui l'a
    // déclenché. Erreur avalée volontairement, pas de retry ici.
    console.error('executerPipelinePourProduit a échoué', err)
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/executer-pipeline.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Câbler dans `updateStatutProduit`**

Dans `lib/statuts/actions.ts`, après l'écriture de l'historique (Task 5), ajouter :

```ts
import { createAdminClient } from '@/lib/supabase/admin'
import { executerPipelinePourProduit } from '@/lib/engine/executer-pipeline'

// ... à la fin de updateStatutProduit, avant revalidatePath :
await executerPipelinePourProduit(createAdminClient(), magasinId, idEffectif, visiteId)
```

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: tous les tests passent, y compris les tests existants non liés à ce plan.

- [ ] **Step 7: Commit**

```bash
git add lib/statuts/actions.ts lib/engine/executer-pipeline.ts lib/engine/executer-pipeline.test.ts
git commit -m "feat: câble le pipeline sur le relevé de statut (déclencheur synchrone)"
```

---

### Task 16: Recalcul planifié + échéances

**Files:**
- Create: `app/api/moteur/recalculer/route.ts`
- Test: `app/api/moteur/recalculer/route.test.ts`

**Interfaces:**
- Consumes: `executerPipelinePourProduit` (Task 15), `moteurActif` (Task 3).
- Produces: `GET /api/moteur/recalculer` — point d'entrée protégé pour un déclenchement externe planifié (spec §12.5, engagements échus + filet de sécurité périodique).

- [ ] **Step 1: Écrire le test**

```ts
// app/api/moteur/recalculer/route.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ select: () => Promise.resolve({ data: [] }) }) }) }))
vi.mock('@/lib/engine/executer-pipeline', () => ({ executerPipelinePourProduit: vi.fn() }))

import { GET } from './route'

describe('GET /api/moteur/recalculer', () => {
  it('rejette une requête sans le secret attendu', async () => {
    const req = new Request('http://localhost/api/moteur/recalculer')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('accepte une requête avec le bon secret', async () => {
    process.env.MOTEUR_RECALCUL_SECRET = 'test-secret'
    const req = new Request('http://localhost/api/moteur/recalculer', { headers: { authorization: 'Bearer test-secret' } })
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/moteur/recalculer/route.test.ts`
Expected: FAIL — route introuvable.

- [ ] **Step 3: Implémenter**

```ts
// app/api/moteur/recalculer/route.ts
import { createAdminClient } from '@/lib/supabase/admin'
import { executerPipelinePourProduit } from '@/lib/engine/executer-pipeline'
import { resoudreCanonique } from '@/lib/engine/priorites'
import type { Produit } from '@/lib/types'

// Point d'entrée pour un déclenchement externe planifié (spec §12.5) : couvre
// les engagements arrivés à échéance, les transitions de fenêtre promo, et
// le rattrapage import/modification promo + changement d'assortiment
// délibérément non câblés en synchrone (Task 15). Protégé par un secret
// partagé — aucun mécanisme de tâche planifiée n'existe encore dans ce
// projet ; le déclenchement (cron externe, Vercel Cron, ou appel manuel
// admin) reste une décision d'infrastructure hors code, à câbler séparément.
// Le fingerprint (Task 13) rend un balayage large sans danger : toute paire
// inchangée n'écrit rien.
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.MOTEUR_RECALCUL_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const aujourdHui = new Date().toISOString().slice(0, 10)
  const paires = new Set<string>()

  // Opportunités déjà connues, encore ouvertes.
  const { data: ouvertes } = await admin
    .from('opportunites')
    .select('magasin_id, produit_canonique_id')
    .not('statut', 'in', '(reussie,abandonnee)')
  for (const o of ouvertes ?? []) paires.add(`${o.magasin_id}:${o.produit_canonique_id}`)

  // Promos pas encore terminées, résolues au produit canonique — capte les
  // missions promo/référencement pas encore suivies (produit encore
  // "present", donc updateStatutProduit ne s'est jamais déclenché).
  const { data: produits } = await admin.from('produits').select('*')
  const produitsParId = new Map(((produits ?? []) as Produit[]).map(p => [p.id, p]))
  const { data: magasins } = await admin.from('magasins').select('id, enseigne')
  const { data: promoLiens } = await admin.from('promo_produits').select('produit_id, promos(enseigne, date_fin_vente, revente_fin)')

  for (const lien of (promoLiens ?? []) as Array<{ produit_id: string; promos: { enseigne: string; date_fin_vente: string | null; revente_fin: string | null } | null }>) {
    if (!lien.promos) continue
    const fin = lien.promos.date_fin_vente ?? lien.promos.revente_fin
    if (fin && fin < aujourdHui) continue
    const canoniqueId = resoudreCanonique(lien.produit_id, produitsParId)
    for (const m of (magasins ?? []) as Array<{ id: string; enseigne: string }>) {
      if (m.enseigne === lien.promos.enseigne) paires.add(`${m.id}:${canoniqueId}`)
    }
  }

  for (const paire of paires) {
    const [magasinId, produitId] = paire.split(':')
    await executerPipelinePourProduit(admin, magasinId, produitId)
  }

  return Response.json({ traite: paires.size })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/moteur/recalculer/route.test.ts`
Expected: PASS (2 tests) — ces 2 tests couvrent uniquement la porte d'authentification ; la logique de sélection des paires (opportunités ouvertes + promos non terminées résolues au canonique) est vérifiée contre des données réelles au Task 18, pas mockée ici (4 tables jointes en mémoire, mock fragile pour peu de valeur ajoutée).

- [ ] **Step 5: Commit**

```bash
git add app/api/moteur/recalculer/route.ts app/api/moteur/recalculer/route.test.ts
git commit -m "feat: point d'entrée de recalcul planifié pour les engagements échus"
```

---

### Task 17: Vue de comparaison shadow mode

**Files:**
- Create: `supabase/migrations/0014_vue_comparaison_priorites.sql`

**Interfaces:**
- Consumes: `opportunites` (Task 1), `prioritesSemaine`/`chargerProduitsATravailler` (existants — comparaison manuelle, pas une jointure SQL directe puisque ces fonctions sont TypeScript).

- [ ] **Step 1: Écrire la migration**

```sql
-- supabase/migrations/0014_vue_comparaison_priorites.sql
-- Lecture seule, admin uniquement — permet de rapprocher, par magasin, la
-- sortie du nouveau moteur des opportunités existantes avant toute
-- activation d'écran (spec §12.6). Ne remplace aucune requête existante.
create view vue_opportunites_actives as
select
  o.id, o.magasin_id, m.nom as magasin_nom, m.enseigne,
  o.produit_canonique_id, p.nom as produit_nom, p.code as produit_code,
  o.type_mission, o.promo_id, o.statut, o.niveau_priorite, o.score, o.confiance,
  o.score_calcule_at, o.cycle
from opportunites o
join magasins m on m.id = o.magasin_id
join produits p on p.id = o.produit_canonique_id
where o.niveau_priorite is not null
  and o.statut not in ('reussie', 'abandonnee');

alter view vue_opportunites_actives owner to postgres;
grant select on vue_opportunites_actives to authenticated;
```

RLS : les vues Postgres héritent des policies de leurs tables sous-jacentes par défaut avec `security_invoker` — vérifier que `opportunites_select_visible` (Task 1) s'applique bien à la vue avant de l'exposer aux commerciaux ; sinon restreindre l'accès à `admin` uniquement via une policy dédiée dans une itération suivante. Pour ce sous-projet, la vue est un outil de comparaison utilisé par requête SQL directe (Supabase Studio / MCP), pas exposée dans l'app.

- [ ] **Step 2: Appliquer la migration**

Utiliser `apply_migration` (project_id `yymriulkcytkbuenorvm`, name `vue_comparaison_priorites`).

- [ ] **Step 3: Vérifier**

```sql
select * from vue_opportunites_actives limit 5;
-- expect : ne lève pas d'erreur, retourne 0+ lignes selon l'état du moteur à ce stade
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0014_vue_comparaison_priorites.sql
git commit -m "feat: vue de comparaison shadow mode pour les opportunités actives"
```

---

### Task 18: Vérification complète

**Files:** aucun nouveau fichier — vérification uniquement.

- [ ] **Step 1: Type-check complet**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 2: Suite de tests complète**

Run: `npx vitest run`
Expected: tous les tests passent (existants + tous ceux ajoutés par ce plan).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succès, aucune régression sur les routes existantes.

- [ ] **Step 4: Vérification en base — les 10 scénarios d'acceptation (spec §12.8)**

Écrire et exécuter un script de vérification manuelle (non committé) appelant `rattacherOpportunite` avec des données synthétiques couvrant les 10 scénarios de la spec §12.8, en réutilisant le pattern de script autonome déjà établi dans ce projet (lecture directe de `.env.local`, import des fonctions pures, client admin `@supabase/supabase-js`). Vérifier pour chacun :

1. Produit absent + promo future → `referencer_produit` créée, promo en preuve (`opportunite_promos_preuves`).
2. Revente A + promo B future → `promo_id = A`, B en preuve, jamais confondus.
3. Deux relevés rupture même visite → une seule ligne dans `statuts_produit_magasin_historique`.
4. Deux ruptures deux visites en 60j → récurrence détectée.
5. Refus <30j sans preuve → aucune écriture.
6. Refus <30j + promo dans sa fenêtre → réouverture, `cycle = 2`, score pénalisé, niveau inchangé.
7. Pénalité change le score dans P1 sans jamais produire P2.
8. Deux exécutions identiques → aucun nouvel événement.
9. Contradiction → `verifier_information` séparée créée.
10. Produit présent → `referencer_produit` exclu, `revendre_promo` etc. toujours possibles.

- [ ] **Step 5: Nettoyage**

Supprimer toute donnée de test créée à l'étape 4 (`delete from opportunites where magasin_id = '<id de test>'` en cascade sur les tables liées).

- [ ] **Step 6: Rapport final**

Résumer dans le dernier message de la boucle d'implémentation : nombre de tests, résultat des 10 scénarios, tout écart trouvé entre la spec et l'implémentation réelle.
