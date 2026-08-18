'use client'
import { useState } from 'react'
import type { PrioriteHebdo } from '@/lib/engine/priorites'
import { COULEUR_NIVEAU, LIBELLE_NIVEAU } from '@/components/priorites-liste'
import { nomComplet } from '@/lib/engine/nom-complet'

export function PrioritesMagasin({ priorites }: { priorites: PrioriteHebdo[] }) {
  const [ouvertes, setOuvertes] = useState<Set<number>>(new Set())

  function toggle(i: number) {
    const next = new Set(ouvertes)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setOuvertes(next)
  }

  if (priorites.length === 0) return null

  return (
    <div className="space-y-2">
      <h2 className="font-semibold">Priorités de ce magasin</h2>
      {priorites.map((p, i) => (
        <div key={`${p.produit.id}-${i}`} className={`border rounded p-2 ${COULEUR_NIVEAU[p.niveau]}`}>
          <div className="flex items-center justify-between">
            <span className="font-medium">{nomComplet(p.produit)} — {LIBELLE_NIVEAU[p.niveau]}</span>
            <button onClick={() => toggle(i)} className="text-xs underline">
              {ouvertes.has(i) ? 'Masquer' : 'Voir'} les raisons
            </button>
          </div>
          {ouvertes.has(i) && <p className="text-sm mt-1">{p.raison}</p>}
        </div>
      ))}
    </div>
  )
}
