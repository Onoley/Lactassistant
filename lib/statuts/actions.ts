'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import type { StatutProduit } from '@/lib/types'

export async function updateStatutProduit(magasinId: string, produitId: string, statut: StatutProduit) {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) throw new Error('Non authentifié')

  const { error } = await supabase.from('statuts_produit_magasin').upsert(
    { magasin_id: magasinId, produit_id: produitId, statut, signale_par: profile.id, signale_at: new Date().toISOString() },
    { onConflict: 'magasin_id,produit_id' }
  )
  if (error) throw error
  revalidatePath(`/magasins/${magasinId}`)
}
