'use client'
import { useState } from 'react'
import { modifierUtilisateur, supprimerUtilisateur } from '@/lib/utilisateurs/actions'
import type { Profile, Role } from '@/lib/types'

export function UtilisateurRow({
  profile,
  secteurs,
  managers,
}: {
  profile: Profile
  secteurs: { id: string; nom: string }[]
  managers: { id: string; email: string }[]
}) {
  const [editing, setEditing] = useState(false)
  const [role, setRole] = useState<Role>(profile.role)
  const [secteurId, setSecteurId] = useState(profile.secteur_id ?? '')
  const [managerId, setManagerId] = useState(profile.manager_id ?? '')
  const [error, setError] = useState('')

  function handleRoleChange(newRole: Role) {
    setRole(newRole)
    if (newRole !== 'commercial') {
      setSecteurId('')
      setManagerId('')
    }
  }

  async function handleSave() {
    setError('')
    try {
      await modifierUtilisateur(profile.id, role, secteurId || null, managerId || null)
      setEditing(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la modification')
    }
  }

  async function handleDelete() {
    if (!confirm(`Supprimer ${profile.email} ?`)) return
    await supprimerUtilisateur(profile.id)
  }

  if (!editing) {
    return (
      <tr>
        <td>{profile.email}</td>
        <td>{profile.role}</td>
        <td>{secteurs.find(s => s.id === profile.secteur_id)?.nom ?? '-'}</td>
        <td>{managers.find(m => m.id === profile.manager_id)?.email ?? '-'}</td>
        <td className="flex gap-2">
          <button onClick={() => setEditing(true)} className="text-blue-600 underline">Modifier</button>
          <button onClick={handleDelete} className="text-red-600 underline">Supprimer</button>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td>{profile.email}</td>
      <td colSpan={3} className="flex gap-2 items-center py-1">
        <select value={role} onChange={e => handleRoleChange(e.target.value as Role)} className="border rounded px-2 py-1">
          <option value="commercial">Commercial</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
        {role === 'commercial' && (
          <>
            <select value={secteurId} onChange={e => setSecteurId(e.target.value)} className="border rounded px-2 py-1">
              <option value="">Secteur...</option>
              {secteurs.map(s => <option key={s.id} value={s.id}>{s.nom}</option>)}
            </select>
            <select value={managerId} onChange={e => setManagerId(e.target.value)} className="border rounded px-2 py-1">
              <option value="">Manager...</option>
              {managers.map(m => <option key={m.id} value={m.id}>{m.email}</option>)}
            </select>
          </>
        )}
        {error && <span className="text-red-600 text-sm">{error}</span>}
      </td>
      <td className="flex gap-2">
        <button onClick={handleSave} className="text-green-600 underline">Enregistrer</button>
        <button onClick={() => setEditing(false)} className="text-gray-600 underline">Annuler</button>
      </td>
    </tr>
  )
}
