'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

async function assertAdmin() {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (profile?.role !== 'admin') throw new Error('Réservé aux administrateurs')
}

export async function creerSecteur(nom: string) {
  await assertAdmin()
  const admin = createAdminClient()
  const { error } = await admin.from('secteurs').insert({ nom })
  if (error) throw error
  revalidatePath('/admin/secteurs')
}

export async function modifierSecteur(id: string, nom: string) {
  await assertAdmin()
  const admin = createAdminClient()
  const { error } = await admin.from('secteurs').update({ nom }).eq('id', id)
  if (error) throw error
  revalidatePath('/admin/secteurs')
}

export async function supprimerSecteur(id: string) {
  await assertAdmin()
  const admin = createAdminClient()

  const { count: nbMagasins } = await admin.from('magasins').select('id', { count: 'exact', head: true }).eq('secteur_id', id)
  if (nbMagasins) throw new Error(`Ce secteur a encore ${nbMagasins} magasin(s) rattaché(s) — déplace-les ou supprime-les d'abord`)

  const { count: nbProfils } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('secteur_id', id)
  if (nbProfils) throw new Error(`Ce secteur a encore ${nbProfils} commercial(aux) rattaché(s) — change leur secteur d'abord`)

  const { error } = await admin.from('secteurs').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/admin/secteurs')
}
