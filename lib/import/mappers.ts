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
