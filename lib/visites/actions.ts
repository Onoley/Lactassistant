'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'

export async function planifierVisite(magasinId: string, semaine: string, jour: string) {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) throw new Error('Non authentifié')

  const { error } = await supabase.from('visites').insert({
    magasin_id: magasinId, commercial_id: profile.id, semaine, jour, statut: 'planifie',
  })
  if (error) throw error
  revalidatePath('/semaine')
}

export async function marquerRealisee(visiteId: string) {
  const supabase = createServerClient()
  const { error } = await supabase.from('visites').update({ statut: 'realise' }).eq('id', visiteId)
  if (error) throw error
  revalidatePath('/semaine')
}

export async function retirerVisite(visiteId: string) {
  const supabase = createServerClient()
  const { error } = await supabase.from('visites').delete().eq('id', visiteId)
  if (error) throw error
  revalidatePath('/semaine')
}
