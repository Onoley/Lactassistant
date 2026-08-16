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

function dedupeByCode<T extends { code: string }>(items: T[]): { deduped: T[]; duplicates: Set<string> } {
  const byCode = new Map<string, T>()
  const duplicates = new Set<string>()

  items.forEach(item => {
    if (byCode.has(item.code)) {
      duplicates.add(item.code)
    }
    byCode.set(item.code, item)
  })

  return { deduped: Array.from(byCode.values()), duplicates }
}

export async function importMagasins(formData: FormData): Promise<ImportSummary> {
  await assertAdmin()
  const file = formData.get('file') as File
  const rows = readSpreadsheet(await file.arrayBuffer())
  const { valid, errors } = parseRows(rows, mapMagasinRow)

  const { deduped, duplicates } = dedupeByCode(valid)
  duplicates.forEach(code => {
    errors.push({ row: 0, message: `Code "${code}" apparaît plusieurs fois dans le fichier, seule la dernière occurrence a été importée` })
  })

  const admin = createAdminClient()
  const secteurNoms = [...new Set(deduped.map(m => m.secteurNom))]
  const { data: secteurs, error: secteursError } = await admin
    .from('secteurs')
    .upsert(secteurNoms.map(nom => ({ nom })), { onConflict: 'nom' })
    .select('id, nom')
  if (secteursError) throw secteursError

  const secteurIdByNom = new Map((secteurs ?? []).map(s => [s.nom, s.id]))
  const { error } = await admin.from('magasins').upsert(
    deduped.map(m => ({
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

  return { imported: deduped.length, errors }
}

export async function importProduits(formData: FormData): Promise<ImportSummary> {
  await assertAdmin()
  const file = formData.get('file') as File
  const rows = readSpreadsheet(await file.arrayBuffer())
  const { valid, errors } = parseRows(rows, mapProduitRow)

  const { deduped, duplicates } = dedupeByCode(valid)
  duplicates.forEach(code => {
    errors.push({ row: 0, message: `Code "${code}" apparaît plusieurs fois dans le fichier, seule la dernière occurrence a été importée` })
  })

  const admin = createAdminClient()
  const { data: produits, error: produitsError } = await admin
    .from('produits')
    .upsert(deduped.map(p => ({ code: p.code, nom: p.nom, categorie: p.categorie })), { onConflict: 'code' })
    .select('id, code')
  if (produitsError) throw produitsError

  const idByCode = new Map((produits ?? []).map(p => [p.code, p.id]))
  const { error: prioritesError } = await admin.from('priorites_produits').upsert(
    deduped.map(p => ({ produit_id: idByCode.get(p.code), rang: p.rang })),
    { onConflict: 'produit_id' }
  )
  if (prioritesError) throw prioritesError

  return { imported: deduped.length, errors }
}

export async function importPromos(formData: FormData): Promise<ImportSummary> {
  await assertAdmin()
  const file = formData.get('file') as File
  const rows = readSpreadsheet(await file.arrayBuffer())
  const { valid, errors } = parseRows(rows, mapPromoRow)

  const { deduped, duplicates } = dedupeByCode(valid)
  duplicates.forEach(code => {
    errors.push({ row: 0, message: `Code "${code}" apparaît plusieurs fois dans le fichier, seule la dernière occurrence a été importée` })
  })

  const admin = createAdminClient()
  const { data: promos, error: promosError } = await admin
    .from('promos')
    .upsert(
      deduped.map(p => ({
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

  const links: Array<{ promo_id: string; produit_id: string }> = []
  deduped.forEach(p => {
    const promoId = promoIdByCode.get(p.code)
    p.produitsCodes.forEach(code => {
      const produitId = produitIdByCode.get(code)
      if (produitId) {
        links.push({ promo_id: promoId, produit_id: produitId })
      } else {
        errors.push({ row: 0, message: `Promo ${p.code} : produit "${code}" introuvable` })
      }
    })
  })

  if (links.length > 0) {
    const { error: linksError } = await admin.from('promo_produits').upsert(links, { onConflict: 'promo_id,produit_id' })
    if (linksError) throw linksError
  }

  return { imported: deduped.length, errors }
}
