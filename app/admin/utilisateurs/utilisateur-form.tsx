'use client'
import { useState } from 'react'
import { creerUtilisateur } from '@/lib/utilisateurs/actions'
import type { Role } from '@/lib/types'

export function UtilisateurForm({ secteurs, managers }: { secteurs: { id: string; nom: string }[]; managers: { id: string; email: string }[] }) {
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [role, setRole] = useState<Role>('commercial')
  const [secteurId, setSecteurId] = useState('')
  const [managerId, setManagerId] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await creerUtilisateur(email, role, secteurId || null, managerId || null, motDePasse || undefined)
      setEmail('')
      setMotDePasse('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création')
    }
  }

  function handleRoleChange(newRole: Role) {
    setRole(newRole)
    if (newRole !== 'commercial') {
      setSecteurId('')
      setManagerId('')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-end flex-wrap">
      <input required type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email" className="border rounded px-2 py-1" />
      <input
        type="text"
        value={motDePasse}
        onChange={e => setMotDePasse(e.target.value)}
        placeholder="mot de passe (optionnel)"
        className="border rounded px-2 py-1"
        title="Si renseigné, le compte de connexion est créé immédiatement avec ce mot de passe. Sinon, la personne devra se connecter par lien magique la première fois."
      />
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
      <button type="submit" className="bg-blue-600 text-white px-3 py-1 rounded">Ajouter</button>
      {error && <div className="w-full text-red-600 text-sm">{error}</div>}
    </form>
  )
}
