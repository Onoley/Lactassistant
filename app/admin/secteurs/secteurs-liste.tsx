'use client'
import { useState } from 'react'
import { creerSecteur, modifierSecteur, supprimerSecteur } from '@/lib/secteurs/actions'

interface SecteurAvecCompteurs {
  id: string
  nom: string
  nbMagasins: number
  nbCommerciaux: number
}

function LigneSecteur({ secteur, onError }: { secteur: SecteurAvecCompteurs; onError: (message: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [nom, setNom] = useState(secteur.nom)

  async function handleSave() {
    onError('')
    try {
      await modifierSecteur(secteur.id, nom)
      setEditing(false)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur lors du renommage')
    }
  }

  async function handleDelete() {
    onError('')
    if (!confirm(`Supprimer le secteur "${secteur.nom}" ?`)) return
    try {
      await supprimerSecteur(secteur.id)
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Erreur lors de la suppression')
    }
  }

  return (
    <tr>
      <td>
        {editing ? (
          <input value={nom} onChange={e => setNom(e.target.value)} className="border rounded px-2 py-1" />
        ) : (
          secteur.nom
        )}
      </td>
      <td>{secteur.nbMagasins}</td>
      <td>{secteur.nbCommerciaux}</td>
      <td className="flex gap-2">
        {editing ? (
          <>
            <button onClick={handleSave} className="text-green-600 underline">Enregistrer</button>
            <button onClick={() => { setEditing(false); setNom(secteur.nom) }} className="text-gray-600 underline">Annuler</button>
          </>
        ) : (
          <>
            <button onClick={() => setEditing(true)} className="text-blue-600 underline">Modifier</button>
            <button onClick={handleDelete} className="text-red-600 underline">Supprimer</button>
          </>
        )}
      </td>
    </tr>
  )
}

export function SecteursListe({ secteurs }: { secteurs: SecteurAvecCompteurs[] }) {
  const [nom, setNom] = useState('')
  const [error, setError] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await creerSecteur(nom)
      setNom('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création')
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={handleCreate} className="flex gap-2 items-end">
        <input required value={nom} onChange={e => setNom(e.target.value)} placeholder="Nom du secteur" className="border rounded px-2 py-1" />
        <button type="submit" className="bg-blue-600 text-white px-3 py-1 rounded">Créer</button>
      </form>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      <table className="w-full text-sm max-w-lg">
        <thead><tr><th className="text-left">Secteur</th><th className="text-left">Magasins</th><th className="text-left">Commerciaux</th><th></th></tr></thead>
        <tbody>
          {secteurs.map(s => (
            <LigneSecteur key={s.id} secteur={s} onError={setError} />
          ))}
        </tbody>
      </table>
    </div>
  )
}
