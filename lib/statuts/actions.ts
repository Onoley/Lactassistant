'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import type { RaisonAbsence, StatutProduit } from '@/lib/types'

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

export async function definirRaisonAbsence(magasinId: string, produitId: string, raison: RaisonAbsence | null) {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) throw new Error('Non authentifié')

  const { data: produit } = await supabase.from('produits').select('produit_canonique_id').eq('id', produitId).single()
  const idEffectif = produit?.produit_canonique_id ?? produitId

  const { error } = await supabase.from('statuts_produit_magasin')
    .update({ raison_absence: raison })
    .eq('magasin_id', magasinId)
    .eq('produit_id', idEffectif)
  if (error) throw error
  revalidatePath(`/magasins/${magasinId}`)
}
