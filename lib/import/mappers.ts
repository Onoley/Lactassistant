import type { ImportError, ParseResult } from './parser'

export interface MagasinImport {
  code: string
  nom: string
  enseigne: string
  taille: string
  adresse: string | null
  contactNom: string | null
  contactTelephone: string | null
  contactEmail: string | null
  surface: number | null
}

// Correspondance "Raison Sociale" (export PDV) -> enseigne canonique utilisée
// dans le reste de l'app (produits_enseigne, promos, argumentaire).
const ENSEIGNE_PAR_RAISON_SOCIALE: Record<string, string> = {
  'CARREFOUR MARKET': 'Carrefour Market',
  'CENTRE LECLERC': 'Leclerc',
  'INTERMARCHE EXPRESS': 'Intermarche',
  'INTERMARCHE SUPER': 'Intermarche',
  CARREFOUR: 'Carrefour',
  'CARREFOUR EX CORA': 'Carrefour',
  'E. LECLERC DRIVE': 'Leclerc',
  'AUCHAN SUPERMARCHE': 'Auchan',
  AUCHAN: 'Auchan',
  'SUPER U': 'U',
}

const TAILLE_PAR_PRIORISATION: Record<string, string> = {
  'Linéaire >125m': 'hyper',
  'Linéaire <125m': 'super',
  Proxi: 'proxi',
  Drive: 'drive',
}

function deviner(raisonSociale: string): string {
  const enseigne = ENSEIGNE_PAR_RAISON_SOCIALE[raisonSociale]
  if (!enseigne) throw new Error(`Enseigne inconnue pour "${raisonSociale}" — ajouter la correspondance dans lib/import/mappers.ts`)
  return enseigne
}

function deviverTaille(priorisation: string, raisonSociale: string): string {
  const taille = TAILLE_PAR_PRIORISATION[priorisation]
  if (taille) return taille
  // "Non Priorisé" (magasins inactifs) : déduit du format de l'enseigne.
  return raisonSociale.includes('DRIVE') ? 'drive' : 'super'
}

export interface ProduitImport {
  code: string
  nom: string
  categorie: string | null
  rang: 20 | 50 | 70
}

export interface PromoProduitImport {
  ean: string
  libelle: string | null
  caNego: number | null
  caReal: number | null
}

export interface PromoImport {
  code: string
  enseigne: string
  mecanique: string
  theme: string | null
  supportOp: string | null
  statut: string | null
  opTrade: string | null
  niveauOperation: string | null
  dateInstallation: string | null
  reventeFin: string | null
  dateDebutVente: string
  dateFinVente: string | null
  produits: PromoProduitImport[]
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

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
}

// Lit l'export "MES MAGASINS" (parc de points de vente d'un commercial) tel
// que fourni par l'outil interne — colonnes en toutes lettres, pas de code
// technique. Un fichier = un territoire : le secteur est saisi une fois dans
// le formulaire d'import, pas colonne par colonne.
export function mapMagasinRow(row: Record<string, string>): MagasinImport {
  const raisonSociale = requireField(row, 'Raison Sociale')
  const adresseBrute = requireField(row, 'Adresse')
  const codePostal = requireField(row, 'Code Postal')
  const ville = requireField(row, 'Ville')
  const code = requireField(row, 'Code du Point de Vente')
  const priorisation = row['Priorisation']?.trim() ?? ''

  return {
    code,
    nom: `${titleCase(raisonSociale)} - ${titleCase(adresseBrute)}`,
    enseigne: deviner(raisonSociale),
    taille: deviverTaille(priorisation, raisonSociale),
    adresse: `${adresseBrute}, ${codePostal} ${ville}`,
    contactNom: null,
    contactTelephone: row['Téléphone']?.trim() || null,
    contactEmail: null,
    surface: parseNombreFr(row['Surface']),
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

function parseDateFr(value: string | undefined): string | null {
  const v = value?.trim()
  if (!v) return null
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v)
  if (!m) return null
  const [, jour, mois, annee] = m
  return `${annee}-${mois}-${jour}`
}

function parseNombreFr(value: string | undefined): number | null {
  const v = value?.trim().replace(',', '.')
  if (!v) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function slug(s: string): string {
  return s
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
}

// Lit l'export "PPE" (plan promotionnel d'une enseigne) tel que fourni par
// l'outil interne : une ligne = une opération, avec plusieurs produits listés
// dans une même cellule (un par ligne texte, EAN/libellé/mécanique/CA alignés
// par position). Une opération qui mélange plusieurs mécaniques (ex. "3 pour
// 2" pour une moitié des produits, "2ème à 50%" pour l'autre) est éclatée en
// plusieurs promos distinctes, une par mécanique, car promos.mecanique est un
// champ unique par ligne. L'enseigne n'est pas une colonne du fichier (un
// fichier = une enseigne) : elle est saisie une fois dans le formulaire.
export function mapPromoRows(rows: Record<string, string>[], enseigne: string): ParseResult<PromoImport> {
  const valid: PromoImport[] = []
  const errors: ImportError[] = []
  const codesUtilises = new Map<string, number>()
  const prefixe = slug(enseigne).slice(0, 4) || 'ENS'
  const suffixes = 'ABCDEFGH'

  rows.forEach((row, index) => {
    try {
      const eans = requireField(row, 'EAN').split('\n').map(s => s.trim())
      const libelles = requireField(row, 'Libellé produit').split('\n').map(s => s.trim())
      const offres = (row['Offre conso'] ?? '').split('\n').map(s => s.trim())
      const caNegos = (row['CA Négo'] ?? '').split('\n').map(s => s.trim())
      const caReals = (row['CA Réal'] ?? '').split('\n').map(s => s.trim())

      if (eans.length !== libelles.length) {
        throw new Error(`${eans.length} EAN pour ${libelles.length} libellés produit — colonnes désalignées`)
      }
      while (offres.length < eans.length) offres.push('')
      while (caNegos.length < eans.length) caNegos.push('')
      while (caReals.length < eans.length) caReals.push('')

      const consoDebut = parseDateFr(requireField(row, 'Conso déb.'))
      if (!consoDebut) throw new Error(`Champ "Conso déb." doit être au format JJ/MM/AAAA, reçu "${row['Conso déb.']}"`)

      const theme = row['Thème']?.trim() || null

      // regroupe les produits par mécanique distincte au sein de l'opération
      const groupes = new Map<string, number[]>()
      offres.forEach((mecanique, i) => {
        const liste = groupes.get(mecanique) ?? []
        liste.push(i)
        groupes.set(mecanique, liste)
      })

      const themeSlug = theme ? slug(theme) : `L${index}`
      let g = 0
      for (const [mecanique, indices] of groupes) {
        const base = `${prefixe}-${themeSlug}`
        let code = groupes.size === 1 ? base : `${base}-${suffixes[g] ?? String(g)}`
        const dejaVu = codesUtilises.get(code) ?? 0
        if (dejaVu > 0) code = `${code}-${dejaVu + 1}`
        codesUtilises.set(code, dejaVu + 1)
        g++

        valid.push({
          code,
          enseigne,
          mecanique,
          theme,
          supportOp: row['Support OP']?.trim() || null,
          statut: row['Statut']?.trim() || null,
          opTrade: row['OP Trade']?.trim() || null,
          niveauOperation: row['Niveau opération']?.trim() || null,
          dateInstallation: parseDateFr(row['Revente déb.']),
          reventeFin: parseDateFr(row['Revente fin']),
          dateDebutVente: consoDebut,
          dateFinVente: parseDateFr(row['Conso fin']),
          produits: indices.map(i => ({
            ean: eans[i],
            libelle: libelles[i] || null,
            caNego: parseNombreFr(caNegos[i]),
            caReal: parseNombreFr(caReals[i]),
          })),
        })
      }
    } catch (err) {
      errors.push({ row: index + 2, message: (err as Error).message })
    }
  })

  return { valid, errors }
}

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

export interface VmhEnseigneImport {
  ean: string
  vmh: number | null
  dv: number | null
  prixMoyen: number | null
}

const COL_EAN_CAM = 55
const COL_PRIX_CAM = 60
const COL_DV_CAM = 70
const COL_VMH_CAM = 80

// Colonnes fixes des onglets "par enseigne" : chaque métrique est répétée
// 5x (P4, P5, Dernière Période, Cumul 3 Dernières Périodes, CAM) — on
// retient la colonne CAM ("Cumul Annuel Mobile", ~12 mois), cohérente avec
// la vue annuelle du VMH national (Vision CAT).
export function mapVmhEnseigneRow(row: (string | number | null)[]): VmhEnseigneImport | null {
  const eanBrut = row[COL_EAN_CAM]
  const ean = eanBrut !== null && eanBrut !== undefined ? String(eanBrut).trim() : ''
  if (!/^[0-9]{8,14}$/.test(ean)) return null

  return {
    ean,
    vmh: versNombreOuNull(row[COL_VMH_CAM]),
    dv: versNombreOuNull(row[COL_DV_CAM]),
    prixMoyen: versNombreOuNull(row[COL_PRIX_CAM]),
  }
}

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
