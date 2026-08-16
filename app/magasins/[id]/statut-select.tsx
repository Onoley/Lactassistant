'use client'
import { useState, useTransition } from 'react'
import { updateStatutProduit } from '@/lib/statuts/actions'
import type { StatutProduit } from '@/lib/types'

export function StatutSelect({ magasinId, produitId, statutActuel }: { magasinId: string; produitId: string; statutActuel: StatutProduit }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function handleChange(statut: StatutProduit) {
    setError('')
    startTransition(async () => {
      try {
        await updateStatutProduit(magasinId, produitId, statut)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur lors de la mise à jour')
      }
    })
  }

  return (
    <div>
      <select
        defaultValue={statutActuel}
        disabled={pending}
        onChange={e => handleChange(e.target.value as StatutProduit)}
        className="border rounded px-2 py-1"
      >
        <option value="present">Présent</option>
        <option value="manquant">Manquant</option>
        <option value="rupture">Rupture</option>
      </select>
      {error && <p className="text-red-600 text-xs">{error}</p>}
    </div>
  )
}
