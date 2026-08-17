'use server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { readSpreadsheet, readVmhSheet, parseRows, type ImportError } from './parser'
import { mapMagasinRow, mapProduitRow, mapPromoRows, mapVmhRow } from './mappers'

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
  const secteurNom = (formData.get('secteur') as string)?.trim()
  if (!secteurNom) throw new Error('Le secteur est obligatoire pour importer un parc de magasins')

  const file = formData.get('file') as File
  const rows = readSpreadsheet(await file.arrayBuffer())
  const { valid, errors } = parseRows(rows, mapMagasinRow)

  const { deduped, duplicates } = dedupeByCode(valid)
  duplicates.forEach(code => {
    errors.push({ row: 0, message: `Code "${code}" apparaît plusieurs fois dans le fichier, seule la dernière occurrence a été importée` })
  })

  const admin = createAdminClient()
  const { data: secteur, error: secteurError } = await admin
    .from('secteurs')
    .upsert({ nom: secteurNom }, { onConflict: 'nom' })
    .select('id')
    .single()
  if (secteurError) throw secteurError

  const { error } = await admin.from('magasins').upsert(
    deduped.map(m => ({
      code: m.code,
      nom: m.nom,
      enseigne: m.enseigne,
      taille: m.taille,
      adresse: m.adresse,
      secteur_id: secteur.id,
      contact_nom: m.contactNom,
      contact_telephone: m.contactTelephone,
      contact_email: m.contactEmail,
      surface: m.surface,
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
  const enseigne = (formData.get('enseigne') as string)?.trim()
  if (!enseigne) throw new Error('L\'enseigne est obligatoire pour importer un plan promotionnel')

  const file = formData.get('file') as File
  const rows = readSpreadsheet(await file.arrayBuffer())
  const { valid, errors } = mapPromoRows(rows, enseigne)

  const { deduped, duplicates } = dedupeByCode(valid)
  duplicates.forEach(code => {
    errors.push({ row: 0, message: `Code "${code}" apparaît plusieurs fois, seule la dernière occurrence a été importée` })
  })

  const admin = createAdminClient()
  const { data: promos, error: promosError } = await admin
    .from('promos')
    .upsert(
      deduped.map(p => ({
        code: p.code,
        enseigne: p.enseigne,
        mecanique: p.mecanique,
        theme: p.theme,
        support_op: p.supportOp,
        statut: p.statut,
        op_trade: p.opTrade,
        niveau_operation: p.niveauOperation,
        date_installation: p.dateInstallation,
        revente_fin: p.reventeFin,
        date_debut_vente: p.dateDebutVente,
        date_fin_vente: p.dateFinVente,
      })),
      { onConflict: 'code' }
    )
    .select('id, code')
  if (promosError) throw promosError

  const { data: produits } = await admin.from('produits').select('id, code')
  const produitIdByCode = new Map((produits ?? []).map(p => [p.code, p.id]))
  const promoIdByCode = new Map((promos ?? []).map(p => [p.code, p.id]))

  const links: Array<{ promo_id: string; produit_id: string; libelle_produit: string | null; ca_nego: number | null; ca_real: number | null }> = []
  deduped.forEach(p => {
    const promoId = promoIdByCode.get(p.code)
    if (!promoId) return
    p.produits.forEach(prod => {
      const produitId = produitIdByCode.get(prod.ean)
      if (produitId) {
        links.push({ promo_id: promoId, produit_id: produitId, libelle_produit: prod.libelle, ca_nego: prod.caNego, ca_real: prod.caReal })
      } else {
        errors.push({ row: 0, message: `Promo ${p.code} : produit EAN "${prod.ean}" introuvable dans le catalogue${prod.libelle ? ` (${prod.libelle})` : ''} — ajoute-le d'abord dans /admin/produits` })
      }
    })
  })

  if (links.length > 0) {
    const { error: linksError } = await admin.from('promo_produits').upsert(links, { onConflict: 'promo_id,produit_id' })
    if (linksError) throw linksError
  }

  return { imported: deduped.length, errors }
}

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
