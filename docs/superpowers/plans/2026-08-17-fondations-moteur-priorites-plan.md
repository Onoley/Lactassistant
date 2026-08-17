# Fondations du moteur — priorité hebdomadaire vs importance produit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the engine's single additive score into two independently-testable concerns — a dated/urgent **weekly priority** (`prioritesSemaine`) and a rank/comparable-based **fiche-magasin importance** (`importanceProduitFiche`) — and add a hard `statut_disponibilite` gate so non-commandable products can never be recommended for an order.

**Architecture:** Three new pure functions in `lib/engine/` (`stadePromo`, `actionRecommandee`, and the rewritten `prioritesSemaine`), one renamed pure function (`genererArguments` → `importanceProduitFiche`), a one-column schema migration, and mechanical (rename-only) wiring of the four call sites that currently use the old functions. No new pages or UI beyond a small admin selector.

**Tech Stack:** Next.js App Router (Server Components/Actions), Supabase (Postgres), TypeScript, Vitest.

**Spec:** [docs/superpowers/specs/2026-08-17-fondations-moteur-priorites-design.md](../specs/2026-08-17-fondations-moteur-priorites-design.md)

## Global Constraints

- `statut_disponibilite` lives on `produits_enseigne` only (per-enseigne, including "arrêt industriel") — never a global column on `produits`.
- `calculerPrioritesMagasins` is deleted outright — no backward-compatibility wrapper.
- `actionRecommandee` must return `'aucune_action_commande'` for **every** combination of stade/statut when `statutDisponibilite` is `'non_commandable'` or `'arret_industriel'` — this is a hard invariant, tested exhaustively.
- An OP Trade promo triggers a `prioritesSemaine` entry regardless of `statutProduitMagasin` (present included), niveau always `'urgent'`.
- A high rang (Top20/50/70) or strong presence at comparable stores must **never**, by itself, produce a `prioritesSemaine` entry — `prioritesSemaine` doesn't even receive rang or comparable-store data as input.
- No new UI beyond the `/admin/produits` `statut_disponibilite` selector required by spec §3. `app/semaine/page.tsx`, `app/equipe/page.tsx`, and the fiche magasin page get minimal, mechanical rendering updates only.
- Out of scope (do not touch): fiche magasin enrichie / argumentaire complet, visite→synthèse page, `surface` field on magasins, VMH import. These are sub-projects 2–5.

## File Structure

- `supabase/migrations/0004_statut_disponibilite.sql` — new migration: adds `produits_enseigne.statut_disponibilite`.
- `lib/types.ts` — modified: adds `StatutDisponibilite`, extends `ProduitEnseigne`.
- `lib/engine/stade-promo.ts` — new: `StadePromo` type + `stadePromo()`, derives promo lifecycle stage from dates.
- `lib/engine/stade-promo.test.ts` — new.
- `lib/engine/action-recommandee.ts` — new: `ActionRecommandee` type + `actionRecommandee()`, the hard non-commandable gate.
- `lib/engine/action-recommandee.test.ts` — new.
- `lib/engine/priorites.ts` — rewritten: replaces `calculerPrioritesMagasins`/`PrioriteMagasin` with `prioritesSemaine`/`PrioriteHebdo`/`NiveauPriorite`.
- `lib/engine/priorites.test.ts` — rewritten.
- `lib/engine/importance-produit.ts` — new (replaces `lib/engine/arguments.ts`): `ImportanceProduit` + `importanceProduitFiche()`, same scoring rules as the old `genererArguments`, new return shape.
- `lib/engine/importance-produit.test.ts` — new (replaces `lib/engine/arguments.test.ts`).
- `lib/engine/arguments.ts`, `lib/engine/arguments.test.ts` — deleted.
- `lib/engine/priorite-vs-importance.test.ts` — new: the cross-cutting regression test proving the two concerns stay separate (the user's explicit ask).
- `lib/engine/fiche-magasin.ts` — modified: calls `importanceProduitFiche`, `LigneProduitAvecArguments` renamed to `LigneProduitImportance` with a `raisons: string[]` field.
- `app/magasins/[id]/page.tsx` — modified: renamed local variables, renders `.raisons` instead of `.arguments[].message`.
- `app/semaine/page.tsx` — modified: calls `prioritesSemaine`, renders `niveau`/`raison`/`produit` instead of `score`/`raisons`.
- `app/equipe/page.tsx` — modified: same change as above, table gains a "Produit" column.
- `lib/produits/actions.ts` — modified: adds `definirStatutDisponibilite()`.
- `app/admin/produits/produits-table.tsx` — modified: builds and passes a per-produit statut map.
- `app/admin/produits/produit-row.tsx` — modified: renders a `statut_disponibilite` `<select>` next to each checked enseigne checkbox.

---

### Task 1: Schema migration + types for `statut_disponibilite`

**Files:**
- Create: `supabase/migrations/0004_statut_disponibilite.sql`
- Modify: `lib/types.ts:44-48`

**Interfaces:**
- Produces: `StatutDisponibilite` type (`'commandable' | 'non_commandable' | 'arret_industriel' | 'en_attente_referencement'`), `ProduitEnseigne.statut_disponibilite: StatutDisponibilite`. Every later task that touches `ProduitEnseigne` relies on this field existing.

- [ ] **Step 1: Write the migration file**

```sql
-- Statut de disponibilité par enseigne : verrouille toute action de commande
-- tant qu'un produit n'est pas réellement commandable dans cette enseigne
-- (déréférencé, arrêt industriel, ou en attente de référencement).
alter table produits_enseigne
  add column statut_disponibilite text not null default 'commandable'
  check (statut_disponibilite in ('commandable', 'non_commandable', 'arret_industriel', 'en_attente_referencement'));
```

Save this as `supabase/migrations/0004_statut_disponibilite.sql`.

- [ ] **Step 2: Apply the migration to the live Supabase project**

Apply the SQL above against the project's database (via the Supabase MCP tools available in this workspace, or `supabase db push` if the CLI is linked). Use the exact SQL from Step 1.

- [ ] **Step 3: Verify the column exists**

Run this query against the database (via the same tool used in Step 2):

```sql
select column_name, data_type, column_default, is_nullable
from information_schema.columns
where table_name = 'produits_enseigne' and column_name = 'statut_disponibilite';
```

Expected: one row, `data_type = text`, `column_default` containing `'commandable'::text`, `is_nullable = NO`.

- [ ] **Step 4: Extend the TypeScript types**

In `lib/types.ts`, replace:

```ts
export interface ProduitEnseigne {
  produit_id: string
  enseigne: string
  typologie: string | null
}
```

with:

```ts
export type StatutDisponibilite = 'commandable' | 'non_commandable' | 'arret_industriel' | 'en_attente_referencement'

export interface ProduitEnseigne {
  produit_id: string
  enseigne: string
  typologie: string | null
  statut_disponibilite: StatutDisponibilite
}
```

- [ ] **Step 5: Verify the project still typechecks**

Run: `npx tsc --noEmit`
Expected: no errors (the Supabase client isn't generically typed against a `Database` schema, so no other call site is statically bound to the old `ProduitEnseigne` shape).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0004_statut_disponibilite.sql lib/types.ts
git commit -m "feat: add statut_disponibilite to produits_enseigne"
```

---

### Task 2: `stadePromo` — promo lifecycle stage from dates

**Files:**
- Create: `lib/engine/stade-promo.ts`
- Test: `lib/engine/stade-promo.test.ts`

**Interfaces:**
- Consumes: `Promo` (`lib/types.ts`) — uses `date_installation`, `date_debut_vente`, `date_fin_vente`.
- Produces: `type StadePromo = 'anticiper' | 'revendre' | 'controler' | 'constater'` and `stadePromo(promo: Promo, aujourdHui?: Date): StadePromo`. Consumed by Task 3, Task 4, Task 5.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { stadePromo } from './stade-promo'
import type { Promo } from '@/lib/types'

function promo(overrides: Partial<Promo> = {}): Promo {
  return {
    id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%',
    date_installation: '2026-09-01', date_debut_vente: '2026-09-10', date_constat: null,
    date_fin_vente: '2026-09-20',
    ...overrides,
  }
}

describe('stadePromo', () => {
  it("anticiper avant la date d'installation connue", () => {
    expect(stadePromo(promo(), new Date('2026-08-20'))).toBe('anticiper')
  })

  it("revendre entre l'installation et le début de vente", () => {
    expect(stadePromo(promo(), new Date('2026-09-05'))).toBe('revendre')
  })

  it('controler entre le début et la fin de vente', () => {
    expect(stadePromo(promo(), new Date('2026-09-15'))).toBe('controler')
  })

  it('constater après la fin de vente', () => {
    expect(stadePromo(promo(), new Date('2026-09-25'))).toBe('constater')
  })

  it('controler indéfiniment si date_fin_vente est inconnue', () => {
    const promoSansFin = promo({ date_fin_vente: null })
    expect(stadePromo(promoSansFin, new Date('2027-01-01'))).toBe('controler')
  })

  it('replie sur 21 jours avant date_debut_vente quand date_installation est inconnue', () => {
    const promoSansInstallation = promo({ date_installation: null, date_debut_vente: '2026-09-10' })
    // 26 jours avant le début de vente : encore avant le repli (21 jours) → anticiper
    expect(stadePromo(promoSansInstallation, new Date('2026-08-15'))).toBe('anticiper')
    // 16 jours avant le début de vente : après le repli (21 jours) → revendre
    expect(stadePromo(promoSansInstallation, new Date('2026-08-25'))).toBe('revendre')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/stade-promo.test.ts`
Expected: FAIL — `Cannot find module './stade-promo'`

- [ ] **Step 3: Write the implementation**

```ts
import type { Promo } from '@/lib/types'

export type StadePromo = 'anticiper' | 'revendre' | 'controler' | 'constater'

// ponytail: repli arbitraire (21 jours) quand date_installation est inconnue —
// cohérent avec les seuils déjà utilisés ailleurs dans le moteur, à recalibrer
// avec le retour terrain.
const JOURS_ANTICIPATION_PAR_DEFAUT = 21

export function stadePromo(promo: Promo, aujourdHui: Date = new Date()): StadePromo {
  const debutVente = new Date(promo.date_debut_vente)
  const debutInstallation = promo.date_installation
    ? new Date(promo.date_installation)
    : new Date(debutVente.getTime() - JOURS_ANTICIPATION_PAR_DEFAUT * 86_400_000)
  const finVente = promo.date_fin_vente ? new Date(promo.date_fin_vente) : null

  if (aujourdHui < debutInstallation) return 'anticiper'
  if (aujourdHui < debutVente) return 'revendre'
  if (finVente === null || aujourdHui <= finVente) return 'controler'
  return 'constater'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/engine/stade-promo.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/engine/stade-promo.ts lib/engine/stade-promo.test.ts
git commit -m "feat: add stadePromo lifecycle helper"
```

---

### Task 3: `actionRecommandee` — the non-commandable hard gate

**Files:**
- Create: `lib/engine/action-recommandee.ts`
- Test: `lib/engine/action-recommandee.test.ts`

**Interfaces:**
- Consumes: `StadePromo` (Task 2), `StatutDisponibilite` (Task 1), `StatutProduit` (`lib/types.ts`, already `'present' | 'manquant' | 'rupture'`).
- Produces: `type ActionRecommandee = 'faire_entrer' | 'securiser_commande' | 'preparer_implantation' | 'verifier_participation' | 'tester' | 'preparer_dossier_referencement' | 'aucune_action_commande'` and `actionRecommandee(statutDisponibilite, stadePromo, statutProduitMagasin): ActionRecommandee`. Consumed by Task 4.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { actionRecommandee } from './action-recommandee'
import type { StadePromo } from './stade-promo'
import type { StatutDisponibilite, StatutProduit } from '@/lib/types'

const TOUS_STADES: Array<StadePromo | null> = [null, 'anticiper', 'revendre', 'controler', 'constater']
const TOUS_STATUTS: StatutProduit[] = ['present', 'manquant', 'rupture']

describe('actionRecommandee', () => {
  it('ne recommande jamais de valeur de commande quand le statut est non_commandable ou arret_industriel', () => {
    const statutsVerrouilles: StatutDisponibilite[] = ['non_commandable', 'arret_industriel']
    for (const statutDisponibilite of statutsVerrouilles) {
      for (const stade of TOUS_STADES) {
        for (const statutProduitMagasin of TOUS_STATUTS) {
          expect(actionRecommandee(statutDisponibilite, stade, statutProduitMagasin)).toBe('aucune_action_commande')
        }
      }
    }
  })

  it('recommande toujours de préparer le dossier de référencement quand en_attente_referencement', () => {
    for (const stade of TOUS_STADES) {
      for (const statutProduitMagasin of TOUS_STATUTS) {
        expect(actionRecommandee('en_attente_referencement', stade, statutProduitMagasin)).toBe('preparer_dossier_referencement')
      }
    }
  })

  it('anticiper + manquant → faire_entrer, si commandable', () => {
    expect(actionRecommandee('commandable', 'anticiper', 'manquant')).toBe('faire_entrer')
  })

  it('revendre → securiser_commande, si commandable', () => {
    expect(actionRecommandee('commandable', 'revendre', 'present')).toBe('securiser_commande')
  })

  it('controler → verifier_participation, si commandable', () => {
    expect(actionRecommandee('commandable', 'controler', 'present')).toBe('verifier_participation')
  })

  it('pas de promo mais présent → tester, si commandable', () => {
    expect(actionRecommandee('commandable', null, 'present')).toBe('tester')
  })

  it('constater + toujours manquant → verifier_participation, si commandable', () => {
    expect(actionRecommandee('commandable', 'constater', 'manquant')).toBe('verifier_participation')
  })

  it('constater + present → aucune_action_commande, si commandable (rien à négocier)', () => {
    expect(actionRecommandee('commandable', 'constater', 'present')).toBe('aucune_action_commande')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/action-recommandee.test.ts`
Expected: FAIL — `Cannot find module './action-recommandee'`

- [ ] **Step 3: Write the implementation**

```ts
import type { StadePromo } from './stade-promo'
import type { StatutDisponibilite, StatutProduit } from '@/lib/types'

export type ActionRecommandee =
  | 'faire_entrer'
  | 'securiser_commande'
  | 'preparer_implantation'
  | 'verifier_participation'
  | 'tester'
  | 'preparer_dossier_referencement'
  | 'aucune_action_commande'

export function actionRecommandee(
  statutDisponibilite: StatutDisponibilite,
  stadePromo: StadePromo | null,
  statutProduitMagasin: StatutProduit
): ActionRecommandee {
  if (statutDisponibilite === 'non_commandable' || statutDisponibilite === 'arret_industriel') {
    return 'aucune_action_commande'
  }
  if (statutDisponibilite === 'en_attente_referencement') {
    return 'preparer_dossier_referencement'
  }

  const manque = statutProduitMagasin === 'manquant' || statutProduitMagasin === 'rupture'

  if (stadePromo === 'anticiper') return manque ? 'faire_entrer' : 'preparer_implantation'
  if (stadePromo === 'revendre') return 'securiser_commande'
  if (stadePromo === 'controler') return 'verifier_participation'
  if (stadePromo === 'constater') return manque ? 'verifier_participation' : 'aucune_action_commande'

  return manque ? 'faire_entrer' : 'tester'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/engine/action-recommandee.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/engine/action-recommandee.ts lib/engine/action-recommandee.test.ts
git commit -m "feat: add actionRecommandee non-commandable hard gate"
```

---

### Task 4: `prioritesSemaine` — replaces `calculerPrioritesMagasins`

**Files:**
- Modify: `lib/engine/priorites.ts` (full rewrite)
- Modify: `lib/engine/priorites.test.ts` (full rewrite)

**Interfaces:**
- Consumes: `Magasin`, `Produit`, `ProduitEnseigne`, `Promo`, `StatutProduit`, `StatutProduitMagasin` (`lib/types.ts`); `stadePromo`/`StadePromo` (Task 2); `actionRecommandee`/`ActionRecommandee` (Task 3).
- Produces: `type NiveauPriorite = 'urgent' | 'cette_semaine' | 'a_anticiper'`, `interface PrioriteHebdo { magasin: Magasin; produit: Produit; niveau: NiveauPriorite; raison: string; stadePromo: StadePromo | null; promo: Promo | null; actionRecommandee: ActionRecommandee }`, and:

```ts
function prioritesSemaine(
  magasins: Magasin[],
  statuts: StatutProduitMagasin[],
  produitsParId: Map<string, Produit>,
  produitsEnseigne: ProduitEnseigne[],
  promosParProduitId: Map<string, Promo[]>,
  aujourdHui?: Date
): PrioriteHebdo[]
```

  Consumed by Task 6 (cross-cutting test) and Task 8 (`app/semaine/page.tsx`, `app/equipe/page.tsx`).

  Note: the spec's §4.2 signature shorthand omits `produitsParId` — it's added here because `PrioriteHebdo.produit` needs the full `Produit` object and `raison` text needs `produit.nom`. It also omits any rang/priorité parameter — that's deliberate: a high rang must never by itself produce a weekly entry, so this function receives no rang data at all.

- [ ] **Step 1: Write the failing tests**

Replace the entire content of `lib/engine/priorites.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { prioritesSemaine } from './priorites'
import type { Magasin, Produit, ProduitEnseigne, Promo, StatutProduitMagasin } from '@/lib/types'

function magasin(id: string, overrides: Partial<Magasin> = {}): Magasin {
  return { id, code: id, nom: `Magasin ${id}`, enseigne: 'Carrefour', taille: 'super', adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null, ...overrides }
}

const yaourt: Produit = { id: 'p1', code: 'P1', nom: 'Yaourt', categorie: null }
const fromage: Produit = { id: 'p2', code: 'P2', nom: 'Fromage', categorie: null }
const produitsParId = new Map<string, Produit>([['p1', yaourt], ['p2', fromage]])

function promo(overrides: Partial<Promo> = {}): Promo {
  return { id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%', date_installation: null, date_debut_vente: '2026-08-20', date_constat: null, ...overrides }
}

describe('prioritesSemaine', () => {
  it('ignore un Top 20 sans promo ni rupture (aucune donnée de rang ne lui est même fournie)', () => {
    const mag = magasin('1')
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
    ]
    const result = prioritesSemaine([mag], statuts, produitsParId, [], new Map())
    expect(result).toHaveLength(0)
  })

  it('une rupture sans promo associée apparaît avec un niveau cette_semaine minimum', () => {
    const mag = magasin('1')
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'rupture', signale_par: null, signale_at: '' },
    ]
    const result = prioritesSemaine([mag], statuts, produitsParId, [], new Map(), new Date('2026-08-17'))
    expect(result).toHaveLength(1)
    expect(result[0].niveau).toBe('cette_semaine')
    expect(result[0].raison).toBe('Rupture signalée — aucune promo en cours.')
  })

  it('une promo OP Trade sur un produit manquant déclenche un niveau urgent', () => {
    const mag = magasin('1')
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
    ]
    const promoOpTrade = promo({ op_trade: 'OP LAITIERS', date_installation: '2026-12-01', date_debut_vente: '2026-12-10' })
    const promosParProduitId = new Map<string, Promo[]>([['p1', [promoOpTrade]]])
    const result = prioritesSemaine([mag], statuts, produitsParId, [], promosParProduitId, new Date('2026-08-17'))
    expect(result).toHaveLength(1)
    expect(result[0].niveau).toBe('urgent')
  })

  it('une promo OP Trade sur un produit déjà présent déclenche quand même une entrée, niveau urgent', () => {
    const mag = magasin('1')
    // Aucun statut explicite pour p1 dans ce magasin : implicitement "present".
    const promoOpTrade = promo({ op_trade: 'OP LAITIERS', date_installation: '2026-07-01', date_debut_vente: '2026-07-10', date_fin_vente: '2026-09-30' })
    const promosParProduitId = new Map<string, Promo[]>([['p1', [promoOpTrade]]])
    const result = prioritesSemaine([mag], [], produitsParId, [], promosParProduitId, new Date('2026-08-17'))
    expect(result).toHaveLength(1)
    expect(result[0].niveau).toBe('urgent')
    expect(result[0].stadePromo).toBe('controler')
  })

  it("stade constater : absent si la promo n'est pas OP Trade et que le produit est present", () => {
    const mag = magasin('1')
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'present', signale_par: null, signale_at: '' },
    ]
    const promoTerminee = promo({ date_installation: '2026-06-01', date_debut_vente: '2026-06-10', date_fin_vente: '2026-06-30' })
    const promosParProduitId = new Map<string, Promo[]>([['p1', [promoTerminee]]])
    const result = prioritesSemaine([mag], statuts, produitsParId, [], promosParProduitId, new Date('2026-08-17'))
    expect(result).toHaveLength(0)
  })

  it('stade constater : présent si le produit est toujours manquant, avec le message dédié', () => {
    const mag = magasin('1')
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
    ]
    const promoTerminee = promo({ date_installation: '2026-06-01', date_debut_vente: '2026-06-10', date_fin_vente: '2026-06-30' })
    const promosParProduitId = new Map<string, Promo[]>([['p1', [promoTerminee]]])
    const result = prioritesSemaine([mag], statuts, produitsParId, [], promosParProduitId, new Date('2026-08-17'))
    expect(result).toHaveLength(1)
    expect(result[0].raison).toBe('Promo terminée le 2026-06-30 — produit toujours manquant, à négocier.')
  })

  it("applique le statut_disponibilite de produits_enseigne pour verrouiller l'action recommandée", () => {
    const mag = magasin('1')
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'rupture', signale_par: null, signale_at: '' },
    ]
    const produitsEnseigne: ProduitEnseigne[] = [
      { produit_id: 'p1', enseigne: 'Carrefour', typologie: null, statut_disponibilite: 'arret_industriel' },
    ]
    const result = prioritesSemaine([mag], statuts, produitsParId, produitsEnseigne, new Map(), new Date('2026-08-17'))
    expect(result).toHaveLength(1)
    expect(result[0].actionRecommandee).toBe('aucune_action_commande')
  })

  it('produit une entrée distincte par magasin', () => {
    const magA = magasin('1', { secteur_id: 'a' })
    const magB = magasin('2', { secteur_id: 'b' })
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'rupture', signale_par: null, signale_at: '' },
      { magasin_id: '2', produit_id: 'p2', statut: 'rupture', signale_par: null, signale_at: '' },
    ]
    const result = prioritesSemaine([magA, magB], statuts, produitsParId, [], new Map(), new Date('2026-08-17'))
    expect(result).toHaveLength(2)
    expect(result.map(r => r.magasin.id).sort()).toEqual(['1', '2'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/priorites.test.ts`
Expected: FAIL — `prioritesSemaine is not exported` (the file still exports `calculerPrioritesMagasins`)

- [ ] **Step 3: Write the implementation**

Replace the entire content of `lib/engine/priorites.ts` with:

```ts
import type { Magasin, Produit, ProduitEnseigne, Promo, StatutDisponibilite, StatutProduit, StatutProduitMagasin } from '@/lib/types'
import { actionRecommandee, type ActionRecommandee } from './action-recommandee'
import { stadePromo, type StadePromo } from './stade-promo'

export type NiveauPriorite = 'urgent' | 'cette_semaine' | 'a_anticiper'

export interface PrioriteHebdo {
  magasin: Magasin
  produit: Produit
  niveau: NiveauPriorite
  raison: string
  stadePromo: StadePromo | null
  promo: Promo | null
  actionRecommandee: ActionRecommandee
}

const ORDRE_NIVEAU: Record<NiveauPriorite, number> = { a_anticiper: 1, cette_semaine: 2, urgent: 3 }

function joursAvantEcheance(promo: Promo, aujourdHui: Date): number {
  const jalons = [promo.date_installation, promo.date_debut_vente, promo.date_fin_vente]
    .filter((d): d is string => Boolean(d))
    .map(d => Math.ceil((new Date(d).getTime() - aujourdHui.getTime()) / 86_400_000))
  const futurs = jalons.filter(j => j >= 0)
  // Tous les jalons connus sont passés (stade constater) : traité comme urgent,
  // le produit manque toujours malgré une promo déjà terminée.
  return futurs.length > 0 ? Math.min(...futurs) : 0
}

function niveauDepuisJours(jours: number): NiveauPriorite {
  if (jours <= 7) return 'urgent'
  if (jours <= 14) return 'cette_semaine'
  return 'a_anticiper'
}

function raisonPromo(promo: Promo, stade: StadePromo, jours: number, opTrade: boolean, statutProduitMagasin: StatutProduit): string {
  if (stade === 'constater') {
    const dateFin = promo.date_fin_vente ?? promo.date_debut_vente
    if (opTrade) return `Opération Trade "${promo.mecanique}" terminée le ${dateFin} — à constater (présence, stock, prix).`
    const encoreManquant = statutProduitMagasin === 'manquant' || statutProduitMagasin === 'rupture'
    return encoreManquant
      ? `Promo terminée le ${dateFin} — produit toujours manquant, à négocier.`
      : `Promo terminée le ${dateFin}.`
  }
  const prefixe = opTrade ? 'Promo OP Trade' : 'Promo'
  const jalon = stade === 'anticiper'
    ? `installation le ${promo.date_installation ?? promo.date_debut_vente}`
    : `vente le ${promo.date_debut_vente}`
  const echeance = jours >= 0 ? `dans ${jours} jour(s)` : 'échéance dépassée'
  return `${prefixe} "${promo.mecanique}" chez ${promo.enseigne} : ${jalon}, ${echeance}.`
}

interface Candidat {
  niveau: NiveauPriorite
  jours: number
  promo: Promo | null
  stade: StadePromo | null
  raison: string
}

function candidatsPourProduit(statutProduitMagasin: StatutProduit, promosApplicables: Promo[], aujourdHui: Date): Candidat[] {
  const candidats: Candidat[] = []
  const enRupture = statutProduitMagasin === 'rupture'
  const manquant = statutProduitMagasin === 'manquant' || enRupture

  if (enRupture) {
    candidats.push({
      niveau: 'cette_semaine',
      jours: Infinity,
      promo: null,
      stade: null,
      raison: promosApplicables.length === 0 ? 'Rupture signalée — aucune promo en cours.' : 'Rupture signalée.',
    })
  }

  for (const promo of promosApplicables) {
    const opTrade = Boolean(promo.op_trade)
    // Rupture/manquant + promo classique : déclenche. Promo OP Trade : déclenche
    // toujours, présent compris. Aucune autre combinaison ne déclenche.
    if (!opTrade && !manquant) continue
    const stade = stadePromo(promo, aujourdHui)
    const jours = joursAvantEcheance(promo, aujourdHui)
    const niveau: NiveauPriorite = opTrade ? 'urgent' : niveauDepuisJours(jours)
    candidats.push({ niveau, jours, promo, stade, raison: raisonPromo(promo, stade, jours, opTrade, statutProduitMagasin) })
  }

  return candidats
}

function meilleurCandidat(candidats: Candidat[]): Candidat | null {
  if (candidats.length === 0) return null
  return candidats.reduce((meilleur, c) => {
    if (ORDRE_NIVEAU[c.niveau] > ORDRE_NIVEAU[meilleur.niveau]) return c
    if (ORDRE_NIVEAU[c.niveau] < ORDRE_NIVEAU[meilleur.niveau]) return meilleur
    return c.jours < meilleur.jours ? c : meilleur
  })
}

export function prioritesSemaine(
  magasins: Magasin[],
  statuts: StatutProduitMagasin[],
  produitsParId: Map<string, Produit>,
  produitsEnseigne: ProduitEnseigne[],
  promosParProduitId: Map<string, Promo[]>,
  aujourdHui: Date = new Date()
): PrioriteHebdo[] {
  const statutDispoParProduitEtEnseigne = new Map<string, StatutDisponibilite>()
  for (const pe of produitsEnseigne) {
    statutDispoParProduitEtEnseigne.set(`${pe.produit_id}:${pe.enseigne}`, pe.statut_disponibilite)
  }

  const statutParMagasinEtProduit = new Map<string, Map<string, StatutProduit>>()
  for (const s of statuts) {
    if (!statutParMagasinEtProduit.has(s.magasin_id)) statutParMagasinEtProduit.set(s.magasin_id, new Map())
    statutParMagasinEtProduit.get(s.magasin_id)!.set(s.produit_id, s.statut)
  }

  const resultats: PrioriteHebdo[] = []

  for (const magasin of magasins) {
    const statutsMagasin = statutParMagasinEtProduit.get(magasin.id) ?? new Map<string, StatutProduit>()

    // Produits à évaluer pour ce magasin : ceux avec un statut explicite +
    // ceux avec une promo OP Trade dans l'enseigne du magasin (même sans
    // statut, donc implicitement présents) — une Opé Trade se suit même
    // quand le produit est déjà en rayon.
    const produitIds = new Set<string>(statutsMagasin.keys())
    for (const [produitId, promos] of promosParProduitId) {
      if (promos.some(p => p.enseigne === magasin.enseigne && p.op_trade)) produitIds.add(produitId)
    }

    for (const produitId of produitIds) {
      const produit = produitsParId.get(produitId)
      if (!produit) continue
      const statutProduitMagasin = statutsMagasin.get(produitId) ?? 'present'
      const promosApplicables = (promosParProduitId.get(produitId) ?? []).filter(p => p.enseigne === magasin.enseigne)

      const meilleur = meilleurCandidat(candidatsPourProduit(statutProduitMagasin, promosApplicables, aujourdHui))
      if (!meilleur) continue

      const statutDisponibilite = statutDispoParProduitEtEnseigne.get(`${produitId}:${magasin.enseigne}`) ?? 'commandable'

      resultats.push({
        magasin,
        produit,
        niveau: meilleur.niveau,
        raison: meilleur.raison,
        stadePromo: meilleur.stade,
        promo: meilleur.promo,
        actionRecommandee: actionRecommandee(statutDisponibilite, meilleur.stade, statutProduitMagasin),
      })
    }
  }

  return resultats.sort((a, b) => ORDRE_NIVEAU[b.niveau] - ORDRE_NIVEAU[a.niveau])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/engine/priorites.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/engine/priorites.ts lib/engine/priorites.test.ts
git commit -m "feat: replace calculerPrioritesMagasins with prioritesSemaine"
```

---

### Task 5: `importanceProduitFiche` — renames `genererArguments`

**Files:**
- Create: `lib/engine/importance-produit.ts`
- Create: `lib/engine/importance-produit.test.ts`
- Delete: `lib/engine/arguments.ts`, `lib/engine/arguments.test.ts`

**Interfaces:**
- Consumes: `Magasin`, `Produit`, `Promo`, `StatutProduit` (`lib/types.ts`); `magasinsSimilaires`/`CritereSimilarite` (`lib/engine/similarity.ts`); `SCORE_OP_TRADE`, `scoreMagasinsSimilaires`, `scoreRangProduit`, `scoreUrgencePromoJalons`, `Rang` (`lib/engine/scoring.ts`); `stadePromo`/`StadePromo` (Task 2).
- Produces: `interface ImportanceProduit { score: number; raisons: string[]; presentsChezComparables: { total: number; presents: number }; promo: { promo: Promo; stade: StadePromo } | null }` and:

```ts
function importanceProduitFiche(
  magasin: Magasin,
  produit: Produit,
  rang: Rang,
  magasinsComparables: Magasin[],
  statutsComparables: Map<string, StatutProduit>,
  promosDuProduit: Promo[],
  critere: CritereSimilarite,
  aujourdHui?: Date
): ImportanceProduit
```

  Consumed by Task 6 (cross-cutting test) and Task 7 (`lib/engine/fiche-magasin.ts`).

  Note: this drops the spec §4.3 shorthand's `statut` parameter — the only current caller (`fiche-magasin.ts`) only ever invokes this for products already known to be manquant/rupture, so that parameter would be dead code. `rang` is kept even though the spec's parameter list omitted it, because the scoring logic it feeds (`rang Top70 + magasins comparables + promo`) is explicitly preserved unchanged per spec §4.3.

- [ ] **Step 1: Write the failing tests**

Create `lib/engine/importance-produit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { importanceProduitFiche } from './importance-produit'
import { scoreRangProduit } from './scoring'
import type { Magasin, Produit, Promo, StatutProduit } from '@/lib/types'

function magasin(id: string, overrides: Partial<Magasin> = {}): Magasin {
  return { id, code: id, nom: id, enseigne: 'Carrefour', taille: 'super', adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null, ...overrides }
}

const produit: Produit = { id: 'p1', code: 'P1', nom: 'Yaourt nature', categorie: null }

describe('importanceProduitFiche', () => {
  it('signale les magasins similaires qui ont le produit', () => {
    const cible = magasin('1')
    const tous = [cible, magasin('2'), magasin('3', { enseigne: 'Leclerc' })]
    const statuts = new Map<string, StatutProduit>([['2', 'present']])
    const { raisons, presentsChezComparables } = importanceProduitFiche(cible, produit, 20, tous, statuts, [], 'les_deux')
    expect(raisons.some(r => r.includes('1 magasin(s) similaire(s) sur 1'))).toBe(true)
    expect(presentsChezComparables).toEqual({ total: 1, presents: 1 })
  })

  it('signale les promos et calcule un score', () => {
    const cible = magasin('1')
    const promo: Promo = { id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%', date_installation: '2026-08-18', date_debut_vente: '2026-08-20', date_constat: '2026-08-25' }
    const { raisons, score, promo: promoPrincipale } = importanceProduitFiche(cible, produit, 20, [cible], new Map(), [promo], 'les_deux')
    expect(raisons.some(r => r.includes('Promo'))).toBe(true)
    expect(score).toBeGreaterThan(0)
    expect(promoPrincipale?.promo.id).toBe('pr1')
  })

  it("score basé sur le rang seul en l'absence de promo", () => {
    const cible = magasin('1')
    const { score, promo } = importanceProduitFiche(cible, produit, 20, [cible], new Map(), [], 'les_deux')
    expect(score).toBe(100)
    expect(promo).toBeNull()
  })

  it("ignore les promos d'une autre enseigne", () => {
    const cibleCarrefour = magasin('1', { enseigne: 'Carrefour' })
    const promoLeclerc: Promo = { id: 'pr1', code: 'PR1', enseigne: 'Leclerc', mecanique: '-20%', date_installation: '2026-08-18', date_debut_vente: '2026-08-20', date_constat: '2026-08-25' }
    const { score } = importanceProduitFiche(cibleCarrefour, produit, 20, [cibleCarrefour], new Map(), [promoLeclerc], 'les_deux')
    expect(score).toBe(100)
  })

  it('score élevé si date_constat est imminente même si date_installation est passée', () => {
    const cible = magasin('1', { enseigne: 'Carrefour' })
    const promoWithPastInstButImminentConstat: Promo = {
      id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%',
      date_installation: '2026-08-01', date_debut_vente: '2026-08-05', date_constat: '2026-08-17',
    }
    const { score } = importanceProduitFiche(cible, produit, 20, [cible], new Map(), [promoWithPastInstButImminentConstat], 'les_deux', new Date('2026-08-16'))
    expect(score).toBe(200)
  })

  it('gère une promo sans date_installation ni date_constat connues (import réel incomplet)', () => {
    const cible = magasin('1', { enseigne: 'Carrefour' })
    const promoSansJalonsOptionnels: Promo = {
      id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%',
      date_installation: null, date_debut_vente: '2026-08-20', date_constat: null,
    }
    const { raisons, score } = importanceProduitFiche(cible, produit, 20, [cible], new Map(), [promoSansJalonsOptionnels], 'les_deux', new Date('2026-08-16'))
    expect(raisons[0]).not.toContain('null')
    expect(raisons[0]).toContain('vente le 2026-08-20')
    expect(score).toBe(scoreRangProduit(20) + 100)
  })

  it('le signal magasins comparables contribue aussi au score, pas seulement au message', () => {
    const cible = magasin('1')
    const tous = [cible, magasin('2')]
    const statuts = new Map<string, StatutProduit>([['2', 'present']])
    const { score } = importanceProduitFiche(cible, produit, 70, tous, statuts, [], 'les_deux')
    expect(score).toBeGreaterThan(scoreRangProduit(70))
  })

  it('une promo OP Trade fait dominer le score, même pour un rang faible', () => {
    const cible = magasin('1', { enseigne: 'Carrefour' })
    const promoOpTrade: Promo = {
      id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%',
      date_installation: null, date_debut_vente: '2026-12-01', date_constat: null,
      op_trade: 'OP PRODUITS LAITIERS',
    }
    const { raisons, score } = importanceProduitFiche(cible, produit, 70, [cible], new Map(), [promoOpTrade], 'les_deux')
    expect(score).toBeGreaterThan(900)
    expect(raisons.some(r => r.startsWith('[OP Trade]'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/importance-produit.test.ts`
Expected: FAIL — `Cannot find module './importance-produit'`

- [ ] **Step 3: Write the implementation**

Create `lib/engine/importance-produit.ts`:

```ts
import type { Magasin, Produit, Promo, StatutProduit } from '@/lib/types'
import { magasinsSimilaires, type CritereSimilarite } from './similarity'
import { SCORE_OP_TRADE, scoreMagasinsSimilaires, scoreRangProduit, scoreUrgencePromoJalons, type Rang } from './scoring'
import { stadePromo, type StadePromo } from './stade-promo'

export interface ImportanceProduit {
  score: number
  raisons: string[]
  presentsChezComparables: { total: number; presents: number }
  promo: { promo: Promo; stade: StadePromo } | null
}

function promoPrincipale(promosScoped: Promo[], aujourdHui: Date): { promo: Promo; stade: StadePromo } | null {
  if (promosScoped.length === 0) return null
  const opTrade = promosScoped.find(p => p.op_trade)
  const promo = opTrade ?? [...promosScoped].sort(
    (a, b) => new Date(a.date_debut_vente).getTime() - new Date(b.date_debut_vente).getTime()
  )[0]
  return { promo, stade: stadePromo(promo, aujourdHui) }
}

export function importanceProduitFiche(
  magasin: Magasin,
  produit: Produit,
  rang: Rang,
  magasinsComparables: Magasin[],
  statutsComparables: Map<string, StatutProduit>,
  promosDuProduit: Promo[],
  critere: CritereSimilarite,
  aujourdHui: Date = new Date()
): ImportanceProduit {
  const raisons: string[] = []
  const similaires = magasinsSimilaires(magasin, magasinsComparables, critere)
  const presentsChezSimilaires = similaires.filter(m => statutsComparables.get(m.id) === 'present')

  if (presentsChezSimilaires.length > 0) {
    raisons.push(`Présent dans ${presentsChezSimilaires.length} magasin(s) similaire(s) sur ${similaires.length}.`)
  }

  const promosScoped = promosDuProduit.filter(p => p.enseigne === magasin.enseigne)
  const objectivee = promosScoped.some(p => p.op_trade)

  for (const promo of promosScoped) {
    const installation = promo.date_installation ? `installation le ${promo.date_installation}, ` : ''
    const prefixe = promo.op_trade ? '[OP Trade] ' : ''
    raisons.push(`${prefixe}Promo "${promo.mecanique}" chez ${promo.enseigne} : ${installation}vente le ${promo.date_debut_vente}.`)
  }

  const scorePromo = promosScoped.length > 0
    ? Math.max(...promosScoped.map(p => scoreUrgencePromoJalons([p.date_installation, p.date_debut_vente, p.date_constat], aujourdHui)))
    : 0
  const scoreSimilaires = scoreMagasinsSimilaires(presentsChezSimilaires.length, similaires.length)

  let score = scoreRangProduit(rang) + scorePromo + scoreSimilaires
  if (objectivee) score += SCORE_OP_TRADE

  return {
    score,
    raisons,
    presentsChezComparables: { total: similaires.length, presents: presentsChezSimilaires.length },
    promo: promoPrincipale(promosScoped, aujourdHui),
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/engine/importance-produit.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Delete the old files**

```bash
git rm lib/engine/arguments.ts lib/engine/arguments.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add lib/engine/importance-produit.ts lib/engine/importance-produit.test.ts
git commit -m "refactor: rename genererArguments to importanceProduitFiche"
```

---

### Task 6: Cross-cutting test — weekly priority stays distinct from fiche importance

**Files:**
- Create: `lib/engine/priorite-vs-importance.test.ts`

**Interfaces:**
- Consumes: `prioritesSemaine` (Task 4), `importanceProduitFiche` (Task 5).

This is the direct, permanent regression test for the requirement the user stated explicitly: *"garantir que les priorités hebdomadaires restent différentes de la simple importance d'un produit dans une fiche magasin."*

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from 'vitest'
import { prioritesSemaine } from './priorites'
import { importanceProduitFiche } from './importance-produit'
import type { Magasin, Produit, StatutProduit, StatutProduitMagasin } from '@/lib/types'

function magasin(id: string, overrides: Partial<Magasin> = {}): Magasin {
  return { id, code: id, nom: `Magasin ${id}`, enseigne: 'Carrefour', taille: 'super', adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null, ...overrides }
}

describe('séparation priorité hebdomadaire vs importance fiche magasin', () => {
  it('un Top 20 très présent chez des comparables mais sans promo ni rupture est absent des priorités de la semaine, mais bien noté dans la fiche magasin', () => {
    const cible = magasin('1')
    const comparable1 = magasin('2')
    const comparable2 = magasin('3')
    const tousLesMagasins = [cible, comparable1, comparable2]
    const produit: Produit = { id: 'p1', code: 'P1', nom: 'Yaourt Top20', categorie: null }
    const produitsParId = new Map([['p1', produit]])

    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
      { magasin_id: '2', produit_id: 'p1', statut: 'present', signale_par: null, signale_at: '' },
      { magasin_id: '3', produit_id: 'p1', statut: 'present', signale_par: null, signale_at: '' },
    ]

    // Priorité de la semaine : ni promo ni rupture, donc jamais remonté ici,
    // quelle que soit sa présence chez les magasins comparables.
    const hebdo = prioritesSemaine(tousLesMagasins, statuts, produitsParId, [], new Map())
    expect(hebdo).toHaveLength(0)

    // Fiche magasin : le même produit ressort bien grâce au rang Top20 et à
    // sa présence chez 2/2 magasins comparables.
    const statutsComparables = new Map<string, StatutProduit>([['2', 'present'], ['3', 'present']])
    const importance = importanceProduitFiche(cible, produit, 20, tousLesMagasins, statutsComparables, [], 'les_deux')
    expect(importance.score).toBeGreaterThan(0)
    expect(importance.presentsChezComparables).toEqual({ total: 2, presents: 2 })
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run lib/engine/priorite-vs-importance.test.ts`
Expected: PASS (1 test) — since Tasks 4 and 5 are already implemented, this should pass immediately without further changes. If it fails, it means Task 4 or Task 5 has a bug; fix the underlying function, not this test.

- [ ] **Step 3: Commit**

```bash
git add lib/engine/priorite-vs-importance.test.ts
git commit -m "test: lock in separation between weekly priority and fiche importance"
```

---

### Task 7: Wire the fiche magasin page to `importanceProduitFiche`

**Files:**
- Modify: `lib/engine/fiche-magasin.ts` (full rewrite)
- Modify: `app/magasins/[id]/page.tsx:22-26,57-61`

**Interfaces:**
- Consumes: `importanceProduitFiche` (Task 5).
- Produces: `interface LigneProduitImportance { produitId: string; produitNom: string; statut: StatutProduit; raisons: string[]; score: number }` and `chargerArgumentsFicheMagasin(magasinId, critere?): Promise<LigneProduitImportance[]>` (function name unchanged — it's a Server Component data-loader, renaming it isn't required by the spec and isn't otherwise justified).

- [ ] **Step 1: Rewrite `lib/engine/fiche-magasin.ts`**

```ts
import { createServerClient } from '@/lib/supabase/server'
import { importanceProduitFiche } from './importance-produit'
import type { CritereSimilarite } from './similarity'
import type { Promo, StatutProduit } from '@/lib/types'

export interface LigneProduitImportance {
  produitId: string
  produitNom: string
  statut: StatutProduit
  raisons: string[]
  score: number
}

export async function chargerArgumentsFicheMagasin(
  magasinId: string,
  critere: CritereSimilarite = 'les_deux'
): Promise<LigneProduitImportance[]> {
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

  // Comparaison "magasins comparables" limitée au secteur du magasin consulté
  // (pas au parc national) — RLS autorise déjà un commercial/manager à lire
  // les autres magasins et statuts de son propre secteur, pas besoin du
  // client admin ici.
  const { data: magasinsSecteur } = await supabase.from('magasins').select('*').eq('secteur_id', magasin.secteur_id)
  const { data: statutsSecteur } = await supabase
    .from('statuts_produit_magasin')
    .select('*')
    .in('magasin_id', (magasinsSecteur ?? []).map(m => m.id))
    .in('produit_id', manquants.map(p => p.id))
  const { data: promoLiens } = await supabase
    .from('promo_produits')
    .select('produit_id, promos(*)')
    .in('produit_id', manquants.map(p => p.id))

  const promosParProduit = new Map<string, Promo[]>()
  for (const lien of promoLiens ?? []) {
    const liste = promosParProduit.get(lien.produit_id) ?? []
    liste.push(lien.promos as unknown as Promo)
    promosParProduit.set(lien.produit_id, liste)
  }

  return manquants
    .map(produit => {
      const priorite = prioriteParProduit.get(produit.id)
      const statut = statutParProduit.get(produit.id)!
      if (!priorite) return { produitId: produit.id, produitNom: produit.nom, statut, raisons: [], score: 0 }

      const statutsPourCeProduit = new Map<string, StatutProduit>(
        (statutsSecteur ?? []).filter(s => s.produit_id === produit.id).map(s => [s.magasin_id, s.statut as StatutProduit])
      )

      const { raisons, score } = importanceProduitFiche(
        magasin, produit, priorite.rang as 20 | 50 | 70,
        magasinsSecteur ?? [], statutsPourCeProduit,
        promosParProduit.get(produit.id) ?? [], critere
      )

      return { produitId: produit.id, produitNom: produit.nom, statut, raisons, score }
    })
    .sort((a, b) => b.score - a.score)
}
```

- [ ] **Step 2: Update `app/magasins/[id]/page.tsx`**

Replace lines 22–26:

```tsx
  // Trié par score décroissant (urgence, OP Trade, magasins similaires) —
  // les manquants les plus prioritaires apparaissent en premier.
  const lignesAvecArguments = await chargerArgumentsFicheMagasin(magasin.id)
  const argumentsParProduit = new Map(lignesAvecArguments.map(l => [l.produitId, l]))
  const idsManquants = new Set(lignesAvecArguments.map(l => l.produitId))
```

with:

```tsx
  // Trié par importance décroissante (rang Top70, magasins comparables,
  // promo) — les manquants les plus importants à pousser apparaissent en
  // premier.
  const lignesImportance = await chargerArgumentsFicheMagasin(magasin.id)
  const importanceParProduit = new Map(lignesImportance.map(l => [l.produitId, l]))
  const idsManquants = new Set(lignesImportance.map(l => l.produitId))
```

Replace line 30 (`...lignesAvecArguments.map(...)`) with `...lignesImportance.map(...)`.

Replace lines 57–61:

```tsx
              {argumentsParProduit.get(p.id)?.arguments.map((arg, i) => (
                <tr key={`${p.id}-arg-${i}`}>
                  <td colSpan={2} className="text-sm text-amber-700 pl-4">{arg.message}</td>
                </tr>
              ))}
```

with:

```tsx
              {importanceParProduit.get(p.id)?.raisons.map((raison, i) => (
                <tr key={`${p.id}-raison-${i}`}>
                  <td colSpan={2} className="text-sm text-amber-700 pl-4">{raison}</td>
                </tr>
              ))}
```

- [ ] **Step 3: Verify the project typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/engine/fiche-magasin.ts "app/magasins/[id]/page.tsx"
git commit -m "refactor: wire fiche magasin to importanceProduitFiche"
```

---

### Task 8: Wire "Ma semaine" and "Mon équipe" to `prioritesSemaine`

**Files:**
- Modify: `app/semaine/page.tsx` (full rewrite)
- Modify: `app/equipe/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `prioritesSemaine` (Task 4).

- [ ] **Step 1: Rewrite `app/semaine/page.tsx`**

```tsx
import { redirect } from 'next/navigation'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { prioritesSemaine } from '@/lib/engine/priorites'
import { numeroSemaineCourante } from '@/lib/semaine'
import { CalendrierSemaine } from './calendrier-semaine'
import type { Produit, Promo } from '@/lib/types'

const LIBELLE_NIVEAU = { urgent: 'Urgent', cette_semaine: 'Cette semaine', a_anticiper: 'À anticiper' } as const

export default async function SemainePage() {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) redirect('/login')
  if (profile.role !== 'commercial') redirect('/equipe')

  const semaine = numeroSemaineCourante()

  const [{ data: magasins }, { data: produits }, { data: produitsEnseigne }, { data: promoLiens }, { data: visites }] = await Promise.all([
    supabase.from('magasins').select('*'),
    supabase.from('produits').select('*'),
    supabase.from('produits_enseigne').select('*'),
    supabase.from('promo_produits').select('produit_id, promos(*)'),
    supabase.from('visites').select('*').eq('semaine', semaine).eq('commercial_id', profile.id),
  ])

  const magasinIds = (magasins ?? []).map(m => m.id)
  const { data: statuts } = await supabase
    .from('statuts_produit_magasin')
    .select('*')
    .in('magasin_id', magasinIds.length ? magasinIds : ['00000000-0000-0000-0000-000000000000'])

  const produitsParId = new Map<string, Produit>((produits ?? []).map(p => [p.id, p]))
  const promosParProduitId = new Map<string, Promo[]>()
  for (const lien of promoLiens ?? []) {
    const liste = promosParProduitId.get(lien.produit_id) ?? []
    liste.push(lien.promos as unknown as Promo)
    promosParProduitId.set(lien.produit_id, liste)
  }

  const prioritesHebdo = prioritesSemaine(
    magasins ?? [], statuts ?? [], produitsParId, produitsEnseigne ?? [], promosParProduitId
  )

  const magasinIdsPlanifies = new Set((visites ?? []).map(v => v.magasin_id))
  const nonCouvertes = prioritesHebdo.filter(p => !magasinIdsPlanifies.has(p.magasin.id))

  return (
    <div className="p-6 grid grid-cols-2 gap-6">
      <div>
        <h1 className="text-xl font-bold mb-4">Priorités de la semaine</h1>
        {nonCouvertes.length > 0 && (
          <div className="bg-amber-100 border border-amber-400 rounded p-3 mb-4 text-sm">
            {nonCouvertes.length} priorité(s) ne sont pas couvertes par votre semaine planifiée.
          </div>
        )}
        <ul className="space-y-2">
          {prioritesHebdo.slice(0, 15).map((p, i) => (
            <li key={`${p.magasin.id}-${p.produit.id}-${i}`} className="border rounded p-2">
              <p className="font-medium">{p.magasin.nom} — {LIBELLE_NIVEAU[p.niveau]}</p>
              <p className="text-sm text-gray-600">{p.produit.nom} — {p.raison}</p>
            </li>
          ))}
        </ul>
      </div>
      <CalendrierSemaine semaine={semaine} magasins={magasins ?? []} visites={visites ?? []} />
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `app/equipe/page.tsx`**

```tsx
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { prioritesSemaine } from '@/lib/engine/priorites'
import type { Produit, Promo } from '@/lib/types'

export default async function EquipePage() {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) return null

  const [{ data: magasins }, { data: produits }, { data: produitsEnseigne }, { data: promoLiens }, { data: commerciaux }] = await Promise.all([
    supabase.from('magasins').select('*'),
    supabase.from('produits').select('*'),
    supabase.from('produits_enseigne').select('*'),
    supabase.from('promo_produits').select('produit_id, promos(*)'),
    supabase.from('profiles').select('*').eq('manager_id', profile.id),
  ])

  const magasinIds = (magasins ?? []).map(m => m.id)
  const { data: statuts } = await supabase
    .from('statuts_produit_magasin')
    .select('*')
    .in('magasin_id', magasinIds.length ? magasinIds : ['00000000-0000-0000-0000-000000000000'])

  const produitsParId = new Map<string, Produit>((produits ?? []).map(p => [p.id, p]))
  const promosParProduitId = new Map<string, Promo[]>()
  for (const lien of promoLiens ?? []) {
    const liste = promosParProduitId.get(lien.produit_id) ?? []
    liste.push(lien.promos as unknown as Promo)
    promosParProduitId.set(lien.produit_id, liste)
  }

  const prioritesHebdo = prioritesSemaine(magasins ?? [], statuts ?? [], produitsParId, produitsEnseigne ?? [], promosParProduitId)
  const emailParSecteur = new Map((commerciaux ?? []).map(c => [c.secteur_id, c.email]))

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Mon équipe — priorités de la semaine</h1>
      <table className="w-full text-sm">
        <thead><tr><th className="text-left">Magasin</th><th className="text-left">Commercial</th><th className="text-left">Produit</th><th className="text-left">Niveau</th><th className="text-left">Raison</th></tr></thead>
        <tbody>
          {prioritesHebdo.map((p, i) => (
            <tr key={`${p.magasin.id}-${p.produit.id}-${i}`}>
              <td>{p.magasin.nom}</td>
              <td>{emailParSecteur.get(p.magasin.secteur_id) ?? '-'}</td>
              <td>{p.produit.nom}</td>
              <td>{p.niveau}</td>
              <td>{p.raison}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Verify the project typechecks and builds**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/semaine/page.tsx app/equipe/page.tsx
git commit -m "refactor: wire Ma semaine and Mon équipe to prioritesSemaine"
```

---

### Task 9: Admin UI — `statut_disponibilite` selector on `/admin/produits`

**Files:**
- Modify: `lib/produits/actions.ts` (append one function)
- Modify: `app/admin/produits/produits-table.tsx`
- Modify: `app/admin/produits/produit-row.tsx`

**Interfaces:**
- Consumes: `StatutDisponibilite` (Task 1), `ProduitEnseigne.statut_disponibilite` (Task 1).
- Produces: `definirStatutDisponibilite(produitId: string, enseigne: string, statut: StatutDisponibilite): Promise<void>` server action.

- [ ] **Step 1: Add the server action**

In `lib/produits/actions.ts`, add this import to the top of the file:

```ts
import type { StatutDisponibilite } from '@/lib/types'
```

Then append this function at the end of the file:

```ts
export async function definirStatutDisponibilite(produitId: string, enseigne: string, statut: StatutDisponibilite) {
  await assertAdmin()
  const admin = createAdminClient()
  const { error } = await admin.from('produits_enseigne')
    .update({ statut_disponibilite: statut })
    .eq('produit_id', produitId)
    .eq('enseigne', enseigne)
  if (error) throw error
  revalidatePath('/admin/produits')
}
```

- [ ] **Step 2: Pass the statut map down from `ProduitsTable`**

In `app/admin/produits/produits-table.tsx`, add this import next to the existing `ENSEIGNES` import:

```tsx
import { ENSEIGNES, type PrioriteProduit, type Produit, type ProduitEnseigne, type StatutDisponibilite } from '@/lib/types'
```

Add this `useMemo` block next to `rangParProduit`:

```tsx
  const statutParProduitEtEnseigne = useMemo(() => {
    const map = new Map<string, Map<string, StatutDisponibilite>>()
    for (const pe of produitsEnseigne) {
      if (!map.has(pe.produit_id)) map.set(pe.produit_id, new Map())
      map.get(pe.produit_id)!.set(pe.enseigne, pe.statut_disponibilite)
    }
    return map
  }, [produitsEnseigne])
```

In the `<ProduitRow>` invocation inside the `.map()`, add a new prop:

```tsx
            {filtres.map(p => (
              <ProduitRow
                key={p.id}
                produit={p}
                enseignesActuelles={enseignesParProduit.get(p.id) ?? new Set()}
                rangActuel={rangParProduit.get(p.id) ?? null}
                statutParEnseigne={statutParProduitEtEnseigne.get(p.id) ?? new Map()}
              />
            ))}
```

- [ ] **Step 3: Add the selector to `ProduitRow`**

Replace the full content of `app/admin/produits/produit-row.tsx` with:

```tsx
'use client'
import { useState, useTransition } from 'react'
import { definirAssortiment, definirPriorite, definirStatutDisponibilite, supprimerProduit } from '@/lib/produits/actions'
import { ENSEIGNES, type Produit, type StatutDisponibilite } from '@/lib/types'

const LIBELLES_STATUT: Record<StatutDisponibilite, string> = {
  commandable: 'Commandable',
  non_commandable: 'Non commandable (déréférencé)',
  arret_industriel: 'Arrêt industriel',
  en_attente_referencement: 'En attente de référencement',
}

export function ProduitRow({
  produit,
  enseignesActuelles,
  rangActuel,
  statutParEnseigne,
}: {
  produit: Produit
  enseignesActuelles: Set<string>
  rangActuel: 20 | 50 | 70 | null
  statutParEnseigne: Map<string, StatutDisponibilite>
}) {
  const [enseignes, setEnseignes] = useState(enseignesActuelles)
  const [rang, setRang] = useState(rangActuel)
  const [statuts, setStatuts] = useState(statutParEnseigne)
  const [pending, startTransition] = useTransition()

  function toggleEnseigne(enseigne: string) {
    const present = !enseignes.has(enseigne)
    const next = new Set(enseignes)
    if (present) next.add(enseigne)
    else next.delete(enseigne)
    setEnseignes(next)
    startTransition(() => { definirAssortiment(produit.id, enseigne, present) })
  }

  function handleRangChange(value: string) {
    const nouveauRang = value === '' ? null : (Number(value) as 20 | 50 | 70)
    setRang(nouveauRang)
    startTransition(() => { definirPriorite(produit.id, nouveauRang) })
  }

  function handleStatutChange(enseigne: string, statut: StatutDisponibilite) {
    const next = new Map(statuts)
    next.set(enseigne, statut)
    setStatuts(next)
    startTransition(() => { definirStatutDisponibilite(produit.id, enseigne, statut) })
  }

  async function handleDelete() {
    if (!confirm(`Supprimer "${produit.nom}" (${produit.code}) ?`)) return
    await supprimerProduit(produit.id)
  }

  return (
    <tr className={pending ? 'opacity-50' : ''}>
      <td className="whitespace-nowrap font-mono text-xs">{produit.code}</td>
      <td>{produit.nom}</td>
      <td className="text-xs text-gray-500">{[produit.marque, produit.parfum, produit.format].filter(Boolean).join(' · ') || produit.categorie}</td>
      <td>
        <select value={rang ?? ''} onChange={e => handleRangChange(e.target.value)} className="border rounded px-1 py-0.5 text-sm">
          <option value="">-</option>
          <option value="20">Top 20</option>
          <option value="50">Top 50</option>
          <option value="70">Top 70</option>
        </select>
      </td>
      {ENSEIGNES.map(e => (
        <td key={e} className="text-center">
          <input type="checkbox" checked={enseignes.has(e)} onChange={() => toggleEnseigne(e)} />
          {enseignes.has(e) && (
            <select
              value={statuts.get(e) ?? 'commandable'}
              onChange={ev => handleStatutChange(e, ev.target.value as StatutDisponibilite)}
              className="block text-[10px] border rounded mt-1"
            >
              {Object.entries(LIBELLES_STATUT).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          )}
        </td>
      ))}
      <td>
        <button onClick={handleDelete} className="text-red-600 underline text-sm">Supprimer</button>
      </td>
    </tr>
  )
}
```

- [ ] **Step 4: Verify the project typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification in the browser**

Start the dev server and open `/admin/produits` logged in as the admin account. Confirm:
- A checked enseigne cell now shows a status dropdown below the checkbox.
- Changing the dropdown persists after a page reload (confirms the server action + `revalidatePath` work).
- Unchecking the enseigne hides the dropdown again.

- [ ] **Step 6: Commit**

```bash
git add lib/produits/actions.ts app/admin/produits/produits-table.tsx app/admin/produits/produit-row.tsx
git commit -m "feat: admin selector for statut_disponibilite per enseigne"
```

---

### Task 10: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new `stade-promo.test.ts`, `action-recommandee.test.ts`, rewritten `priorites.test.ts`, `importance-produit.test.ts`, and `priorite-vs-importance.test.ts`.

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 3: Manual browser check of the three touched pages**

Log in as the commercial test account and open `/semaine` — confirm the page renders a list of magasin/produit/niveau/raison without crashing (empty list is fine if no store currently has a rupture or promo-linked gap).

Log in as the admin test account and open `/equipe` — confirm the table renders with the new "Produit" column.

Open a fiche magasin (`/magasins/[id]`) for a store with at least one manquant product — confirm the raisons text still displays under the product row as before.

- [ ] **Step 4: Push**

```bash
git push origin worktree-outil-force-vente:main
```

## Self-Review Notes

- **Spec coverage:** §3 (schema + admin selector) → Task 1 + Task 9. §4.1 (`stadePromo`) → Task 2. §4.2 (`prioritesSemaine`, all six trigger/dedup rules including the OP-Trade-while-present rule the user explicitly confirmed) → Task 4. §4.3 (`importanceProduitFiche`) → Task 5. §5 (`actionRecommandee` hard gate) → Task 3. §6 (minimal page wiring) → Tasks 7–8. §8 (required tests) → Tasks 3, 4, 6 collectively cover every bullet.
- **Two deliberate deviations from the spec's literal (shorthand) function signatures**, both called out inline in their task's Interfaces block: `prioritesSemaine` gains a `produitsParId` parameter the spec's prose omitted, and `importanceProduitFiche` drops the spec's `statut` parameter as dead code given its only caller. Neither changes behavior described in prose.
- **Placeholder scan:** no TBD/TODO; every step has runnable code and an exact expected result.
- **Type consistency:** `StatutDisponibilite`, `StadePromo`, `NiveauPriorite`, `ActionRecommandee`, `PrioriteHebdo`, `ImportanceProduit` are defined once (Tasks 1–5) and referenced with the same names/shapes in every later task.
