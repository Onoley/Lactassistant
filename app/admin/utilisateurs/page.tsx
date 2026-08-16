import { createServerClient } from '@/lib/supabase/server'
import { UtilisateurForm } from './utilisateur-form'

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
        <thead><tr><th className="text-left">Email</th><th className="text-left">Rôle</th><th className="text-left">Secteur</th></tr></thead>
        <tbody>
          {(profiles ?? []).map(p => (
            <tr key={p.id}>
              <td>{p.email}</td>
              <td>{p.role}</td>
              <td>{secteurs?.find(s => s.id === p.secteur_id)?.nom ?? '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
