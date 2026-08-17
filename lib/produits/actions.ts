'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { StatutDisponibilite } from '@/lib/types'

async function assertAdmin() {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (profile?.role !== 'admin') throw new Error('Réservé aux administrateurs')
}

export async function creerProduit(
  code: string,
  nom: string,
  categorie: string | null,
  marque: string | null,
  gamme: string | null,
  parfum: string | null,
  format: string | null
) {
  await assertAdmin()
  const admin = createAdminClient()
  const { error } = await admin.from('produits').insert({ code, nom, categorie, marque, gamme, parfum, format })
  if (error) throw error
  revalidatePath('/admin/produits')
}

export async function supprimerProduit(id: string) {
  await assertAdmin()
  const admin = createAdminClient()
  await admin.from('produits_enseigne').delete().eq('produit_id', id)
  await admin.from('priorites_produits').delete().eq('produit_id', id)
  await admin.from('promo_produits').delete().eq('produit_id', id)
  await admin.from('statuts_produit_magasin').delete().eq('produit_id', id)
  const { error } = await admin.from('produits').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/admin/produits')
}

export async function definirAssortiment(produitId: string, enseigne: string, present: boolean) {
  await assertAdmin()
  const admin = createAdminClient()
  if (present) {
    const { error } = await admin.from('produits_enseigne').upsert(
      { produit_id: produitId, enseigne, typologie: null },
      { onConflict: 'produit_id,enseigne' }
    )
    if (error) throw error
  } else {
    const { error } = await admin.from('produits_enseigne').delete().eq('produit_id', produitId).eq('enseigne', enseigne)
    if (error) throw error
  }
  revalidatePath('/admin/produits')
}

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

export async function definirPriorite(produitId: string, rang: 20 | 50 | 70 | null) {
  await assertAdmin()
  const admin = createAdminClient()
  if (rang === null) {
    const { error } = await admin.from('priorites_produits').delete().eq('produit_id', produitId)
    if (error) throw error
  } else {
    const { error } = await admin.from('priorites_produits').upsert(
      { produit_id: produitId, rang, updated_at: new Date().toISOString() },
      { onConflict: 'produit_id' }
    )
    if (error) throw error
  }
  revalidatePath('/admin/produits')
}
