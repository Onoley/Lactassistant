# Fiche magasin enrichie — argumentaire, PDL, VMH nationale, typologie — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the fiche magasin into three zones (this store's weekly priorities, a ranked "produits manquants à travailler" section with a full factual argumentaire, and a searchable assortment table), backed by three new data sources: a rep-entered absence reason, a national VMH/DV benchmark imported from a real panel export, and an admin-set "obligatoire/picking" product typology.

**Architecture:** A new composition function `produitATravailler` assembles the already-shipped `importanceProduitFiche`/`actionRecommandee` (sub-project 1) with three new signals (absence reason, national VMH scoped by store format, obligatoire/picking typology) into one factual, ranked argumentaire per missing product. A new `lib/engine/fiche-magasin.ts` loader replaces the sub-project 1 loader entirely. The VMH import reuses the existing `/admin/import` pipeline with a dedicated reader for the panel file's multi-row header structure.

**Tech Stack:** Next.js App Router (Server Components/Actions), Supabase (Postgres), TypeScript, Vitest, SheetJS (`xlsx`) for the panel file.

**Spec:** [docs/superpowers/specs/2026-08-17-fiche-magasin-enrichie-design.md](../specs/2026-08-17-fiche-magasin-enrichie-design.md)

## Global Constraints

- No raw score is ever displayed — always plain-language text (carried over from sub-project 1, reaffirmed by the spec for this new UI).
- `typologie` values are exactly `'obligatoire' | 'picking'` (or `null` = not yet set, treated as `'picking'` — no regression for enseignes the admin hasn't classified yet).
- `raison_absence` values are exactly `'pas_de_place_rayon' | 'frein_prix' | 'jamais_reference' | 'concurrence_privilegiee' | 'autre'` (or `null`).
- VMH import source is the "Vision CAT" sheet only — per-enseigne VMH is not reliably populated in the provided export (0% for Leclerc/Intermarché) and is out of scope.
- A non-commandable product's argumentaire never proposes an order action, even when `typologie === 'obligatoire'` — the non-commandable message always wins (see spec §4.3).
- PDL fields are purely descriptive/manual — not wired into any scoring or ranking in this sub-project.
- Out of scope: visite→synthèse page, comparable-store `surface` field, per-enseigne VMH detail (spec §6).

---

## Task 1: Schema — raison_absence, pdl_magasin, vmh_national + types

**Files:**
- Create: `supabase/migrations/0005_fiche_magasin_enrichie.sql`
- Modify: `lib/types.ts`

**Interfaces:**
- Produces: `StatutProduitMagasin.raison_absence: string | null` (new field), `PdlMagasin` interface, `VmhNational` interface, `Typologie` type alias, `ProduitEnseigne.typologie` typed as `Typologie | null` (was untyped `string | null`) — every later task reads/writes these exact shapes.

- [ ] **Step 1: Write the migration**

```sql
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
```

Save as `supabase/migrations/0005_fiche_magasin_enrichie.sql`.

- [ ] **Step 2: Apply the migration to the live Supabase project**

Apply the SQL above against the project's database (project id `yymriulkcytkbuenorvm`, via the Supabase MCP tools available in this workspace).

- [ ] **Step 3: Verify the schema**

```sql
select table_name, column_name, data_type
from information_schema.columns
where (table_name = 'statuts_produit_magasin' and column_name = 'raison_absence')
   or (table_name = 'pdl_magasin')
   or (table_name = 'vmh_national')
order by table_name, column_name;
```

Expected: `raison_absence` on `statuts_produit_magasin` (text); 6 columns on `pdl_magasin` plus `magasin_id`; 8 columns on `vmh_national` plus `produit_id`.

- [ ] **Step 4: Update `lib/types.ts`**

Replace:

```ts
export interface StatutProduitMagasin {
  magasin_id: string
  produit_id: string
  statut: StatutProduit
  signale_par: string | null
  signale_at: string
}
```

with:

```ts
export interface StatutProduitMagasin {
  magasin_id: string
  produit_id: string
  statut: StatutProduit
  signale_par: string | null
  signale_at: string
  raison_absence: RaisonAbsence | null
}

export type RaisonAbsence = 'pas_de_place_rayon' | 'frein_prix' | 'jamais_reference' | 'concurrence_privilegiee' | 'autre'
```

Replace:

```ts
export interface ProduitEnseigne {
  produit_id: string
  enseigne: string
  typologie: string | null
  statut_disponibilite: StatutDisponibilite
}
```

with:

```ts
export type Typologie = 'obligatoire' | 'picking'

export interface ProduitEnseigne {
  produit_id: string
  enseigne: string
  typologie: Typologie | null
  statut_disponibilite: StatutDisponibilite
}
```

Add at the end of the file:

```ts
export interface PdlMagasin {
  magasin_id: string
  pdl_generale: number | null
  pdl_yaos: number | null
  pdl_siggis: number | null
  pdl_dessert: number | null
  updated_at: string
  updated_by: string | null
}

export interface VmhNational {
  produit_id: string
  vmh_hyper: number | null
  vmh_super: number | null
  dv_hmsm: number | null
  dv_hyper: number | null
  dv_super: number | null
  prix_moyen: number | null
  periode_reference: string | null
  updated_at: string
}
```

- [ ] **Step 5: Verify the project still typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0005_fiche_magasin_enrichie.sql lib/types.ts
git commit -m "feat: add raison_absence, pdl_magasin, vmh_national schema"
```

---

## Task 2: VMH sheet reader + mapper

**Files:**
- Modify: `lib/import/parser.ts`
- Modify: `lib/import/mappers.ts`
- Test: `lib/import/mappers.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `readVmhSheet(buffer: ArrayBuffer): { periodeReference: string; rows: (string | number | null)[][] }` (in `parser.ts`), `mapVmhRow(row: (string | number | null)[]): VmhImport | null` (in `mappers.ts`), `VmhImport` interface. Consumed by Task 3.

The source file (`vmh et produit  2.xlsx`, sheet "Vision CAT") has a structure unlike every other import in this app: the header is on row 4 (not row 1), several columns share the same header label across period variants (so a header-keyed JSON row would silently collide and lose data), and it covers the whole product category, not just LNUF — most EANs will not match any `produits.code`, and that's expected, not an error.

- [ ] **Step 1: Write the failing tests**

Add to `lib/import/mappers.test.ts` (append at the end of the file, add the import at the top):

```ts
import { mapVmhRow } from './mappers'
```

```ts
describe('mapVmhRow', () => {
  // Colonnes 0-indexées, copiées de la ligne 6 réelle de l'onglet "Vision CAT"
  // du fichier "vmh et produit  2.xlsx" (SVELTESSE FERME ET FONDANT CAFE) :
  // 0 Produits, 10 Desc EAN, 11 Prix (Derniere Periode), 15 DV HMSM,
  // 16 DV HM, 17 DV SM, 18 VMH HM (Cumul 3), 20 VMH SM (Cumul 3).
  function ligneReelle(overrides: Partial<Record<number, string | number | null>> = {}): (string | number | null)[] {
    const base: (string | number | null)[] = new Array(34).fill(null)
    base[0] = 'SVELTESSE FERME ET FONDANT CAFE X 4 125 GR STD - 8410100068183'
    base[10] = '8410100068183'
    base[11] = 1.6220223503058064
    base[15] = 41.49097379528104
    base[16] = 59.735929218205705
    base[17] = 21.27722652169616
    base[18] = 9.241001784165155
    base[20] = 3.5875268491463155
    for (const [i, v] of Object.entries(overrides)) base[Number(i)] = v
    return base
  }

  it('extrait les champs pertinents depuis une ligne réelle', () => {
    const result = mapVmhRow(ligneReelle())
    expect(result).not.toBeNull()
    expect(result?.ean).toBe('8410100068183')
    expect(result?.prixMoyen).toBeCloseTo(1.622, 3)
    expect(result?.dvHmsm).toBeCloseTo(41.49, 1)
    expect(result?.dvHyper).toBeCloseTo(59.74, 1)
    expect(result?.dvSuper).toBeCloseTo(21.28, 1)
    expect(result?.vmhHyper).toBeCloseTo(9.24, 1)
    expect(result?.vmhSuper).toBeCloseTo(3.59, 1)
  })

  it('ignore une ligne sans EAN (ligne de sous-total ou vide)', () => {
    expect(mapVmhRow(ligneReelle({ 10: null }))).toBeNull()
  })

  it('ignore une ligne avec un EAN non numérique ("#N/A", placeholder Nielsen)', () => {
    expect(mapVmhRow(ligneReelle({ 10: '#N/A' }))).toBeNull()
  })

  it('renvoie null pour les métriques absentes plutôt que NaN ou 0', () => {
    const result = mapVmhRow(ligneReelle({ 18: null, 20: null }))
    expect(result?.vmhHyper).toBeNull()
    expect(result?.vmhSuper).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/import/mappers.test.ts`
Expected: FAIL — `mapVmhRow is not exported`

- [ ] **Step 3: Add `readVmhSheet` to `lib/import/parser.ts`**

Append at the end of the file:

```ts
export function readVmhSheet(buffer: ArrayBuffer): { periodeReference: string; rows: (string | number | null)[][] } {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets['Vision CAT']
  if (!sheet) throw new Error('Onglet "Vision CAT" introuvable dans le fichier')

  const periodeCell = sheet['M5']
  const periodeReference = periodeCell ? String(periodeCell.v ?? '').trim() : ''

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 5, raw: true, defval: null }) as (string | number | null)[][]

  return { periodeReference, rows }
}
```

- [ ] **Step 4: Add `mapVmhRow` to `lib/import/mappers.ts`**

Append at the end of the file:

```ts
export interface VmhImport {
  ean: string
  vmhHyper: number | null
  vmhSuper: number | null
  dvHmsm: number | null
  dvHyper: number | null
  dvSuper: number | null
  prixMoyen: number | null
}

function versNombreOuNull(valeur: string | number | null): number | null {
  if (valeur === null || valeur === '') return null
  const n = Number(valeur)
  return Number.isFinite(n) ? n : null
}

// Lit une ligne de l'onglet "Vision CAT" (colonnes 0-indexées) : couvre toute
// la catégorie, pas seulement LNUF — une ligne sans EAN exploitable (blanche
// ou placeholder Nielsen "#N/A") est silencieusement ignorée, ce n'est pas
// une erreur d'import. Le rapprochement avec produits.code (et le rejet
// silencieux des EAN non trouvés) se fait au niveau de l'action d'import.
export function mapVmhRow(row: (string | number | null)[]): VmhImport | null {
  const eanBrut = row[10]
  const ean = eanBrut !== null && eanBrut !== undefined ? String(eanBrut).trim() : ''
  if (!/^[0-9]{8,14}$/.test(ean)) return null

  return {
    ean,
    vmhHyper: versNombreOuNull(row[18]),
    vmhSuper: versNombreOuNull(row[20]),
    dvHmsm: versNombreOuNull(row[15]),
    dvHyper: versNombreOuNull(row[16]),
    dvSuper: versNombreOuNull(row[17]),
    prixMoyen: versNombreOuNull(row[11]),
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/import/mappers.test.ts`
Expected: PASS (all `mapVmhRow` tests, plus the pre-existing `mapMagasinRow`/`mapProduitRow`/`mapPromoRows` tests still green)

- [ ] **Step 6: Verify against the real file**

Write a throwaway script (do not commit it) to confirm the reader and mapper work against the actual file, not just the synthetic fixture:

```ts
// scratch: verify-vmh-mapper.ts (delete after running)
import { readFileSync } from 'fs'
import { readVmhSheet } from './lib/import/parser'
import { mapVmhRow } from './lib/import/mappers'

const buffer = readFileSync('/Users/honoreschlesser/Desktop/Ressources Lactassistant/vmh et produit  2.xlsx')
const { periodeReference, rows } = readVmhSheet(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
console.log('periodeReference:', periodeReference)
console.log('total rows:', rows.length)
const mapped = rows.map(mapVmhRow).filter((v): v is NonNullable<typeof v> => v !== null)
console.log('rows with a usable EAN:', mapped.length)
console.log('sample:', mapped[0])
```

Run: `npx tsx scratch/verify-vmh-mapper.ts` (adjust the relative import paths to match wherever the script is placed)
Expected: `periodeReference` reads `"Cumul 3 Dernieres Periodes du 23-02-2026 au 17-05-2026"`, `total rows` around 2519 (2525 rows minus the 6 header/period rows already skipped by `range: 5`), `rows with a usable EAN` around 1524. Delete the script when done.

- [ ] **Step 7: Commit**

```bash
git add lib/import/parser.ts lib/import/mappers.ts lib/import/mappers.test.ts
git commit -m "feat: add VMH panel sheet reader and row mapper"
```

---

## Task 3: VMH import action + admin UI

**Files:**
- Modify: `lib/import/actions.ts`
- Modify: `app/admin/import/page.tsx`

**Interfaces:**
- Consumes: `readVmhSheet`, `mapVmhRow`, `VmhImport` (Task 2).
- Produces: `importVmh(formData: FormData): Promise<ImportSummary>` server action.

- [ ] **Step 1: Add `importVmh` to `lib/import/actions.ts`**

Add this import at the top, alongside the existing ones:

```ts
import { readSpreadsheet, readVmhSheet, parseRows, type ImportError } from './parser'
import { mapMagasinRow, mapProduitRow, mapPromoRows, mapVmhRow } from './mappers'
```

Append at the end of the file:

```ts
export async function importVmh(formData: FormData): Promise<ImportSummary> {
  await assertAdmin()
  const file = formData.get('file') as File
  const { periodeReference, rows } = readVmhSheet(await file.arrayBuffer())

  const mapped = rows.map(mapVmhRow).filter((v): v is NonNullable<typeof v> => v !== null)

  const admin = createAdminClient()
  const { data: produits } = await admin.from('produits').select('id, code')
  const produitIdByEan = new Map((produits ?? []).map(p => [p.code, p.id]))

  const upserts = mapped
    .map(v => {
      const produitId = produitIdByEan.get(v.ean)
      if (!produitId) return null
      return {
        produit_id: produitId,
        vmh_hyper: v.vmhHyper,
        vmh_super: v.vmhSuper,
        dv_hmsm: v.dvHmsm,
        dv_hyper: v.dvHyper,
        dv_super: v.dvSuper,
        prix_moyen: v.prixMoyen,
        periode_reference: periodeReference,
        updated_at: new Date().toISOString(),
      }
    })
    .filter((v): v is NonNullable<typeof v> => v !== null)

  if (upserts.length > 0) {
    const { error } = await admin.from('vmh_national').upsert(upserts, { onConflict: 'produit_id' })
    if (error) throw error
  }

  // EAN sans correspondance dans le catalogue (la plupart des 1524 lignes du
  // fichier : c'est un export panel toute catégorie, pas seulement LNUF) —
  // ignoré silencieusement par design, ce n'est pas une erreur d'import.
  return { imported: upserts.length, errors: [] }
}
```

- [ ] **Step 2: Wire it into `/admin/import`**

In `app/admin/import/page.tsx`, update the import line:

```tsx
import { importMagasins, importProduits, importPromos, importVmh, type ImportSummary } from '@/lib/import/actions'
```

Add this block after the existing `<ImportForm label="Promos ...">` block, before the closing `</div>`:

```tsx
      <ImportForm label="VMH national (export panel)" action={importVmh} />
```

- [ ] **Step 3: Verify the project typechecks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification in the browser**

Start the dev server, log in as admin, go to `/admin/import`, upload the real file (`/Users/honoreschlesser/Desktop/Ressources Lactassistant/vmh et produit  2.xlsx`) to the new "VMH national" form. Confirm the summary shows roughly 235 imported rows (the number of products already in `produits` whose EAN appears in the file — check the live count with `select count(*) from vmh_national;` via the Supabase MCP tools) and zero errors displayed.

- [ ] **Step 5: Commit**

```bash
git add lib/import/actions.ts app/admin/import/page.tsx
git commit -m "feat: wire VMH import into admin import page"
```

---

## Task 4: `vmhPertinent` — VMH scoped by store format

**Files:**
- Create: `lib/engine/vmh.ts`
- Test: `lib/engine/vmh.test.ts`

**Interfaces:**
- Consumes: `Magasin` (`lib/types.ts`), `VmhNational` (Task 1).
- Produces: `vmhPertinent(magasin: Magasin, vmhNational: VmhNational | null): { vmh: number | null; dv: number | null } | null`. Consumed by Task 5.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { vmhPertinent } from './vmh'
import type { Magasin, VmhNational } from '@/lib/types'

function magasin(taille: string): Magasin {
  return { id: '1', code: '1', nom: 'Test', enseigne: 'Carrefour', taille, adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null }
}

const vmh: VmhNational = {
  produit_id: 'p1', vmh_hyper: 9.2, vmh_super: 3.6, dv_hmsm: 41.5, dv_hyper: 59.7, dv_super: 21.3, prix_moyen: 1.6, periode_reference: null, updated_at: '',
}

describe('vmhPertinent', () => {
  it('renvoie null si aucune ligne vmh_national pour ce produit', () => {
    expect(vmhPertinent(magasin('hyper'), null)).toBeNull()
  })

  it('sélectionne les colonnes hyper pour un magasin hyper', () => {
    expect(vmhPertinent(magasin('hyper'), vmh)).toEqual({ vmh: 9.2, dv: 59.7 })
  })

  it('sélectionne les colonnes super pour un magasin super', () => {
    expect(vmhPertinent(magasin('super'), vmh)).toEqual({ vmh: 3.6, dv: 21.3 })
  })

  it('replie sur le DV HMSM combiné pour proxi/drive, sans VMH (non ventilé dans le panel)', () => {
    expect(vmhPertinent(magasin('proxi'), vmh)).toEqual({ vmh: null, dv: 41.5 })
    expect(vmhPertinent(magasin('drive'), vmh)).toEqual({ vmh: null, dv: 41.5 })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run lib/engine/vmh.test.ts`
Expected: FAIL — `Cannot find module './vmh'`

- [ ] **Step 3: Write the implementation**

```ts
import type { Magasin, VmhNational } from '@/lib/types'

export function vmhPertinent(
  magasin: Magasin,
  vmhNational: VmhNational | null
): { vmh: number | null; dv: number | null } | null {
  if (!vmhNational) return null
  if (magasin.taille === 'hyper') return { vmh: vmhNational.vmh_hyper, dv: vmhNational.dv_hyper }
  if (magasin.taille === 'super') return { vmh: vmhNational.vmh_super, dv: vmhNational.dv_super }
  // proxi/drive : le panel ne ventile pas le VMH pour ces formats.
  return { vmh: null, dv: vmhNational.dv_hmsm }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run lib/engine/vmh.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/engine/vmh.ts lib/engine/vmh.test.ts
git commit -m "feat: add vmhPertinent format-scoped VMH selection"
```

---

## Task 5: `produitATravailler` — the composition function

**Files:**
- Modify: `lib/engine/importance-produit.ts:64` (export `promoPrincipale`)
- Create: `lib/engine/produit-a-travailler.ts`
- Test: `lib/engine/produit-a-travailler.test.ts`

**Interfaces:**
- Consumes: `importanceProduitFiche`, `promoPrincipale` (`lib/engine/importance-produit.ts`, the second newly exported), `actionRecommandee`/`ActionRecommandee` (`lib/engine/action-recommandee.ts`), `vmhPertinent` (Task 4), `NiveauPriorite` (`lib/engine/priorites.ts`), `Rang`/`CritereSimilarite` (existing), `RaisonAbsence`/`Typologie`/`VmhNational` (Task 1).
- Produces: `ProduitATravailler` interface, `produitATravailler(...)` function. Consumed by Task 6.

This is the central new piece: it composes the sub-project 1 engine (unchanged) with the three new signals from this sub-project into one factual argumentaire, following the exact rules in spec §4.3.

- [ ] **Step 1: Export `promoPrincipale` from `importance-produit.ts`**

In `lib/engine/importance-produit.ts:64`, change:

```ts
function promoPrincipale(promosScoped: Promo[], aujourdHui: Date): { promo: Promo; stade: StadePromo } | null {
```

to:

```ts
export function promoPrincipale(promosScoped: Promo[], aujourdHui: Date): { promo: Promo; stade: StadePromo } | null {
```

This is needed because `produitATravailler` must know a product's promo/stade even when `rang` is `null` (so `importanceProduitFiche`, which requires a `Rang`, cannot be called) — reusing this existing selection logic avoids duplicating it.

- [ ] **Step 2: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { produitATravailler } from './produit-a-travailler'
import type { Magasin, Produit, Promo, StatutProduit, VmhNational } from '@/lib/types'

function magasin(overrides: Partial<Magasin> = {}): Magasin {
  return { id: '1', code: '1', nom: 'Magasin Test', enseigne: 'Carrefour', taille: 'hyper', adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null, ...overrides }
}

const produit: Produit = { id: 'p1', code: 'P1', nom: 'Yaourt Nature', categorie: null }

describe('produitATravailler', () => {
  it("n'affiche jamais d'action de commande pour un produit non commandable, meme obligatoire", () => {
    const result = produitATravailler(
      magasin(), produit, 20, 'obligatoire', 'manquant', null, 'arret_industriel',
      [], new Map(), [], null, 'les_deux', null
    )
    expect(result.actionRecommandee).toBe('aucune_action_commande')
    expect(result.argumentaire).toContain('non commandable')
    expect(result.argumentaire).not.toContain('obligatoire')
  })

  it("ouvre l'argumentaire par le rappel de conformité pour un produit obligatoire commandable", () => {
    const result = produitATravailler(
      magasin(), produit, 20, 'obligatoire', 'manquant', null, 'commandable',
      [], new Map(), [], null, 'les_deux', null
    )
    expect(result.argumentaire).toContain('Référencement obligatoire chez Carrefour')
  })

  it("n'ouvre pas par le rappel de conformité pour un produit picking", () => {
    const result = produitATravailler(
      magasin(), produit, 20, 'picking', 'manquant', null, 'commandable',
      [], new Map(), [], null, 'les_deux', null
    )
    expect(result.argumentaire).not.toContain('obligatoire')
  })

  it('intègre le VMH national quand disponible, scopé au format hyper', () => {
    const vmh: VmhNational = { produit_id: 'p1', vmh_hyper: 9.2, vmh_super: 3.6, dv_hmsm: 41.5, dv_hyper: 59.7, dv_super: 21.3, prix_moyen: 1.6, periode_reference: null, updated_at: '' }
    const result = produitATravailler(
      magasin({ taille: 'hyper' }), produit, 20, null, 'manquant', null, 'commandable',
      [], new Map(), [], vmh, 'les_deux', null
    )
    expect(result.vmhNational).toEqual({ vmh: 9.2, dv: 59.7 })
    expect(result.argumentaire).toContain('9.2 unités/semaine')
    expect(result.argumentaire).toContain('60 % des hypers')
  })

  it('ne mentionne pas le VMH quand aucune ligne vmh_national pour ce produit', () => {
    const result = produitATravailler(
      magasin(), produit, 20, null, 'manquant', null, 'commandable',
      [], new Map(), [], null, 'les_deux', null
    )
    expect(result.vmhNational).toBeNull()
    expect(result.argumentaire).not.toContain('national')
  })

  it('intègre la raison d\'absence dans l\'argumentaire et les questions de découverte', () => {
    const result = produitATravailler(
      magasin(), produit, 20, null, 'manquant', 'pas_de_place_rayon', 'commandable',
      [], new Map(), [], null, 'les_deux', null
    )
    expect(result.argumentaire).toContain('pas de place en rayon')
    expect(result.questionsDecouverte.length).toBeGreaterThan(0)
    expect(result.questionsDecouverte[0]).toContain('rotation')
  })

  it('utilise des questions génériques quand la raison d\'absence est inconnue', () => {
    const result = produitATravailler(
      magasin(), produit, 20, null, 'manquant', null, 'commandable',
      [], new Map(), [], null, 'les_deux', null
    )
    expect(result.questionsDecouverte.length).toBeGreaterThan(0)
  })

  it('fonctionne sans rang assigné : raisons/comparables vides mais promo et VMH toujours pris en compte', () => {
    const promo: Promo = { id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%', date_installation: null, date_debut_vente: '2026-09-01', date_constat: null }
    const result = produitATravailler(
      magasin(), produit, null, null, 'manquant', null, 'commandable',
      [], new Map(), [promo], null, 'les_deux', null
    )
    expect(result.rang).toBeNull()
    expect(result.raisons).toEqual([])
    expect(result.presentsChezComparables).toEqual({ total: 0, presents: 0 })
    expect(result.argumentaire).toContain('-20%')
  })

  it('reporte le niveau hebdomadaire tel quel comme momentum', () => {
    const result = produitATravailler(
      magasin(), produit, 20, null, 'manquant', null, 'commandable',
      [], new Map(), [], null, 'les_deux', 'urgent'
    )
    expect(result.momentum).toBe('urgent')
  })

  it('conclut toujours par l\'action recommandée quand une commande est possible', () => {
    const result = produitATravailler(
      magasin(), produit, 20, null, 'manquant', null, 'commandable',
      [], new Map(), [], null, 'les_deux', null
    )
    expect(result.argumentaire).toMatch(/→ .+, à valider au prochain passage\.$/)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run lib/engine/produit-a-travailler.test.ts`
Expected: FAIL — `Cannot find module './produit-a-travailler'`

- [ ] **Step 4: Write the implementation**

```ts
import type { Magasin, Produit, Promo, RaisonAbsence, StatutDisponibilite, StatutProduit, Typologie, VmhNational } from '@/lib/types'
import { importanceProduitFiche, promoPrincipale } from './importance-produit'
import type { CritereSimilarite } from './similarity'
import type { Rang } from './scoring'
import { actionRecommandee, type ActionRecommandee } from './action-recommandee'
import type { NiveauPriorite } from './priorites'
import { vmhPertinent } from './vmh'

export interface ProduitATravailler {
  produit: Produit
  rang: 20 | 50 | 70 | null
  typologie: Typologie | null
  raisons: string[]
  presentsChezComparables: { total: number; presents: number }
  vmhNational: { vmh: number | null; dv: number | null } | null
  raisonAbsence: RaisonAbsence | null
  argumentaire: string
  questionsDecouverte: string[]
  actionRecommandee: ActionRecommandee
  momentum: NiveauPriorite | null
  score: number  // usage interne uniquement, jamais affiché tel quel — sert au tri
}

const LIBELLE_RAISON: Record<RaisonAbsence, string> = {
  pas_de_place_rayon: 'pas de place en rayon',
  frein_prix: 'frein prix',
  jamais_reference: 'jamais référencé',
  concurrence_privilegiee: 'concurrence privilégiée',
  autre: 'autre frein',
}

const LIBELLE_ACTION: Record<ActionRecommandee, string> = {
  faire_entrer: 'Faire entrer le produit',
  securiser_commande: 'Sécuriser la commande',
  preparer_implantation: "Préparer l'implantation",
  verifier_participation: "Vérifier la participation à l'opération",
  tester: 'Proposer un test',
  preparer_dossier_referencement: 'Préparer le dossier de référencement',
  aucune_action_commande: 'Aucune action de commande possible',
}

const QUESTIONS_PAR_RAISON: Record<RaisonAbsence, string[]> = {
  pas_de_place_rayon: [
    'Quel produit fait le moins de rotation dans ce rayon actuellement ?',
    'Y a-t-il un rayon secondaire ou une tête de gondole disponible ?',
  ],
  frein_prix: [
    'Quel est le prix psychologique attendu par le client sur ce segment ?',
    'Une opération prix ponctuelle serait-elle envisageable ?',
  ],
  jamais_reference: [
    "Qu'est-ce qui bloque le référencement initial : espace, centrale, autre ?",
    'Le rayon actuel couvre-t-il déjà ce segment via un concurrent ?',
  ],
  concurrence_privilegiee: [
    "Qu'est-ce qui différencie l'offre concurrente actuellement en rayon ?",
    'Un test comparatif sur linéaire serait-il possible ?',
  ],
  autre: ['Quel est le principal frein perçu par le magasin sur ce produit ?'],
}

const QUESTIONS_GENERIQUES = [
  'Ce produit a-t-il déjà été référencé dans ce magasin par le passé ?',
  'Quel est le principal frein perçu par le magasin sur ce produit ?',
]

function questionsDecouverte(raisonAbsence: RaisonAbsence | null): string[] {
  return raisonAbsence ? QUESTIONS_PAR_RAISON[raisonAbsence] : QUESTIONS_GENERIQUES
}

function messagePromoSansRang(promo: Promo): string {
  const installation = promo.date_installation ? `installation le ${promo.date_installation}, ` : ''
  const prefixe = promo.op_trade ? '[OP Trade] ' : ''
  return `${prefixe}Promo "${promo.mecanique}" chez ${promo.enseigne} : ${installation}vente le ${promo.date_debut_vente}.`
}

function construireArgumentaire(
  typologie: Typologie | null,
  magasin: Magasin,
  raisons: string[],
  promoInfo: ReturnType<typeof promoPrincipale>,
  vmh: { vmh: number | null; dv: number | null } | null,
  raisonAbsence: RaisonAbsence | null,
  action: ActionRecommandee
): string {
  if (action === 'aucune_action_commande') {
    return 'Produit non commandable actuellement — aucune action de commande possible.'
  }

  const phrases: string[] = []
  if (typologie === 'obligatoire') {
    phrases.push(`Référencement obligatoire chez ${magasin.enseigne} — son absence est un écart à signaler en priorité.`)
  }
  if (raisons.length > 0) {
    phrases.push(...raisons)
  } else if (promoInfo) {
    phrases.push(messagePromoSansRang(promoInfo.promo))
  }
  if (vmh && (vmh.vmh !== null || vmh.dv !== null)) {
    const formatLabel = magasin.taille === 'hyper' ? 'hypers' : magasin.taille === 'super' ? 'supers' : 'magasins'
    const parts: string[] = []
    if (vmh.vmh !== null) parts.push(`tourne à ${vmh.vmh.toFixed(1)} unités/semaine en moyenne`)
    if (vmh.dv !== null) parts.push(`est référencé par ${vmh.dv.toFixed(0)} % des ${formatLabel} au national`)
    if (parts.length > 0) phrases.push(`Au national, ce produit ${parts.join(' et ')}.`)
  }
  if (raisonAbsence) {
    phrases.push(`Frein identifié : ${LIBELLE_RAISON[raisonAbsence]}.`)
  }
  phrases.push(`→ ${LIBELLE_ACTION[action]}, à valider au prochain passage.`)

  return phrases.join(' ')
}

export function produitATravailler(
  magasin: Magasin,
  produit: Produit,
  rang: Rang | null,
  typologie: Typologie | null,
  statutProduitMagasin: StatutProduit,
  raisonAbsence: RaisonAbsence | null,
  statutDisponibilite: StatutDisponibilite,
  magasinsComparables: Magasin[],
  statutsComparables: Map<string, StatutProduit>,
  promosDuProduit: Promo[],
  vmhNational: VmhNational | null,
  critere: CritereSimilarite,
  niveauHebdo: NiveauPriorite | null,
  aujourdHui: Date = new Date()
): ProduitATravailler {
  const promosScoped = promosDuProduit.filter(p => p.enseigne === magasin.enseigne)
  const promoInfo = promoPrincipale(promosScoped, aujourdHui)

  const importance = rang !== null
    ? importanceProduitFiche(magasin, produit, rang, magasinsComparables, statutsComparables, promosDuProduit, critere, aujourdHui)
    : null

  const vmh = vmhPertinent(magasin, vmhNational)
  const action = actionRecommandee(statutDisponibilite, promoInfo?.stade ?? null, statutProduitMagasin)
  const argumentaire = construireArgumentaire(typologie, magasin, importance?.raisons ?? [], promoInfo, vmh, raisonAbsence, action)

  return {
    produit,
    rang,
    typologie,
    raisons: importance?.raisons ?? [],
    presentsChezComparables: importance?.presentsChezComparables ?? { total: 0, presents: 0 },
    vmhNational: vmh,
    raisonAbsence,
    argumentaire,
    questionsDecouverte: questionsDecouverte(raisonAbsence),
    actionRecommandee: action,
    momentum: niveauHebdo,
    score: importance?.score ?? 0,
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run lib/engine/produit-a-travailler.test.ts lib/engine/importance-produit.test.ts`
Expected: PASS (11 new tests, and the existing `importance-produit.test.ts` suite still green after the `promoPrincipale` export)

- [ ] **Step 6: Commit**

```bash
git add lib/engine/importance-produit.ts lib/engine/produit-a-travailler.ts lib/engine/produit-a-travailler.test.ts
git commit -m "feat: add produitATravailler composition (argumentaire, questions, momentum)"
```

---

## Task 6: Rewrite `lib/engine/fiche-magasin.ts`

**Files:**
- Modify: `lib/engine/fiche-magasin.ts` (full rewrite)

**Interfaces:**
- Consumes: `produitATravailler`/`ProduitATravailler` (Task 5), `prioritesSemaine` (existing), `Typologie`/`RaisonAbsence`/`VmhNational` (Task 1).
- Produces: `chargerProduitsATravailler(magasinId: string, critere?: CritereSimilarite): Promise<ProduitATravailler[]>` — replaces `chargerArgumentsFicheMagasin`/`LigneProduitImportance` entirely (deleted, no compatibility wrapper — same policy as sub-project 1's `calculerPrioritesMagasins` removal). Consumed by Task 9 (`app/magasins/[id]/page.tsx`).

Sorting: `typologie === 'obligatoire'` products always come first (compliance gaps are never buried under a lower-ranked picking product), then by the existing `importanceProduitFiche` score, descending — matching spec §5 point 2 exactly.

- [ ] **Step 1: Replace the full content of `lib/engine/fiche-magasin.ts`**

```ts
import { createServerClient } from '@/lib/supabase/server'
import { produitATravailler, type ProduitATravailler } from './produit-a-travailler'
import { prioritesSemaine } from './priorites'
import type { CritereSimilarite } from './similarity'
import type { Produit, Promo, RaisonAbsence, StatutProduit, Typologie, VmhNational } from '@/lib/types'

export async function chargerProduitsATravailler(
  magasinId: string,
  critere: CritereSimilarite = 'les_deux'
): Promise<ProduitATravailler[]> {
  const supabase = createServerClient()
  const { data: magasin } = await supabase.from('magasins').select('*').eq('id', magasinId).single()
  if (!magasin) return []

  const [{ data: produits }, { data: statuts }, { data: priorites }, { data: produitsEnseigne }] = await Promise.all([
    supabase.from('produits').select('*'),
    supabase.from('statuts_produit_magasin').select('*').eq('magasin_id', magasinId),
    supabase.from('priorites_produits').select('*'),
    supabase.from('produits_enseigne').select('*').eq('enseigne', magasin.enseigne),
  ])

  const prioriteParProduit = new Map((priorites ?? []).map(p => [p.produit_id, p]))
  const produitEnseigneParProduit = new Map((produitsEnseigne ?? []).map(pe => [pe.produit_id, pe]))
  const statutParProduit = new Map((statuts ?? []).map(s => [s.produit_id, s]))
  const manquants = (produits ?? []).filter(p => {
    const s = statutParProduit.get(p.id)?.statut
    return s === 'manquant' || s === 'rupture'
  })
  if (manquants.length === 0) return []

  // Comparaison "magasins comparables" limitée au secteur du magasin consulté
  // (pas au parc national) — RLS autorise déjà un commercial/manager à lire
  // les autres magasins et statuts de son propre secteur, pas besoin du
  // client admin ici.
  const [{ data: magasinsSecteur }] = await Promise.all([
    supabase.from('magasins').select('*').eq('secteur_id', magasin.secteur_id),
  ])
  const { data: statutsSecteur } = await supabase
    .from('statuts_produit_magasin')
    .select('*')
    .in('magasin_id', (magasinsSecteur ?? []).map(m => m.id))
    .in('produit_id', manquants.map(p => p.id))
  const { data: promoLiens } = await supabase
    .from('promo_produits')
    .select('produit_id, promos(*)')
    .in('produit_id', manquants.map(p => p.id))
  const { data: vmhLignes } = await supabase
    .from('vmh_national')
    .select('*')
    .in('produit_id', manquants.map(p => p.id))

  const promosParProduit = new Map<string, Promo[]>()
  for (const lien of promoLiens ?? []) {
    const liste = promosParProduit.get(lien.produit_id) ?? []
    liste.push(lien.promos as unknown as Promo)
    promosParProduit.set(lien.produit_id, liste)
  }
  const vmhParProduit = new Map((vmhLignes ?? []).map(v => [v.produit_id, v as VmhNational]))

  // Momentum : le niveau hebdomadaire de ce magasin, si ce produit y figure.
  const produitsParId = new Map((produits ?? []).map(p => [p.id, p as Produit]))
  const prioritesHebdoMagasin = prioritesSemaine(
    [magasin], statuts ?? [], produitsParId, produitsEnseigne ?? [], promosParProduit
  )
  const niveauParProduit = new Map(prioritesHebdoMagasin.map(p => [p.produit.id, p.niveau]))

  return manquants
    .map(produit => {
      const priorite = prioriteParProduit.get(produit.id)
      const statut = statutParProduit.get(produit.id)!
      const produitEnseigne = produitEnseigneParProduit.get(produit.id)

      const statutsPourCeProduit = new Map<string, StatutProduit>(
        (statutsSecteur ?? []).filter(s => s.produit_id === produit.id).map(s => [s.magasin_id, s.statut as StatutProduit])
      )

      return produitATravailler(
        magasin,
        produit,
        (priorite?.rang as 20 | 50 | 70 | undefined) ?? null,
        (produitEnseigne?.typologie as Typologie | null) ?? null,
        statut.statut,
        (statut.raison_absence as RaisonAbsence | null) ?? null,
        produitEnseigne?.statut_disponibilite ?? 'commandable',
        magasinsSecteur ?? [],
        statutsPourCeProduit,
        promosParProduit.get(produit.id) ?? [],
        vmhParProduit.get(produit.id) ?? null,
        critere,
        niveauParProduit.get(produit.id) ?? null
      )
    })
    .sort((a, b) => {
      const aObligatoire = a.typologie === 'obligatoire' ? 1 : 0
      const bObligatoire = b.typologie === 'obligatoire' ? 1 : 0
      return aObligatoire !== bObligatoire ? bObligatoire - aObligatoire : b.score - a.score
    })
}
```

- [ ] **Step 2: Verify the project typechecks**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `app/magasins/[id]/page.tsx` (it still imports the now-deleted `chargerArgumentsFicheMagasin`/`LigneProduitImportance`) — Task 9-11 fix that. No errors anywhere else.

- [ ] **Step 3: Commit**

```bash
git add lib/engine/fiche-magasin.ts
git commit -m "feat: rewrite fiche-magasin loader around produitATravailler"
```

---

## Task 7: Commercial actions — raison d'absence + PDL

**Files:**
- Modify: `lib/statuts/actions.ts`
- Create: `lib/pdl/actions.ts`

**Interfaces:**
- Produces: `definirRaisonAbsence(magasinId: string, produitId: string, raison: RaisonAbsence | null): Promise<void>`, `definirPdl(magasinId: string, champ: 'pdl_generale' | 'pdl_yaos' | 'pdl_siggis' | 'pdl_dessert', valeur: number | null): Promise<void>`. Consumed by Task 10.

Both are RLS-scoped (`createServerClient`, not the admin client) since they're commercial-facing, matching the existing `updateStatutProduit` pattern.

- [ ] **Step 1: Add `definirRaisonAbsence` to `lib/statuts/actions.ts`**

Add this import at the top:

```ts
import type { RaisonAbsence, StatutProduit } from '@/lib/types'
```

(replaces the existing `import type { StatutProduit } from '@/lib/types'` line — add `RaisonAbsence` to the same import)

Append at the end of the file:

```ts
export async function definirRaisonAbsence(magasinId: string, produitId: string, raison: RaisonAbsence | null) {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) throw new Error('Non authentifié')

  const { error } = await supabase.from('statuts_produit_magasin')
    .update({ raison_absence: raison })
    .eq('magasin_id', magasinId)
    .eq('produit_id', produitId)
  if (error) throw error
  revalidatePath(`/magasins/${magasinId}`)
}
```

- [ ] **Step 2: Create `lib/pdl/actions.ts`**

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'

type ChampPdl = 'pdl_generale' | 'pdl_yaos' | 'pdl_siggis' | 'pdl_dessert'

export async function definirPdl(magasinId: string, champ: ChampPdl, valeur: number | null) {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) throw new Error('Non authentifié')

  const { error } = await supabase.from('pdl_magasin').upsert(
    { magasin_id: magasinId, [champ]: valeur, updated_at: new Date().toISOString(), updated_by: profile.id },
    { onConflict: 'magasin_id' }
  )
  if (error) throw error
  revalidatePath(`/magasins/${magasinId}`)
}
```

- [ ] **Step 3: Verify the project typechecks**

Run: `npx tsc --noEmit`
Expected: same pre-existing errors as after Task 6 (still only `app/magasins/[id]/page.tsx`), no new ones.

- [ ] **Step 4: Commit**

```bash
git add lib/statuts/actions.ts lib/pdl/actions.ts
git commit -m "feat: add definirRaisonAbsence and definirPdl commercial actions"
```

---

## Task 8: Admin — typologie obligatoire/picking selector

**Files:**
- Modify: `lib/produits/actions.ts`
- Modify: `app/admin/produits/produit-row.tsx`
- Modify: `app/admin/produits/produits-table.tsx`

**Interfaces:**
- Produces: `definirTypologie(produitId: string, enseigne: string, typologie: Typologie | null): Promise<void>` server action.

- [ ] **Step 1: Add `definirTypologie` to `lib/produits/actions.ts`**

Change the type import line:

```ts
import type { StatutDisponibilite, Typologie } from '@/lib/types'
```

Append at the end of the file:

```ts
export async function definirTypologie(produitId: string, enseigne: string, typologie: Typologie | null) {
  await assertAdmin()
  const admin = createAdminClient()
  const { error } = await admin.from('produits_enseigne')
    .update({ typologie })
    .eq('produit_id', produitId)
    .eq('enseigne', enseigne)
  if (error) throw error
  revalidatePath('/admin/produits')
}
```

- [ ] **Step 2: Extend `app/admin/produits/produit-row.tsx`**

Change the imports:

```tsx
'use client'
import { useState, useTransition } from 'react'
import { definirAssortiment, definirPriorite, definirStatutDisponibilite, definirTypologie, supprimerProduit } from '@/lib/produits/actions'
import { ENSEIGNES, type Produit, type StatutDisponibilite, type Typologie } from '@/lib/types'

const LIBELLES_STATUT: Record<StatutDisponibilite, string> = {
  commandable: 'Commandable',
  non_commandable: 'Non commandable (déréférencé)',
  arret_industriel: 'Arrêt industriel',
  en_attente_referencement: 'En attente de référencement',
}

const LIBELLES_TYPOLOGIE: Record<Typologie, string> = {
  obligatoire: 'Obligatoire',
  picking: 'Picking',
}
```

Update the component signature and add a `typologie` state, mirroring the existing `statuts` state:

```tsx
export function ProduitRow({
  produit,
  enseignesActuelles,
  rangActuel,
  statutParEnseigne,
  typologieParEnseigne,
}: {
  produit: Produit
  enseignesActuelles: Set<string>
  rangActuel: 20 | 50 | 70 | null
  statutParEnseigne: Map<string, StatutDisponibilite>
  typologieParEnseigne: Map<string, Typologie | null>
}) {
  const [enseignes, setEnseignes] = useState(enseignesActuelles)
  const [rang, setRang] = useState(rangActuel)
  const [statuts, setStatuts] = useState(statutParEnseigne)
  const [typologies, setTypologies] = useState(typologieParEnseigne)
  const [pending, startTransition] = useTransition()
```

Add a handler alongside `handleStatutChange`:

```tsx
  function handleTypologieChange(enseigne: string, typologie: Typologie | null) {
    const next = new Map(typologies)
    next.set(enseigne, typologie)
    setTypologies(next)
    startTransition(() => { definirTypologie(produit.id, enseigne, typologie) })
  }
```

Update the per-enseigne cell to render the new selector alongside the existing status one:

```tsx
      {ENSEIGNES.map(e => (
        <td key={e} className="text-center">
          <input type="checkbox" checked={enseignes.has(e)} onChange={() => toggleEnseigne(e)} />
          {enseignes.has(e) && (
            <>
              <select
                value={statuts.get(e) ?? 'commandable'}
                onChange={ev => handleStatutChange(e, ev.target.value as StatutDisponibilite)}
                className="block text-[10px] border rounded mt-1"
              >
                {Object.entries(LIBELLES_STATUT).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <select
                value={typologies.get(e) ?? ''}
                onChange={ev => handleTypologieChange(e, ev.target.value === '' ? null : (ev.target.value as Typologie))}
                className="block text-[10px] border rounded mt-1"
              >
                <option value="">Typologie...</option>
                {Object.entries(LIBELLES_TYPOLOGIE).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </>
          )}
        </td>
      ))}
```

- [ ] **Step 3: Extend `app/admin/produits/produits-table.tsx`**

Change the type import line:

```tsx
import { ENSEIGNES, type PrioriteProduit, type Produit, type ProduitEnseigne, type StatutDisponibilite, type Typologie } from '@/lib/types'
```

Add a new `useMemo` block next to `statutParProduitEtEnseigne`:

```tsx
  const typologieParProduitEtEnseigne = useMemo(() => {
    const map = new Map<string, Map<string, Typologie | null>>()
    for (const pe of produitsEnseigne) {
      if (!map.has(pe.produit_id)) map.set(pe.produit_id, new Map())
      map.get(pe.produit_id)!.set(pe.enseigne, pe.typologie)
    }
    return map
  }, [produitsEnseigne])
```

Add the new prop to the `<ProduitRow>` invocation:

```tsx
            {filtres.map(p => (
              <ProduitRow
                key={p.id}
                produit={p}
                enseignesActuelles={enseignesParProduit.get(p.id) ?? new Set()}
                rangActuel={rangParProduit.get(p.id) ?? null}
                statutParEnseigne={statutParProduitEtEnseigne.get(p.id) ?? new Map()}
                typologieParEnseigne={typologieParProduitEtEnseigne.get(p.id) ?? new Map()}
              />
            ))}
```

- [ ] **Step 4: Verify the project typechecks**

Run: `npx tsc --noEmit`
Expected: same pre-existing errors as after Task 7 (`app/magasins/[id]/page.tsx` only), no new ones.

- [ ] **Step 5: Manual verification in the browser**

Log in as admin, go to `/admin/produits`. Confirm a checked enseigne cell now shows two dropdowns (status, then typologie), that picking a typologie value and reloading the page shows it persisted.

- [ ] **Step 6: Commit**

```bash
git add lib/produits/actions.ts app/admin/produits/produit-row.tsx app/admin/produits/produits-table.tsx
git commit -m "feat: admin typologie obligatoire/picking selector"
```

---

## Task 9: Export niveau colors, PDL block, priorités du magasin

**Files:**
- Modify: `components/priorites-liste.tsx:5-10`
- Create: `app/magasins/[id]/pdl-bloc.tsx`
- Create: `app/magasins/[id]/priorites-magasin.tsx`

**Interfaces:**
- Consumes: `definirPdl` (Task 7), `NiveauPriorite`/`PrioriteHebdo` (existing).
- Produces: `COULEUR_NIVEAU`, `LIBELLE_NIVEAU` now exported from `components/priorites-liste.tsx`; `PdlBloc` component; `PrioritesMagasin` component. Consumed by Task 11.

- [ ] **Step 1: Export the two constants**

In `components/priorites-liste.tsx`, change:

```ts
const LIBELLE_NIVEAU: Record<NiveauPriorite, string> = { urgent: 'Urgent', cette_semaine: 'Cette semaine', a_anticiper: 'À anticiper' }
const COULEUR_NIVEAU: Record<NiveauPriorite, string> = {
```

to:

```ts
export const LIBELLE_NIVEAU: Record<NiveauPriorite, string> = { urgent: 'Urgent', cette_semaine: 'Cette semaine', a_anticiper: 'À anticiper' }
export const COULEUR_NIVEAU: Record<NiveauPriorite, string> = {
```

- [ ] **Step 2: Create `app/magasins/[id]/pdl-bloc.tsx`**

```tsx
'use client'
import { useState, useTransition } from 'react'
import { definirPdl } from '@/lib/pdl/actions'

type ChampPdl = 'pdl_generale' | 'pdl_yaos' | 'pdl_siggis' | 'pdl_dessert'

const CHAMPS: Array<{ cle: ChampPdl; label: string }> = [
  { cle: 'pdl_generale', label: 'PDL générale' },
  { cle: 'pdl_yaos', label: 'PDL YAOS' },
  { cle: 'pdl_siggis', label: "PDL SIGGI'S" },
  { cle: 'pdl_dessert', label: 'PDL Dessert (Viennois + La Laitière)' },
]

export function PdlBloc({ magasinId, pdl }: { magasinId: string; pdl: Record<ChampPdl, number | null> }) {
  const [valeurs, setValeurs] = useState(pdl)
  const [pending, startTransition] = useTransition()

  function handleBlur(cle: ChampPdl, valeurTexte: string) {
    const nombre = valeurTexte.trim() === '' ? null : Number(valeurTexte)
    if (nombre !== null && !Number.isFinite(nombre)) return
    setValeurs({ ...valeurs, [cle]: nombre })
    startTransition(() => { definirPdl(magasinId, cle, nombre) })
  }

  return (
    <div className={`flex flex-wrap gap-4 border rounded p-3 text-sm ${pending ? 'opacity-50' : ''}`}>
      {CHAMPS.map(({ cle, label }) => (
        <label key={cle} className="flex items-center gap-2">
          {label}
          <input
            type="number"
            step="0.1"
            defaultValue={valeurs[cle] ?? ''}
            placeholder="-"
            onBlur={e => handleBlur(cle, e.target.value)}
            className="border rounded px-2 py-1 w-20"
          />
          %
        </label>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Create `app/magasins/[id]/priorites-magasin.tsx`**

```tsx
'use client'
import { useState } from 'react'
import type { PrioriteHebdo } from '@/lib/engine/priorites'
import { COULEUR_NIVEAU, LIBELLE_NIVEAU } from '@/components/priorites-liste'

export function PrioritesMagasin({ priorites }: { priorites: PrioriteHebdo[] }) {
  const [ouvertes, setOuvertes] = useState<Set<number>>(new Set())

  function toggle(i: number) {
    const next = new Set(ouvertes)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setOuvertes(next)
  }

  if (priorites.length === 0) return null

  return (
    <div className="space-y-2">
      <h2 className="font-semibold">Priorités de ce magasin</h2>
      {priorites.map((p, i) => (
        <div key={`${p.produit.id}-${i}`} className={`border rounded p-2 ${COULEUR_NIVEAU[p.niveau]}`}>
          <div className="flex items-center justify-between">
            <span className="font-medium">{p.produit.nom} — {LIBELLE_NIVEAU[p.niveau]}</span>
            <button onClick={() => toggle(i)} className="text-xs underline">
              {ouvertes.has(i) ? 'Masquer' : 'Voir'} les raisons
            </button>
          </div>
          {ouvertes.has(i) && <p className="text-sm mt-1">{p.raison}</p>}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Verify the project typechecks**

Run: `npx tsc --noEmit`
Expected: same pre-existing errors as after Task 8 (`app/magasins/[id]/page.tsx` only — these two new components aren't wired into it yet, that's Task 11), no new ones.

- [ ] **Step 5: Commit**

```bash
git add components/priorites-liste.tsx "app/magasins/[id]/pdl-bloc.tsx" "app/magasins/[id]/priorites-magasin.tsx"
git commit -m "feat: add PDL block and priorites-magasin components"
```

---

## Task 10: Produits à travailler card component

**Files:**
- Create: `app/magasins/[id]/produit-a-travailler-carte.tsx`

**Interfaces:**
- Consumes: `ProduitATravailler` (Task 5), `definirRaisonAbsence` (Task 7), `COULEUR_NIVEAU`/`LIBELLE_NIVEAU` (Task 9).
- Produces: `ProduitATravaillerCarte` component. Consumed by Task 11.

- [ ] **Step 1: Create the component**

```tsx
'use client'
import { useState, useTransition } from 'react'
import type { ProduitATravailler } from '@/lib/engine/produit-a-travailler'
import { definirRaisonAbsence } from '@/lib/statuts/actions'
import { COULEUR_NIVEAU, LIBELLE_NIVEAU } from '@/components/priorites-liste'
import type { RaisonAbsence } from '@/lib/types'

const LIBELLES_RAISON: Record<RaisonAbsence, string> = {
  pas_de_place_rayon: 'Pas de place en rayon',
  frein_prix: 'Frein prix',
  jamais_reference: 'Jamais référencé',
  concurrence_privilegiee: 'Concurrence privilégiée',
  autre: 'Autre',
}

export function ProduitATravaillerCarte({ magasinId, item }: { magasinId: string; item: ProduitATravailler }) {
  const [raison, setRaison] = useState(item.raisonAbsence)
  const [pending, startTransition] = useTransition()

  function handleRaisonChange(value: string) {
    const nouvelleRaison = value === '' ? null : (value as RaisonAbsence)
    setRaison(nouvelleRaison)
    startTransition(() => { definirRaisonAbsence(magasinId, item.produit.id, nouvelleRaison) })
  }

  return (
    <div className={`border rounded p-3 space-y-2 ${pending ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">{item.produit.nom}</span>
          <span className="text-xs text-gray-500 ml-2">{item.produit.code}</span>
          {item.rang && <span className="text-xs text-gray-500 ml-2">Top {item.rang}</span>}
          {item.typologie === 'obligatoire' && (
            <span className="text-xs bg-red-600 text-white rounded px-1.5 py-0.5 ml-2">Obligatoire</span>
          )}
        </div>
        {item.momentum && (
          <span className={`text-xs rounded border px-2 py-0.5 ${COULEUR_NIVEAU[item.momentum]}`}>{LIBELLE_NIVEAU[item.momentum]}</span>
        )}
      </div>

      <p className="text-sm">{item.argumentaire}</p>

      {item.questionsDecouverte.length > 0 && (
        <ul className="text-xs text-gray-600 list-disc list-inside">
          {item.questionsDecouverte.map((q, i) => <li key={i}>{q}</li>)}
        </ul>
      )}

      <label className="text-xs flex items-center gap-2">
        Raison d&apos;absence :
        <select value={raison ?? ''} onChange={e => handleRaisonChange(e.target.value)} className="border rounded px-1 py-0.5">
          <option value="">-</option>
          {Object.entries(LIBELLES_RAISON).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
```

- [ ] **Step 2: Verify the project typechecks**

Run: `npx tsc --noEmit`
Expected: same pre-existing errors as after Task 9 (`app/magasins/[id]/page.tsx` only), no new ones.

- [ ] **Step 3: Commit**

```bash
git add "app/magasins/[id]/produit-a-travailler-carte.tsx"
git commit -m "feat: add produit-a-travailler card component"
```

---

## Task 11: Assortiment search + final page wiring

**Files:**
- Create: `app/magasins/[id]/assortiment-table.tsx`
- Modify: `app/magasins/[id]/page.tsx` (full rewrite)

**Interfaces:**
- Consumes: `chargerProduitsATravailler` (Task 6), `PdlBloc`/`PrioritesMagasin` (Task 9), `ProduitATravaillerCarte` (Task 10), `prioritesSemaine` (existing), `StatutSelect` (existing, unchanged).

This is the last task touching files that reference the deleted `chargerArgumentsFicheMagasin` — after this task, the whole project typechecks and builds cleanly.

- [ ] **Step 1: Create `app/magasins/[id]/assortiment-table.tsx`**

```tsx
'use client'
import { useMemo, useState } from 'react'
import type { Produit, StatutProduit } from '@/lib/types'
import { StatutSelect } from './statut-select'

export function AssortimentTable({
  magasinId,
  produits,
  statutParProduit,
}: {
  magasinId: string
  produits: Produit[]
  statutParProduit: Map<string, StatutProduit>
}) {
  const [recherche, setRecherche] = useState('')

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    if (!q) return produits
    return produits.filter(p => p.nom.toLowerCase().includes(q) || p.code.includes(q))
  }, [produits, recherche])

  return (
    <div className="space-y-2">
      <input
        value={recherche}
        onChange={e => setRecherche(e.target.value)}
        placeholder={`Rechercher parmi ${produits.length} produits (nom, EAN)...`}
        className="border rounded px-3 py-2 w-full max-w-md"
      />
      <table className="w-full text-sm">
        <thead><tr><th className="text-left">Produit</th><th className="text-left">Statut</th></tr></thead>
        <tbody>
          {filtres.map(p => (
            <tr key={p.id}>
              <td>{p.nom}</td>
              <td>
                <StatutSelect magasinId={magasinId} produitId={p.id} statutActuel={statutParProduit.get(p.id) ?? 'present'} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Replace the full content of `app/magasins/[id]/page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import type { Produit, Promo, StatutProduit } from '@/lib/types'
import { chargerProduitsATravailler } from '@/lib/engine/fiche-magasin'
import { prioritesSemaine } from '@/lib/engine/priorites'
import { PdlBloc } from './pdl-bloc'
import { PrioritesMagasin } from './priorites-magasin'
import { ProduitATravaillerCarte } from './produit-a-travailler-carte'
import { AssortimentTable } from './assortiment-table'

export default async function FicheMagasinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) redirect('/login')
  if (profile.role !== 'commercial') redirect('/equipe')

  const { data: magasin } = await supabase.from('magasins').select('*').eq('id', id).single()
  if (!magasin) notFound()

  const [{ data: produits }, { data: statuts }, { data: pdl }, { data: produitsEnseigne }, { data: promoLiens }] = await Promise.all([
    supabase.from('produits').select('*').order('nom'),
    supabase.from('statuts_produit_magasin').select('*').eq('magasin_id', magasin.id),
    supabase.from('pdl_magasin').select('*').eq('magasin_id', magasin.id).maybeSingle(),
    supabase.from('produits_enseigne').select('*').eq('enseigne', magasin.enseigne),
    supabase.from('promo_produits').select('produit_id, promos(*)'),
  ])

  const statutParProduit = new Map((statuts ?? []).map(s => [s.produit_id, s.statut as StatutProduit]))
  const produitsParId = new Map<string, Produit>((produits ?? []).map(p => [p.id, p]))
  const promosParProduitId = new Map<string, Promo[]>()
  for (const lien of promoLiens ?? []) {
    const liste = promosParProduitId.get(lien.produit_id) ?? []
    liste.push(lien.promos as unknown as Promo)
    promosParProduitId.set(lien.produit_id, liste)
  }

  const produitsATravailler = await chargerProduitsATravailler(magasin.id)
  const prioritesHebdo = prioritesSemaine(
    [magasin], statuts ?? [], produitsParId, produitsEnseigne ?? [], promosParProduitId
  )

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold">{magasin.nom} — {magasin.enseigne}</h1>
        <p className="text-sm text-gray-600">{magasin.adresse}</p>
        {magasin.contact_nom && (
          <p className="text-sm">Contact : {magasin.contact_nom} — {magasin.contact_telephone} — {magasin.contact_email}</p>
        )}
      </div>

      <PdlBloc
        magasinId={magasin.id}
        pdl={{
          pdl_generale: pdl?.pdl_generale ?? null,
          pdl_yaos: pdl?.pdl_yaos ?? null,
          pdl_siggis: pdl?.pdl_siggis ?? null,
          pdl_dessert: pdl?.pdl_dessert ?? null,
        }}
      />

      <PrioritesMagasin priorites={prioritesHebdo} />

      <div className="space-y-3">
        <h2 className="font-semibold">Produits manquants à travailler</h2>
        {produitsATravailler.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun produit manquant à travailler pour ce magasin.</p>
        ) : (
          produitsATravailler.map(item => (
            <ProduitATravaillerCarte key={item.produit.id} magasinId={magasin.id} item={item} />
          ))
        )}
      </div>

      <div>
        <h2 className="font-semibold mb-2">Assortiment</h2>
        <AssortimentTable magasinId={magasin.id} produits={produits ?? []} statutParProduit={statutParProduit} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify the project typechecks and builds**

Run: `npx tsc --noEmit`
Expected: no errors anywhere in the project.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Manual verification in the browser**

Log in as the commercial account (`schlesser.honore@gmail.com` / `commercialhonore`), open a fiche magasin. Confirm:
- The PDL block renders 4 inputs, editing one and reloading shows it persisted.
- "Priorités de ce magasin" shows only entries for this store, with a working "Voir les raisons" toggle.
- "Produits manquants à travailler" shows one card per manquant/rupture product, with an argumentaire, questions de découverte, an action recommandée-implied conclusion, and a working raison d'absence selector (change it, reload, confirm it persisted).
- The assortment search filters the table by name and EAN.

- [ ] **Step 5: Commit**

```bash
git add "app/magasins/[id]/assortiment-table.tsx" "app/magasins/[id]/page.tsx"
git commit -m "refactor: restructure fiche magasin into priorites/travailler/assortiment"
```

---

## Task 12: Full verification pass + push

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including all new files from Tasks 2, 4, 5.

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit` — expected: no errors.
Run: `npm run build` — expected: build succeeds.

- [ ] **Step 3: Manual browser check**

Repeat Task 11 Step 4's checks end to end in one pass. Additionally check `/admin/produits` (typologie selector, Task 8) and `/admin/import` (VMH import, Task 3) still work after the full sequence of changes.

- [ ] **Step 4: Push**

```bash
git push origin worktree-outil-force-vente:main
```

## Self-Review Notes

- **Spec coverage:** §3.1 (raison_absence) → Tasks 1, 7, 10. §3.2 (VMH national) → Tasks 1, 2, 3, 4. §3.3 (PDL) → Tasks 1, 7, 9, 11. §3.4 (typologie) → Tasks 1, 8. §4.1-4.4 (produitATravailler, VMH selection, argumentaire, questions) → Tasks 4, 5. §5 (page structure, search, two-tier sort) → Tasks 6, 9, 10, 11. §7 (tests) → covered across Tasks 2, 4, 5.
- **Deliberate deviations from the spec's exact wording**, both justified inline in their task: the `pdl_magasin` RLS policies use the codebase's proven insert/update-split pattern (matching `statuts_produit_magasin`) rather than the spec's simpler illustrative `for all` shorthand — functionally equivalent, safer precedent. `ProduitATravailler` gains an internal `score: number` field the spec's interface sketch omitted, needed for the two-tier sort without recomputing `importanceProduitFiche` a second time — mirrors the exact `ImportanceProduit.score` precedent already established and reviewed in sub-project 1.
- **Placeholder scan:** no TBD/TODO; every step has runnable code and an exact expected result.
- **Type consistency:** `RaisonAbsence`, `Typologie`, `VmhNational`, `PdlMagasin`, `ProduitATravailler` are defined once (Task 1, Task 5) and referenced with the same names/shapes in every later task.
