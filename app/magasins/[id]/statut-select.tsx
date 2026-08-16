'use client'
import { useTransition } from 'react'
import { updateStatutProduit } from '@/lib/statuts/actions'
import type { StatutProduit } from '@/lib/types'

export function StatutSelect({ magasinId, produitId, statutActuel }: { magasinId: string; produitId: string; statutActuel: StatutProduit }) {
  const [pending, startTransition] = useTransition()

  return (
    <select
      defaultValue={statutActuel}
      disabled={pending}
      onChange={e => startTransition(() => updateStatutProduit(magasinId, produitId, e.target.value as StatutProduit))}
      className="border rounded px-2 py-1"
    >
      <option value="present">Présent</option>
      <option value="manquant">Manquant</option>
      <option value="rupture">Rupture</option>
    </select>
  )
}
