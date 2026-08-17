import { createServerClient } from '@/lib/supabase/server'
import { UtilisateurForm } from './utilisateur-form'
import { UtilisateurRow } from './utilisateur-row'

export default async function UtilisateursPage() {
  const supabase = createServerClient()
  const { data: profiles } = await supabase.from('profiles').select('*').order('email')
  const { data: secteurs } = await supabase.from('secteurs').select('*').order('nom')
  const managers = (profiles ?? []).filter(p => p.role === 'manager')

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Utilisateurs</h1>
      <UtilisateurForm secteurs={secteurs ?? []} managers={managers} />
      <table className="w-full text-sm">
        <thead><tr><th className="text-left">Email</th><th className="text-left">Rôle</th><th className="text-left">Secteur</th><th className="text-left">Manager</th><th className="text-left">Compte</th><th></th></tr></thead>
        <tbody>
          {(profiles ?? []).map(p => (
            <UtilisateurRow key={p.id} profile={{ ...p, compteActif: p.user_id !== null }} secteurs={secteurs ?? []} managers={managers} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
