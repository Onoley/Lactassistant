'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Role } from '@/lib/types'

export async function creerUtilisateur(
  email: string,
  role: Role,
  secteurId: string | null,
  managerId: string | null
) {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (profile?.role !== 'admin') throw new Error('Réservé aux administrateurs')

  if (role === 'commercial') {
    if (!secteurId) throw new Error('Le secteur est obligatoire pour un commercial')
    if (!managerId) throw new Error('Le manager est obligatoire pour un commercial')
  } else {
    if (secteurId) throw new Error('Un ' + role + ' ne doit pas avoir de secteur')
    if (managerId) throw new Error('Un ' + role + ' ne doit pas avoir de manager')
  }

  const admin = createAdminClient()
  const { error } = await admin.from('profiles').insert({
    email, role, secteur_id: secteurId, manager_id: managerId,
  })
  if (error) throw error
  revalidatePath('/admin/utilisateurs')
}
