'use client'
import { useState, useTransition } from 'react'
import type { ProduitATravailler } from '@/lib/engine/produit-a-travailler'
import { definirRaisonAbsence } from '@/lib/statuts/actions'
import { COULEUR_NIVEAU, LIBELLE_NIVEAU } from '@/components/priorites-liste'
import type { RaisonAbsence } from '@/lib/types'
import { nomComplet } from '@/lib/engine/nom-complet'

const LIBELLES_RAISON: Record<RaisonAbsence, string> = {
  pas_de_place_rayon: 'Pas de place en rayon',
  frein_prix: 'Frein prix',
  jamais_reference: 'Jamais référencé',
  concurrence_privilegiee: 'Concurrence privilégiée',
  autre: 'Autre',
}

export function ProduitATravaillerCarte({ magasinId, item }: { magasinId: string; item: ProduitATravailler }) {
  const [raison, setRaison] = useState(item.raisonAbsence)
  const [pending, startTransition] = useTransition()

  function handleRaisonChange(value: string) {
    const nouvelleRaison = value === '' ? null : (value as RaisonAbsence)
    setRaison(nouvelleRaison)
    startTransition(() => { definirRaisonAbsence(magasinId, item.produit.id, nouvelleRaison) })
  }

  return (
    <div className={`border rounded p-3 space-y-2 ${pending ? 'opacity-50' : ''}`}>
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">{nomComplet(item.produit)}</span>
          <span className="text-xs text-gray-500 ml-2">{item.produit.code}</span>
          {item.rang && <span className="text-xs text-gray-500 ml-2">Top {item.rang}</span>}
        </div>
        {item.momentum && (
          <span className={`text-xs rounded border px-2 py-0.5 ${COULEUR_NIVEAU[item.momentum]}`}>{LIBELLE_NIVEAU[item.momentum]}</span>
        )}
      </div>

      <p className="text-sm">{item.argumentaire}</p>

      {item.questionsDecouverte.length > 0 && (
        <ul className="text-xs text-gray-600 list-disc list-inside">
          {item.questionsDecouverte.map((q, i) => <li key={i}>{q}</li>)}
        </ul>
      )}

      <label className="text-xs flex items-center gap-2">
        Raison d&apos;absence :
        <select value={raison ?? ''} onChange={e => handleRaisonChange(e.target.value)} className="border rounded px-1 py-0.5">
          <option value="">-</option>
          {Object.entries(LIBELLES_RAISON).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
