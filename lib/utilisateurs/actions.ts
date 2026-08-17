'use server'
import { revalidatePath } from 'next/cache'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Role } from '@/lib/types'

async function assertAdmin() {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (profile?.role !== 'admin') throw new Error('Réservé aux administrateurs')
}

function validerAffectation(role: Role, secteurId: string | null, managerId: string | null) {
  if (role === 'commercial') {
    if (!secteurId) throw new Error('Le secteur est obligatoire pour un commercial')
    if (!managerId) throw new Error('Le manager est obligatoire pour un commercial')
  } else {
    if (secteurId) throw new Error('Un ' + role + ' ne doit pas avoir de secteur')
    if (managerId) throw new Error('Un ' + role + ' ne doit pas avoir de manager')
  }
}

export async function creerUtilisateur(
  email: string,
  role: Role,
  secteurId: string | null,
  managerId: string | null,
  motDePasse?: string
) {
  await assertAdmin()
  validerAffectation(role, secteurId, managerId)

  const admin = createAdminClient()
  const { error } = await admin.from('profiles').insert({
    email: email.toLowerCase(), role, secteur_id: secteurId, manager_id: managerId,
  })
  if (error) throw error

  if (motDePasse) {
    const { error: authError } = await admin.auth.admin.createUser({
      email: email.toLowerCase(),
      password: motDePasse,
      email_confirm: true,
    })
    if (authError) throw authError
  }
  revalidatePath('/admin/utilisateurs')
}

export async function modifierUtilisateur(
  id: string,
  role: Role,
  secteurId: string | null,
  managerId: string | null
) {
  await assertAdmin()
  validerAffectation(role, secteurId, managerId)

  const admin = createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ role, secteur_id: secteurId, manager_id: managerId })
    .eq('id', id)
  if (error) throw error
  revalidatePath('/admin/utilisateurs')
}

export async function definirMotDePasseUtilisateur(id: string, motDePasse: string) {
  await assertAdmin()
  if (motDePasse.length < 6) throw new Error('Le mot de passe doit faire au moins 6 caractères')

  const admin = createAdminClient()
  const { data: existant, error: fetchError } = await admin.from('profiles').select('email, user_id').eq('id', id).single()
  if (fetchError) throw fetchError

  if (existant.user_id) {
    const { error } = await admin.auth.admin.updateUserById(existant.user_id, { password: motDePasse })
    if (error) throw error
  } else {
    const { error } = await admin.auth.admin.createUser({
      email: existant.email,
      password: motDePasse,
      email_confirm: true,
    })
    if (error) throw error
  }
  revalidatePath('/admin/utilisateurs')
}

export async function supprimerUtilisateur(id: string) {
  await assertAdmin()
  const admin = createAdminClient()

  const { data: existant } = await admin.from('profiles').select('user_id').eq('id', id).single()
  const { error } = await admin.from('profiles').delete().eq('id', id)
  if (error) throw error

  if (existant?.user_id) {
    await admin.auth.admin.deleteUser(existant.user_id)
  }
  revalidatePath('/admin/utilisateurs')
}
