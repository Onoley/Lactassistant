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
