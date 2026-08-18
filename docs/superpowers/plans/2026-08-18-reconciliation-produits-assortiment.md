# Réconciliation produits / assortiment / typologie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every product a canonical identity (promo/repackaging EANs point to the permanent sellable EAN), rebuild `produits_enseigne` to exactly match the real plans de vente per enseigne, store real typologie/famille/segment, and make every screen display a full, non-ambiguous product name.

**Architecture:** A `produit_canonique_id` self-reference on `produits` links promotional/repackaged EANs to their permanent counterpart, enforced by a trigger against chaining/self-reference. A new admin import (`importPlanDeVente`) reads the 6-sheet workbook the user builds from the real plans de vente and becomes the source of truth for `produits_enseigne` membership + typologie, with a preview step before any write. Every place the engine resolves a `produit_id` coming from `promo_produits` or `statuts_produit_magasin` first resolves through the canonical link, so a promo referencing a repackaged EAN and a manual "manquant" report against either EAN both land on the same product for scoring/display purposes.

**Tech Stack:** Next.js Server Actions, Supabase/Postgres, `xlsx` (SheetJS), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-18-reconciliation-produits-assortiment-design.md`

## Global Constraints

- No fusion/deletion of promotional-variant `produits` rows — ever. Only a nullable `produit_canonique_id` link.
- A canonical product's own `produit_canonique_id` must be `null` (enforced by trigger, not just convention) — this is what prevents chains and cycles.
- Assortment reads must reflect only `actif = true` rows in `produits_enseigne`; the plan-de-vente import deactivates stale rows, it never deletes them.
- `Typologie` stores the raw enseigne code (`T1`..`T6`, `H1`..`H4`, `MN`, `MD`, `Région`) as free text — no binary obligatoire/picking enum anywhere in Phase 1.
- The 56 canonical links and 20 `a_qualifier` rows enumerated in the spec's "Rapport de correspondances canoniques" are the exact, pre-verified data to apply — do not re-derive or second-guess them; do not invent new links beyond that list.

---

### Task 1: Schema migration — canonical link, famille/segment, statut_catalogue, produits_enseigne.actif, import history

**Files:**
- Create: `supabase/migrations/0009_reconciliation_produits.sql` (apply via the Supabase `apply_migration` tool, not raw `execute_sql`)
- Modify: `lib/types.ts`

**Interfaces:**
- Produces: `Produit` gains `produit_canonique_id: string | null`, `famille: string | null`, `segment: string | null`, `statut_catalogue: 'permanent' | 'a_qualifier' | 'variante_promo' | 'arrete'`, `type_liaison: 'conditionnement_promo' | 'ancien_ean' | 'repackaging' | null`. `ProduitEnseigne` gains `actif: boolean`. `Typologie` type becomes `string`.

- [ ] **Step 1: Write the migration SQL**

```sql
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
```

Apply via the `apply_migration` MCP tool (name: `reconciliation_produits`), not `execute_sql` — keeps Supabase's tracked migration history intact.

- [ ] **Step 2: Update `lib/types.ts`**

In the `Produit` interface, add:
```ts
produit_canonique_id: string | null
famille: string | null
segment: string | null
statut_catalogue: 'permanent' | 'a_qualifier' | 'variante_promo' | 'arrete'
type_liaison: 'conditionnement_promo' | 'ancien_ean' | 'repackaging' | null
```

Change:
```ts
export type Typologie = string
```
(was `'obligatoire' | 'picking'`)

In `ProduitEnseigne`, add:
```ts
actif: boolean
```

- [ ] **Step 3: Run `npx tsc --noEmit`**

Expected: errors at every site that builds a `Produit` or `ProduitEnseigne` object literal without the new required fields (test fixtures) and every site typed against the old `Typologie` union. List them — they're fixed in Task 2 (fixtures) and Task 9 (typologie UI), not here. Do not fix compile errors in this task beyond confirming the list matches those two tasks' scope.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0009_reconciliation_produits.sql lib/types.ts
git commit -m "feat: schema pour la réconciliation produits (lien canonique, famille/segment, assortiment actif)"
```

---

### Task 2: Fix Produit/ProduitEnseigne test fixtures for the new required fields

**Files:**
- Modify: every test file constructing a `Produit` or `ProduitEnseigne` object literal. Find them with:
  ```bash
  grep -rl "categorie: null\|categorie:null" lib --include="*.test.ts"
  ```
  (confirmed as of this plan: `lib/engine/produit-a-travailler.test.ts`, `lib/engine/importance-produit.test.ts`, `lib/engine/priorites.test.ts`, `lib/engine/priorite-vs-importance.test.ts`, `lib/engine/fiche-magasin.test.ts`, `lib/engine/regrouper-priorites.test.ts`, `lib/import/mappers.test.ts` — re-run the grep, this list may be incomplete by the time this task runs)

**Interfaces:**
- Consumes: `Produit`/`ProduitEnseigne` types from Task 1.

- [ ] **Step 1: Add the new required fields to every `Produit` fixture**

For every `produit`/`Produit` object literal found, add:
```ts
produit_canonique_id: null, famille: null, segment: null, statut_catalogue: 'permanent', type_liaison: null,
```
matching exactly the pattern already used for `raison_absence: null` and `surface: null` earlier this session — one line addition per literal, no shortcuts, no making the fields optional.

- [ ] **Step 2: Run `npx tsc --noEmit`**

Expected: zero errors related to `Produit`/`ProduitEnseigne` fixtures. Any remaining errors belong to Task 9 (typologie) — leave those.

- [ ] **Step 3: Run `npx vitest run`**

Expected: all tests that were passing before Task 1 still pass (this task only adds fields, doesn't change behavior).

- [ ] **Step 4: Commit**

```bash
git add lib
git commit -m "test: ajoute les nouveaux champs Produit requis aux fixtures"
```

---

### Task 3: `nomComplet()` display helper + wire into every product-name render site

**Files:**
- Create: `lib/engine/nom-complet.ts`
- Test: `lib/engine/nom-complet.test.ts`
- Modify: `components/priorites-liste.tsx`, `app/magasins/[id]/assortiment-table.tsx`, `app/magasins/[id]/produit-a-travailler-carte.tsx`, `app/admin/produits/produit-row.tsx` (wherever `{produit.nom}` or `{p.produit.nom}` is currently rendered alone)

**Interfaces:**
- Produces: `nomComplet(produit: { nom: string; format: string | null }): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import { nomComplet } from './nom-complet'

describe('nomComplet', () => {
  it('ajoute le format quand il est renseigné', () => {
    expect(nomComplet({ nom: 'Sveltesse Ferme Et Fondant Cafe', format: 'x4 125g' }))
      .toBe('Sveltesse Ferme Et Fondant Cafe — x4 125g')
  })

  it("n'ajoute rien quand le format est déjà inclus dans le nom (produit sans colonne format séparée)", () => {
    expect(nomComplet({ nom: 'La Laitière FDM chocolat 3x57g +1 offert', format: null }))
      .toBe('La Laitière FDM chocolat 3x57g +1 offert')
  })

  it('distingue deux produits de même nom par leur format', () => {
    const a = nomComplet({ nom: "Siggi's Nature", format: 'x2 140g' })
    const b = nomComplet({ nom: "Siggi's Nature", format: 'x1 450g' })
    expect(a).not.toBe(b)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/engine/nom-complet.test.ts`
Expected: FAIL — `nom-complet.ts` doesn't exist yet.

- [ ] **Step 3: Write the implementation**

```ts
export function nomComplet(produit: { nom: string; format: string | null }): string {
  return produit.format ? `${produit.nom} — ${produit.format}` : produit.nom
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/engine/nom-complet.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire into every product-name render site**

Search: `grep -rn "\.nom}" components app --include="*.tsx"` and `grep -rn "produit\.nom\b" components app --include="*.tsx"`. For each site currently rendering `{produit.nom}` or `{p.produit.nom}` where `produit`/`p.produit` is a full `Produit` object (has `.format`), replace with `{nomComplet(produit)}` (import `nomComplet` from `@/lib/engine/nom-complet`). Do not touch sites rendering a plain string that isn't a `Produit` (e.g., `promo.mecanique`).

- [ ] **Step 6: Verify manually**

Start the dev server, open `/admin/produits`, confirm rows that previously showed identical names (e.g. multiple "La Laitiere Caramel") now show distinct format suffixes.

- [ ] **Step 7: Commit**

```bash
git add lib/engine/nom-complet.ts lib/engine/nom-complet.test.ts components app
git commit -m "feat: affiche systématiquement le nom complet produit (nom + format)"
```

---

### Task 4: Plan de vente parser + mapper

**Files:**
- Modify: `lib/import/parser.ts`, `lib/import/mappers.ts`
- Test: `lib/import/mappers.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // parser.ts
  export function readPlanDeVenteSheet(buffer: ArrayBuffer, sheetName: string): Record<string, string>[]
  // mappers.ts
  export interface PlanDeVenteImport {
    ean: string
    nom: string
    famille: string | null
    segment: string | null
    typologie: string | null
  }
  export function mapPlanDeVenteRow(row: Record<string, string>): PlanDeVenteImport | null
  ```

The workbook layout (confirmed against the real file the user built): row 1 = title, row 2 = subtitle with a reference count, row 3 = blank, row 4 = headers (`EAN PRODUIT`, `NOM DU PRODUIT`, `FAMILLE`, `SEGMENT`, `TYPOLOGIE` — the last one may be absent for Intermarché/Leclerc/Système U sheets), row 5+ = data.

- [ ] **Step 1: Write the failing parser test**

Add to `lib/import/parser.test.ts` (check the file exists first; if not, this is the first test in it, mirror the existing `readVmhSheet` test's structure exactly):

```ts
describe('readPlanDeVenteSheet', () => {
  it('lit les lignes de données à partir de la ligne d\'en-tête réelle (ligne 4)', () => {
    const wb = XLSX.utils.book_new()
    const rows = [
      ['PLAN DE VENTE LNUF - CARREFOUR'],
      ['123 références • Familles et segments regroupés • Mise à jour 25/06/2026'],
      [],
      ['EAN PRODUIT', 'NOM DU PRODUIT', 'FAMILLE', 'SEGMENT', 'TYPOLOGIE'],
      ['3023290038147', "SIGGI'S CITRON X 2 140 GR STD", 'Skyr', 'Skyr', 'MN'],
    ]
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, sheet, 'Carrefour')
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })

    const result = readPlanDeVenteSheet(buffer, 'Carrefour')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ 'EAN PRODUIT': '3023290038147', 'NOM DU PRODUIT': "SIGGI'S CITRON X 2 140 GR STD", TYPOLOGIE: 'MN' })
  })

  it('lève une erreur explicite si l\'onglet est absent', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Autre')
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    expect(() => readPlanDeVenteSheet(buffer, 'Carrefour')).toThrow('Onglet "Carrefour" introuvable')
  })
})
```

(Add `import * as XLSX from 'xlsx'` at the top of the test file if not already imported.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run lib/import/parser.test.ts -t readPlanDeVenteSheet`
Expected: FAIL — function not defined.

- [ ] **Step 3: Implement `readPlanDeVenteSheet` in `parser.ts`**

```ts
// Lit l'onglet "plan de vente" d'une enseigne : titre (ligne 1), sous-titre
// avec compteur (ligne 2), ligne vide (ligne 3), en-têtes (ligne 4), données
// à partir de la ligne 5. TYPOLOGIE est absente pour les enseignes qui n'ont
// pas cette donnée (Intermarché/Leclerc/Système U).
export function readPlanDeVenteSheet(buffer: ArrayBuffer, sheetName: string): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error(`Onglet "${sheetName}" introuvable dans le fichier`)
  return XLSX.utils.sheet_to_json(sheet, { range: 3, defval: '', raw: false })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/import/parser.test.ts -t readPlanDeVenteSheet`
Expected: PASS (2 tests)

- [ ] **Step 5: Write the failing mapper test**

Add to `lib/import/mappers.test.ts`:

```ts
describe('mapPlanDeVenteRow', () => {
  function ligne(overrides: Partial<Record<string, string>> = {}) {
    return {
      'EAN PRODUIT': '3023290038147',
      'NOM DU PRODUIT': "SIGGI'S CITRON X 2 140 GR STD",
      'FAMILLE': 'Skyr',
      'SEGMENT': 'Skyr',
      'TYPOLOGIE': 'MN',
      ...overrides,
    }
  }

  it('extrait les champs pertinents', () => {
    const result = mapPlanDeVenteRow(ligne())
    expect(result).toEqual({ ean: '3023290038147', nom: "SIGGI'S CITRON X 2 140 GR STD", famille: 'Skyr', segment: 'Skyr', typologie: 'MN' })
  })

  it('renvoie typologie null quand la colonne est absente ou vide (Intermarché/Leclerc/Système U)', () => {
    const result = mapPlanDeVenteRow(ligne({ TYPOLOGIE: '' }))
    expect(result?.typologie).toBeNull()
  })

  it('ignore une ligne sans EAN', () => {
    expect(mapPlanDeVenteRow(ligne({ 'EAN PRODUIT': '' }))).toBeNull()
  })
})
```

- [ ] **Step 6: Run to verify it fails, then implement**

```ts
export interface PlanDeVenteImport {
  ean: string
  nom: string
  famille: string | null
  segment: string | null
  typologie: string | null
}

export function mapPlanDeVenteRow(row: Record<string, string>): PlanDeVenteImport | null {
  const ean = row['EAN PRODUIT']?.trim()
  if (!ean) return null
  return {
    ean,
    nom: row['NOM DU PRODUIT']?.trim() ?? '',
    famille: row['FAMILLE']?.trim() || null,
    segment: row['SEGMENT']?.trim() || null,
    typologie: row['TYPOLOGIE']?.trim() || null,
  }
}
```

- [ ] **Step 7: Run full mapper + parser test files, confirm all pass**

Run: `npx vitest run lib/import/mappers.test.ts lib/import/parser.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add lib/import/parser.ts lib/import/mappers.ts lib/import/parser.test.ts lib/import/mappers.test.ts
git commit -m "feat: parser et mapper pour l'import plan de vente"
```

---

### Task 5: Diff computation (pure function)

**Files:**
- Create: `lib/import/plan-de-vente-diff.ts`
- Test: `lib/import/plan-de-vente-diff.test.ts`

**Interfaces:**
- Consumes: `PlanDeVenteImport` from Task 4.
- Produces:
  ```ts
  export interface DiffEnseigne {
    enseigne: string
    references: number
    ajouts: number
    misesAJour: number
    retraits: number
    eanInconnus: string[]
    doublons: string[]
  }
  export interface LigneAssortimentAAppliquer {
    produit_id: string
    enseigne: string
    typologie: string | null
  }
  export function calculerDiffPlanDeVente(
    lignes: PlanDeVenteImport[],
    enseigne: string,
    produitIdParEan: Map<string, string>,
    assortimentActuel: { produit_id: string; typologie: string | null; actif: boolean }[]
  ): { resume: DiffEnseigne; aActiver: LigneAssortimentAAppliquer[]; aDesactiverProduitIds: string[] }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { calculerDiffPlanDeVente } from './plan-de-vente-diff'
import type { PlanDeVenteImport } from './mappers'

describe('calculerDiffPlanDeVente', () => {
  const produitIdParEan = new Map([['111', 'p1'], ['222', 'p2'], ['333', 'p3']])

  it('compte ajout, mise à jour de typologie et retrait', () => {
    const lignes: PlanDeVenteImport[] = [
      { ean: '111', nom: 'A', famille: null, segment: null, typologie: 'T1' },
      { ean: '222', nom: 'B', famille: null, segment: null, typologie: 'T2' },
    ]
    const assortimentActuel = [
      { produit_id: 'p2', typologie: 'T1', actif: true },
      { produit_id: 'p3', typologie: null, actif: true },
    ]
    const { resume, aActiver, aDesactiverProduitIds } = calculerDiffPlanDeVente(lignes, 'Carrefour', produitIdParEan, assortimentActuel)

    expect(resume).toEqual({ enseigne: 'Carrefour', references: 2, ajouts: 1, misesAJour: 1, retraits: 1, eanInconnus: [], doublons: [] })
    expect(aActiver).toEqual(expect.arrayContaining([
      { produit_id: 'p1', enseigne: 'Carrefour', typologie: 'T1' },
      { produit_id: 'p2', enseigne: 'Carrefour', typologie: 'T2' },
    ]))
    expect(aDesactiverProduitIds).toEqual(['p3'])
  })

  it('signale un EAN du classeur introuvable dans produits, sans bloquer le reste', () => {
    const lignes: PlanDeVenteImport[] = [
      { ean: '999', nom: 'Inconnu', famille: null, segment: null, typologie: null },
      { ean: '111', nom: 'A', famille: null, segment: null, typologie: null },
    ]
    const { resume, aActiver } = calculerDiffPlanDeVente(lignes, 'Carrefour', produitIdParEan, [])
    expect(resume.eanInconnus).toEqual(['999'])
    expect(aActiver).toEqual([{ produit_id: 'p1', enseigne: 'Carrefour', typologie: null }])
  })

  it('signale un EAN dupliqué dans le classeur, ne le compte qu\'une fois', () => {
    const lignes: PlanDeVenteImport[] = [
      { ean: '111', nom: 'A', famille: null, segment: null, typologie: 'T1' },
      { ean: '111', nom: 'A', famille: null, segment: null, typologie: 'T2' },
    ]
    const { resume, aActiver } = calculerDiffPlanDeVente(lignes, 'Carrefour', produitIdParEan, [])
    expect(resume.doublons).toEqual(['111'])
    expect(aActiver).toHaveLength(1)
  })

  it('ré-import identique : 0 ajout, 0 mise à jour, 0 retrait (idempotence)', () => {
    const lignes: PlanDeVenteImport[] = [{ ean: '111', nom: 'A', famille: null, segment: null, typologie: 'T1' }]
    const assortimentActuel = [{ produit_id: 'p1', typologie: 'T1', actif: true }]
    const { resume } = calculerDiffPlanDeVente(lignes, 'Carrefour', produitIdParEan, assortimentActuel)
    expect(resume).toMatchObject({ ajouts: 0, misesAJour: 0, retraits: 0 })
  })

  it('réactive un produit précédemment désactivé', () => {
    const lignes: PlanDeVenteImport[] = [{ ean: '111', nom: 'A', famille: null, segment: null, typologie: 'T1' }]
    const assortimentActuel = [{ produit_id: 'p1', typologie: 'T1', actif: false }]
    const { resume, aActiver } = calculerDiffPlanDeVente(lignes, 'Carrefour', produitIdParEan, assortimentActuel)
    expect(resume.ajouts).toBe(1)
    expect(aActiver).toEqual([{ produit_id: 'p1', enseigne: 'Carrefour', typologie: 'T1' }])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/import/plan-de-vente-diff.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
import type { PlanDeVenteImport } from './mappers'

export interface DiffEnseigne {
  enseigne: string
  references: number
  ajouts: number
  misesAJour: number
  retraits: number
  eanInconnus: string[]
  doublons: string[]
}

export interface LigneAssortimentAAppliquer {
  produit_id: string
  enseigne: string
  typologie: string | null
}

export function calculerDiffPlanDeVente(
  lignes: PlanDeVenteImport[],
  enseigne: string,
  produitIdParEan: Map<string, string>,
  assortimentActuel: { produit_id: string; typologie: string | null; actif: boolean }[]
): { resume: DiffEnseigne; aActiver: LigneAssortimentAAppliquer[]; aDesactiverProduitIds: string[] } {
  const eanInconnus: string[] = []
  const doublons: string[] = []
  const vus = new Set<string>()
  const parProduitId = new Map<string, LigneAssortimentAAppliquer>()

  for (const ligne of lignes) {
    if (vus.has(ligne.ean)) {
      doublons.push(ligne.ean)
      continue
    }
    vus.add(ligne.ean)
    const produitId = produitIdParEan.get(ligne.ean)
    if (!produitId) {
      eanInconnus.push(ligne.ean)
      continue
    }
    parProduitId.set(produitId, { produit_id: produitId, enseigne, typologie: ligne.typologie })
  }

  const actuelParProduitId = new Map(assortimentActuel.map(a => [a.produit_id, a]))
  let ajouts = 0
  let misesAJour = 0
  const aActiver: LigneAssortimentAAppliquer[] = []

  for (const [produitId, cible] of parProduitId) {
    const actuel = actuelParProduitId.get(produitId)
    if (!actuel || !actuel.actif) {
      ajouts++
      aActiver.push(cible)
    } else if (actuel.typologie !== cible.typologie) {
      misesAJour++
      aActiver.push(cible)
    }
    // sinon : identique, rien à faire (idempotence)
  }

  const aDesactiverProduitIds = assortimentActuel
    .filter(a => a.actif && !parProduitId.has(a.produit_id))
    .map(a => a.produit_id)

  return {
    resume: {
      enseigne,
      references: parProduitId.size,
      ajouts,
      misesAJour,
      retraits: aDesactiverProduitIds.length,
      eanInconnus,
      doublons,
    },
    aActiver,
    aDesactiverProduitIds,
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/import/plan-de-vente-diff.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/import/plan-de-vente-diff.ts lib/import/plan-de-vente-diff.test.ts
git commit -m "feat: calcul du diff d'import plan de vente (pur, testable)"
```

---

### Task 6: Import actions — preview + confirm, transactional, historized

**Files:**
- Modify: `lib/import/actions.ts`
- Modify: `app/admin/import/page.tsx`

**Interfaces:**
- Consumes: `readPlanDeVenteSheet`, `mapPlanDeVenteRow` (Task 4), `calculerDiffPlanDeVente` (Task 5).
- Produces:
  ```ts
  export interface PreviewPlanDeVente {
    parEnseigne: DiffEnseigne[]
    onglets_manquants: string[]
  }
  export async function previewImportPlanDeVente(formData: FormData): Promise<PreviewPlanDeVente>
  export async function confirmerImportPlanDeVente(formData: FormData): Promise<{ resume: DiffEnseigne[] }>
  ```

- [ ] **Step 1: Implement `previewImportPlanDeVente`**

```ts
const ENSEIGNES_PLAN_DE_VENTE: { sheet: string; enseigne: string }[] = [
  { sheet: 'Auchan', enseigne: 'Auchan' },
  { sheet: 'Carrefour', enseigne: 'Carrefour' },
  { sheet: 'Carrefour Market', enseigne: 'Carrefour Market' },
  { sheet: 'Intermarché', enseigne: 'Intermarche' },
  { sheet: 'Leclerc', enseigne: 'Leclerc' },
  { sheet: 'Système U', enseigne: 'U' },
]

async function chargerDiffsPlanDeVente(buffer: ArrayBuffer, admin: ReturnType<typeof createAdminClient>) {
  const { data: produits } = await admin.from('produits').select('id, code')
  const produitIdParEan = new Map((produits ?? []).map(p => [p.code, p.id]))

  const ongletsManquants: string[] = []
  const diffs: ReturnType<typeof calculerDiffPlanDeVente>[] = []

  for (const { sheet, enseigne } of ENSEIGNES_PLAN_DE_VENTE) {
    let rows: Record<string, string>[]
    try {
      rows = readPlanDeVenteSheet(buffer, sheet)
    } catch {
      ongletsManquants.push(sheet)
      continue
    }
    const lignes = rows.map(mapPlanDeVenteRow).filter((l): l is NonNullable<typeof l> => l !== null)
    const { data: assortimentActuel } = await admin
      .from('produits_enseigne')
      .select('produit_id, typologie, actif')
      .eq('enseigne', enseigne)
    const diff = calculerDiffPlanDeVente(lignes, enseigne, produitIdParEan, assortimentActuel ?? [])
    if (diff.resume.references === 0 && (assortimentActuel ?? []).some(a => a.actif)) {
      throw new Error(`${enseigne} : le fichier ne contient aucune référence exploitable alors que l'enseigne a un assortiment existant — import refusé pour éviter une désactivation silencieuse.`)
    }
    diffs.push(diff)
  }

  return { diffs, ongletsManquants }
}

export async function previewImportPlanDeVente(formData: FormData): Promise<PreviewPlanDeVente> {
  await assertAdmin()
  const file = formData.get('file') as File
  const admin = createAdminClient()
  const { diffs, ongletsManquants } = await chargerDiffsPlanDeVente(await file.arrayBuffer(), admin)
  return { parEnseigne: diffs.map(d => d.resume), onglets_manquants: ongletsManquants }
}
```

- [ ] **Step 2: Implement `confirmerImportPlanDeVente`**

```ts
export async function confirmerImportPlanDeVente(formData: FormData): Promise<{ resume: DiffEnseigne[] }> {
  await assertAdmin()
  const file = formData.get('file') as File
  const admin = createAdminClient()
  const { diffs, ongletsManquants } = await chargerDiffsPlanDeVente(await file.arrayBuffer(), admin)
  if (ongletsManquants.length > 0) {
    throw new Error(`Onglets manquants, import refusé : ${ongletsManquants.join(', ')}`)
  }

  // Transactionnel : execute_sql direct n'est pas exposé côté client Supabase-js,
  // donc chaque enseigne s'applique séquentiellement ; en cas d'erreur sur une
  // enseigne, les précédentes de CETTE exécution restent appliquées (limite
  // connue du client REST, pas de vraie transaction multi-requêtes). Documenté
  // ici plutôt que promettre une atomicité que ce client ne peut pas tenir.
  for (const diff of diffs) {
    if (diff.aActiver.length > 0) {
      const { error } = await admin.from('produits_enseigne').upsert(
        diff.aActiver.map(l => ({ produit_id: l.produit_id, enseigne: l.enseigne, typologie: l.typologie, actif: true })),
        { onConflict: 'produit_id,enseigne' }
      )
      if (error) throw error
    }
    if (diff.aDesactiverProduitIds.length > 0) {
      const { error } = await admin.from('produits_enseigne')
        .update({ actif: false })
        .eq('enseigne', diff.resume.enseigne)
        .in('produit_id', diff.aDesactiverProduitIds)
      if (error) throw error
    }
  }

  const { error: histError } = await admin.from('imports_plan_de_vente').insert({
    resume: Object.fromEntries(diffs.map(d => [d.resume.enseigne, d.resume])),
  })
  if (histError) throw histError

  return { resume: diffs.map(d => d.resume) }
}
```

Import `calculerDiffPlanDeVente`, `readPlanDeVenteSheet`, `mapPlanDeVenteRow`, `DiffEnseigne` at the top of `actions.ts`.

- [ ] **Step 3: Add the 2-step admin UI**

In `app/admin/import/page.tsx`, add a dedicated component (not the generic `ImportForm` — this one needs a preview step):

```tsx
function ImportPlanDeVenteForm() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewPlanDeVente | null>(null)
  const [resultat, setResultat] = useState<{ resume: DiffEnseigne[] } | null>(null)
  const [pending, setPending] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function handlePreview() {
    if (!file) return
    setPending(true)
    setErreur(null)
    try {
      const fd = new FormData()
      fd.set('file', file)
      setPreview(await previewImportPlanDeVente(fd))
    } catch (err) {
      setErreur((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  async function handleConfirmer() {
    if (!file) return
    setPending(true)
    setErreur(null)
    try {
      const fd = new FormData()
      fd.set('file', file)
      setResultat(await confirmerImportPlanDeVente(fd))
      setPreview(null)
    } catch (err) {
      setErreur((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2 border rounded p-4">
      <h2 className="font-semibold">Plan de vente LNUF (par enseigne)</h2>
      <input type="file" accept=".xlsx" onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResultat(null) }} />
      <button onClick={handlePreview} disabled={!file || pending} className="bg-gray-600 text-white px-3 py-1 rounded disabled:opacity-50">
        {pending ? 'Analyse...' : 'Prévisualiser'}
      </button>
      {erreur && <p className="text-red-600 text-sm">{erreur}</p>}
      {preview && (
        <div className="text-sm space-y-1">
          {preview.onglets_manquants.length > 0 && (
            <p className="text-red-600">Onglets manquants : {preview.onglets_manquants.join(', ')} — import refusé.</p>
          )}
          {preview.parEnseigne.map(d => (
            <p key={d.enseigne}>
              {d.enseigne} — {d.references} références détectées · {d.ajouts} ajouts · {d.misesAJour} mises à jour · {d.retraits} retraits
              {d.eanInconnus.length > 0 && ` · ${d.eanInconnus.length} EAN inconnu(s)`}
              {d.doublons.length > 0 && ` · ${d.doublons.length} doublon(s)`}
            </p>
          ))}
          {preview.onglets_manquants.length === 0 && (
            <button onClick={handleConfirmer} disabled={pending} className="bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50">
              {pending ? 'Import en cours...' : 'Confirmer et appliquer'}
            </button>
          )}
        </div>
      )}
      {resultat && <p className="text-green-700 text-sm">Import appliqué : {resultat.resume.map(d => `${d.enseigne} (${d.references})`).join(', ')}</p>}
    </div>
  )
}
```

Add `<ImportPlanDeVenteForm />` to the page's render, and import `previewImportPlanDeVente`, `confirmerImportPlanDeVente`, `PreviewPlanDeVente`, `DiffEnseigne` from `@/lib/import/actions`.

- [ ] **Step 4: Run `npx tsc --noEmit`**

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add lib/import/actions.ts app/admin/import/page.tsx
git commit -m "feat: import plan de vente avec aperçu, désactivation et historique"
```

---

### Task 7: Apply the 56 canonical links + 20 `a_qualifier` statuses (data fix)

**Files:**
- None (data-only; run via a throwaway script against the live DB using the service-role key, same pattern used earlier this session for the surface/VMH backfills — do not commit the script)

**Interfaces:**
- Consumes: the exact table in `docs/superpowers/specs/2026-08-18-reconciliation-produits-assortiment-design.md` under "Rapport de correspondances canoniques" — copy the 56 pairs and 20 `a_qualifier` EANs verbatim, do not re-derive.

- [ ] **Step 1: Write and run a script that, for each of the 56 pairs, sets `produit_canonique_id`, `type_liaison = 'conditionnement_promo'`, `statut_catalogue = 'variante_promo'` on the variant row (by EAN), and confirms the target EAN's own `produit_canonique_id` is null first (trigger will reject otherwise — this is expected safety, not a bug to work around)**

- [ ] **Step 2: For each of the 20 `a_qualifier` EANs, set `statut_catalogue = 'a_qualifier'`**

- [ ] **Step 3: Verify via SQL**

```sql
select count(*) from produits where produit_canonique_id is not null; -- expect 56
select count(*) from produits where statut_catalogue = 'a_qualifier'; -- expect 20
select count(*) from produits where statut_catalogue = 'variante_promo' and produit_canonique_id is null; -- expect 0 (consistency check)
```

- [ ] **Step 4: No commit** (data-only change, nothing to check into git)

---

### Task 8: Engine — canonical resolution at read time + grouped priority

**Files:**
- Modify: `lib/engine/promo-liens.ts`, `lib/engine/priorites.ts`, `lib/engine/fiche-magasin.ts`
- Test: `lib/engine/priorites.test.ts`, `lib/engine/fiche-magasin.test.ts`

**Interfaces:**
- Consumes: `Produit.produit_canonique_id` (Task 1).
- Produces: `resoudreCanonique(produitId: string, produitsParId: Map<string, Produit>): string` in `lib/engine/priorites.ts`, exported for reuse.

- [ ] **Step 1: Write the failing test — statut on a promo variant counts for its canonical**

Add to `lib/engine/priorites.test.ts`:

```ts
it('un statut signalé sur une variante promo compte pour le produit canonique', () => {
  const canonique = produit('c1', { nom: 'Permanent' })
  const variante = produit('v1', { nom: 'Variante promo', produit_canonique_id: 'c1' })
  const produitsParId = new Map([['c1', canonique], ['v1', variante]])
  const m = magasin('1')
  // Statut "manquant" signalé contre v1 (l'EAN promo), pas contre c1.
  const statuts: StatutProduitMagasin[] = [
    { magasin_id: '1', produit_id: 'v1', statut: 'manquant', signale_par: null, signale_at: '', raison_absence: null },
  ]
  const promo = { id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%', date_installation: null, date_debut_vente: '2026-09-01', date_constat: null }
  const promosParProduitId = new Map([['v1', [promo]]])

  const resultats = prioritesSemaine([m], statuts, produitsParId, [], promosParProduitId)
  expect(resultats.some(r => r.produit.id === 'c1')).toBe(true)
})
```

Add `produit_canonique_id` to the existing `produit()` fixture factory in this file (default `null`, overridable) if not already added by Task 2.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/engine/priorites.test.ts -t "compte pour le produit canonique"`
Expected: FAIL — today `prioritesSemaine` looks up `statutsMagasin.get('c1')`, finds nothing (the status was recorded against `v1`), so `c1` never becomes a candidate.

- [ ] **Step 3: Implement `resoudreCanonique` and use it wherever `produit_id` comes from `promo_produits` or is used to key `statuts_produit_magasin`**

In `lib/engine/priorites.ts`, add:

```ts
export function resoudreCanonique(produitId: string, produitsParId: Map<string, Produit>): string {
  return produitsParId.get(produitId)?.produit_canonique_id ?? produitId
}
```

In `prioritesSemaine`, when building `produitIds` and looking up `statutsMagasin`/`promosParProduitId`, resolve every `produitId` sourced from `promosParProduitId`'s keys through `resoudreCanonique` before using it — the loop currently does:

```ts
for (const produitId of produitIds) {
  const produit = produitsParId.get(produitId)
  ...
  const promosApplicables = (promosParProduitId.get(produitId) ?? []).filter(...)
```

Change `promosParProduitId`'s keys themselves to already be canonical-resolved at the call site (in `app/semaine/page.tsx`, `app/equipe/page.tsx`, `lib/engine/fiche-magasin.ts` — wherever the `Map<string, Promo[]>` is built from `PromoLien[]`, per Task's "Files" list) rather than resolving inside `prioritesSemaine` itself — this keeps `prioritesSemaine`'s own signature unchanged and centralizes resolution at data-loading time. Concretely, in each of those 3 call sites, change:

```ts
for (const lien of promoLiens) {
  const liste = promosParProduitId.get(lien.produit_id) ?? []
  liste.push(lien.promos as unknown as Promo)
  promosParProduitId.set(lien.produit_id, liste)
}
```

to:

```ts
for (const lien of promoLiens) {
  const idEffectif = resoudreCanonique(lien.produit_id, produitsParId)
  const liste = promosParProduitId.get(idEffectif) ?? []
  liste.push(lien.promos as unknown as Promo)
  promosParProduitId.set(idEffectif, liste)
}
```

(`produitsParId` must already be built before this loop in each of the 3 files — confirm it is; if not, move the `produits` fetch earlier.)

Also resolve `statuts_produit_magasin` rows the same way in `prioritesSemaine`'s `statutParMagasinEtProduit` construction, since the Auchan La Défense historical status is recorded against the variant EAN:

```ts
const statutParMagasinEtProduit = new Map<string, Map<string, StatutProduit>>()
for (const s of statuts) {
  const idEffectif = resoudreCanonique(s.produit_id, produitsParId)
  if (!statutParMagasinEtProduit.has(s.magasin_id)) statutParMagasinEtProduit.set(s.magasin_id, new Map())
  statutParMagasinEtProduit.get(s.magasin_id)!.set(idEffectif, s.statut)
}
```

- [ ] **Step 4: Run to verify it passes, then run the full priorites test suite**

Run: `npx vitest run lib/engine/priorites.test.ts`
Expected: PASS, including the new test and every pre-existing one (hand-trace: resolution is a no-op when `produit_canonique_id` is null, which is every existing fixture — confirm by running before asserting no regressions).

- [ ] **Step 5: Grouped priority — multiple promo variants of the same canonical produce one candidate, not several**

Add a test proving two different promo-linked variants of the same canonical don't create duplicate entries in `prioritesSemaine`'s output for the same (magasin, canonical produit):

```ts
it('deux variantes promo du même produit canonique ne créent qu\'une seule priorité', () => {
  const canonique = produit('c1')
  const varianteA = produit('vA', { produit_canonique_id: 'c1' })
  const varianteB = produit('vB', { produit_canonique_id: 'c1' })
  const produitsParId = new Map([['c1', canonique], ['vA', varianteA], ['vB', varianteB]])
  const m = magasin('1')
  const promoA = { id: 'pA', code: 'A', enseigne: 'Carrefour', mecanique: 'A', date_installation: null, date_debut_vente: '2026-09-01', date_constat: null, op_trade: 'x' }
  const promoB = { id: 'pB', code: 'B', enseigne: 'Carrefour', mecanique: 'B', date_installation: null, date_debut_vente: '2026-09-05', date_constat: null, op_trade: 'x' }
  const promosParProduitId = new Map([['c1', [promoA, promoB]]]) // déjà résolu au canonique, comme après l'étape 3

  const resultats = prioritesSemaine([m], [], produitsParId, [], promosParProduitId)
  expect(resultats.filter(r => r.produit.id === 'c1')).toHaveLength(1)
})
```

This should already pass given `prioritesSemaine` already picks a single `meilleurCandidat` per `(magasin, produitId)` — confirm with a run rather than assuming; if it fails, the grouping logic in `candidatsPourProduit`/`meilleurCandidat` needs no change since resolution already merges both promos onto `produitId = 'c1'` upstream (Step 3) before `prioritesSemaine` ever sees two separate keys.

- [ ] **Step 6: Apply the same resolution in `lib/engine/fiche-magasin.ts`'s own promo/status loading**

`chargerProduitsATravailler` builds its own `promosParProduit` map from `promo_produits` and its own `statutsSecteur`/`statutParProduit` from `statuts_produit_magasin` — apply `resoudreCanonique` at both construction points, matching Step 3's pattern exactly.

- [ ] **Step 7: Run the full test suite**

Run: `npx vitest run`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add lib/engine/priorites.ts lib/engine/fiche-magasin.ts app/semaine/page.tsx app/equipe/page.tsx lib/engine/priorites.test.ts lib/engine/fiche-magasin.test.ts
git commit -m "feat: résout les EAN promo vers leur produit canonique dans le moteur de priorités"
```

---

### Task 9: Write-time resolution + retire the obligatoire/picking binary

**Files:**
- Modify: `lib/statuts/actions.ts`, `lib/engine/produit-a-travailler.ts`, `app/admin/produits/produit-row.tsx`
- Test: `lib/engine/produit-a-travailler.test.ts`

**Interfaces:**
- Consumes: `resoudreCanonique` (Task 8).

- [ ] **Step 1: Resolve at write time in `updateStatutProduit`**

```ts
export async function updateStatutProduit(magasinId: string, produitId: string, statut: StatutProduit) {
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
  revalidatePath(`/magasins/${magasinId}`)
}
```

- [ ] **Step 2: Remove the "obligatoire" argumentaire phrase**

In `lib/engine/produit-a-travailler.ts`, in `construireArgumentaire`, remove:

```ts
if (typologie === 'obligatoire') {
  phrases.push(`Référencement obligatoire chez ${magasin.enseigne} — son absence est un écart à signaler en priorité.`)
}
```

Remove the `typologie` parameter from `construireArgumentaire` entirely if it's now otherwise unused — check first with `grep -n "typologie" lib/engine/produit-a-travailler.ts`; keep the parameter if `ProduitATravailler.typologie` (the returned field, still used to display the raw code elsewhere) still needs it threaded through.

- [ ] **Step 3: Update the failing/affected tests**

The two `produit-a-travailler.test.ts` tests asserting the old "obligatoire" phrase (`"ouvre l'argumentaire par le rappel de conformité..."` and `"n'ouvre pas par le rappel..."`) test behavior that no longer exists — delete them, don't weaken them.

- [ ] **Step 4: Replace the admin obligatoire/picking `<select>` with free text**

In `app/admin/produits/produit-row.tsx`, replace:

```tsx
<select
  value={typologies.get(e) ?? ''}
  onChange={ev => handleTypologieChange(e, ev.target.value === '' ? null : (ev.target.value as Typologie))}
  className="block text-[10px] border rounded mt-1"
>
  <option value="">Typologie...</option>
  {Object.entries(LIBELLES_TYPOLOGIE).map(([value, label]) => (
    <option key={value} value={value}>{label}</option>
  ))}
  {(() => {
    const valeurActuelle = typologies.get(e)
    if (valeurActuelle && valeurActuelle !== 'obligatoire' && valeurActuelle !== 'picking') {
      return <option value={valeurActuelle}>Valeur héritée : {valeurActuelle}</option>
    }
    return null
  })()}
</select>
```

with:

```tsx
<input
  type="text"
  value={typologies.get(e) ?? ''}
  onChange={ev => handleTypologieChange(e, ev.target.value || null)}
  placeholder="T1, H2, MN..."
  className="block text-[10px] border rounded mt-1 w-16"
/>
```

Remove the now-unused `LIBELLES_TYPOLOGIE` constant and the `Typologie` import if nothing else in the file uses it. Update `handleTypologieChange`'s parameter type from `Typologie | null` to `string | null`.

- [ ] **Step 5: Run `npx tsc --noEmit` and `npx vitest run`**

Expected: zero errors, all tests pass.

- [ ] **Step 6: Verify manually**

Start dev server, open `/admin/produits`, confirm the typologie field is now free text and shows the real imported codes (T1, H2, etc.) for Auchan/Carrefour/Carrefour Market rows.

- [ ] **Step 7: Commit**

```bash
git add lib/statuts/actions.ts lib/engine/produit-a-travailler.ts lib/engine/produit-a-travailler.test.ts app/admin/produits/produit-row.tsx
git commit -m "fix: résout le canonique à l'écriture du statut, retire le flag obligatoire binaire"
```

---

### Task 10: Assortment list — filter `actif`, group by famille → segment → nom → format

**Files:**
- Modify: `app/magasins/[id]/assortiment-table.tsx`, `app/magasins/[id]/page.tsx`, `app/semaine/page.tsx`, `app/equipe/page.tsx`, `lib/engine/fiche-magasin.ts`

**Interfaces:**
- Consumes: `ProduitEnseigne.actif` (Task 1), `Produit.famille`/`Produit.segment` (Task 1), `nomComplet` (Task 3).

- [ ] **Step 1: Filter every `produits_enseigne` read to `actif = true`**

In `app/magasins/[id]/page.tsx`, `app/semaine/page.tsx`, `app/equipe/page.tsx`, `lib/engine/fiche-magasin.ts`, change `.from('produits_enseigne').select('*')` (and the one with `.eq('enseigne', ...)`) to add `.eq('actif', true)`. Leave `app/admin/produits/page.tsx` unfiltered (admin needs to see inactive rows to manage them).

- [ ] **Step 2: Group `assortiment-table.tsx` by famille → segment → nom complet → format**

Read the current implementation first (`app/magasins/[id]/assortiment-table.tsx`) to see the existing flat-list/search rendering built in sub-project 2 — it already renders per-product typologie, EAN, and status controls per row; preserve every one of those, only change the grouping/sorting wrapper around them. Replace the flat `.map()` with a grouped render: build `Map<famille, Map<segment, Produit[]>>` from the (already-filtered, already-searched) product list, sorted by `famille`/`segment` alphabetically with `null` values grouped last under a literal "Sans famille"/"Sans segment" heading, each leaf list sorted by `nomComplet(produit)`. Use `<h3>` for famille, `<h4>` for segment, matching whatever heading level the existing search UI's own `<h2>`/`<h1>` structure implies (don't skip levels). Each product row keeps rendering its typologie value (now free text, e.g. "T1"), its EAN as secondary text, and its existing Présent/Manquant/Rupture controls exactly as before.

- [ ] **Step 3: Verify manually**

Start dev server, open a fiche magasin for a store in an enseigne with real assortment data (e.g. an Auchan store), confirm: products are grouped by famille/segment, OD/+offert variants no longer appear as separate rows, and homonym products (e.g. "Siggi's Nature") show distinct formats.

- [ ] **Step 4: Commit**

```bash
git add app/magasins/[id]/assortiment-table.tsx app/magasins/[id]/page.tsx app/semaine/page.tsx app/equipe/page.tsx lib/engine/fiche-magasin.ts
git commit -m "feat: assortiment filtré (actif) et regroupé par famille/segment"
```

---

### Task 11: Full verification, real import execution, final report

**Files:** none (verification + data operations only)

- [ ] **Step 1: `npx tsc --noEmit`** — expect zero errors.

- [ ] **Step 2: `npx vitest run`** — expect all tests passing; note the total count.

- [ ] **Step 3: `npm run build`** — expect success.

- [ ] **Step 4: Run `previewImportPlanDeVente` then `confirmerImportPlanDeVente` against the real file the user provided (`Plans_de_vente_LNUF_par_enseigne copie.xlsx`), via a throwaway script hitting the real Supabase project with the service-role key** (same pattern as every prior live-data verification this session — Server Actions can't be invoked outside a request context, so replicate their logic directly against the DB).

- [ ] **Step 5: Verify the exact reference counts per enseigne match the spec's table**

```sql
select enseigne, count(*) from produits_enseigne where actif = true group by enseigne order by enseigne;
```

Expected: Auchan 120, Carrefour 123, Carrefour Market 85, Intermarché 103, Leclerc 156, Système U 100. If any count is off, do not proceed to the report — diagnose against the diff computation (Task 5) or the source workbook before declaring success.

- [ ] **Step 6: Verify no OD/+offert EAN remains active in any enseigne's assortment**

```sql
select p.code, p.nom, pe.enseigne from produits_enseigne pe
join produits p on p.id = pe.produit_id
where pe.actif = true and (p.nom ilike '% OD %' or p.nom ilike '%+%offert%');
```

Expected: 0 rows.

- [ ] **Step 7: Produce the final report to the user**, covering exactly what was requested: résumé des modifications, rapport des correspondances canoniques (the 56+20 table, already in the spec — link to it), résultat de l'import par enseigne (from Step 4/5's real output), références encore à qualifier (the 20 EANs), tests exécutés (Step 2's count and what they cover), and a verification of the Leclerc assortment list showing full names and formats (query a sample of ~10 Leclerc rows with `nomComplet` applied, or a screenshot via the browser tool if dev server + a logged-in session are available — if not available, the SQL sample is sufficient, state which was used).

No commit for this task (reporting only); if Steps 1-3 surfaced fixes, those get their own commits within the relevant earlier task, not bundled here.
