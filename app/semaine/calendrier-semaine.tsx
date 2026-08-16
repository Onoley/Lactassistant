'use client'
import { useState, useTransition } from 'react'
import { planifierVisite, marquerRealisee, retirerVisite } from '@/lib/visites/actions'
import { dateDuJour } from '@/lib/semaine'
import type { Magasin, Visite } from '@/lib/types'

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']

export function CalendrierSemaine({ semaine, magasins, visites }: { semaine: string; magasins: Magasin[]; visites: Visite[] }) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const magasinParId = new Map(magasins.map(m => [m.id, m]))

  function handlePlanifier(magasinId: string, jour: string) {
    setError('')
    startTransition(async () => {
      try {
        await planifierVisite(magasinId, semaine, jour)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur lors de la planification')
      }
    })
  }

  function handleMarquerRealisee(visiteId: string) {
    setError('')
    startTransition(async () => {
      try {
        await marquerRealisee(visiteId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur lors de la mise à jour')
      }
    })
  }

  function handleRetirer(visiteId: string) {
    setError('')
    startTransition(async () => {
      try {
        await retirerVisite(visiteId)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erreur lors du retrait')
      }
    })
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Ma semaine ({semaine})</h1>
      {error && <p className="text-red-600 text-sm mb-2">{error}</p>}
      <div className="grid grid-cols-5 gap-2">
        {JOURS.map((jour, i) => (
          <div key={jour} className="border rounded p-2">
            <h2 className="font-semibold text-sm mb-2">{jour}</h2>
            {visites.filter(v => v.jour === dateDuJour(semaine, i)).map(v => (
              <div key={v.id} className="text-xs border-b py-1">
                <p>{magasinParId.get(v.magasin_id)?.nom}</p>
                <p className="text-gray-500">{v.statut}</p>
                {v.statut === 'planifie' && (
                  <button disabled={pending} onClick={() => handleMarquerRealisee(v.id)} className="underline mr-2">
                    Réalisée
                  </button>
                )}
                <button disabled={pending} onClick={() => handleRetirer(v.id)} className="underline">
                  Retirer
                </button>
              </div>
            ))}
            <select
              onChange={e => e.target.value && handlePlanifier(e.target.value, dateDuJour(semaine, i))}
              defaultValue=""
              className="text-xs border rounded mt-2 w-full"
            >
              <option value="">+ ajouter magasin</option>
              {magasins.map(m => <option key={m.id} value={m.id}>{m.nom}</option>)}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}
