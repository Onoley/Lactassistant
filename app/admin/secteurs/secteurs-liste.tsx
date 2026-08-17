'use client'
import { useState } from 'react'
import { creerSecteur, supprimerSecteur } from '@/lib/secteurs/actions'

interface SecteurAvecCompteurs {
  id: string
  nom: string
  nbMagasins: number
  nbCommerciaux: number
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

  async function handleDelete(id: string, nomSecteur: string) {
    setError('')
    if (!confirm(`Supprimer le secteur "${nomSecteur}" ?`)) return
    try {
      await supprimerSecteur(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la suppression')
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
            <tr key={s.id}>
              <td>{s.nom}</td>
              <td>{s.nbMagasins}</td>
              <td>{s.nbCommerciaux}</td>
              <td><button onClick={() => handleDelete(s.id, s.nom)} className="text-red-600 underline">Supprimer</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
