export interface MagasinImport {
  code: string
  nom: string
  enseigne: string
  taille: string
  adresse: string | null
  contactNom: string | null
  contactTelephone: string | null
  contactEmail: string | null
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
