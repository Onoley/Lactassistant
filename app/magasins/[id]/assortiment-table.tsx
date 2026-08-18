'use client'
import { useMemo, useState } from 'react'
import type { Produit, StatutProduit, Typologie } from '@/lib/types'
import { StatutSelect } from './statut-select'
import { nomComplet } from '@/lib/engine/nom-complet'

const SANS_FAMILLE = 'Sans famille'
const SANS_SEGMENT = 'Sans segment'

// Tri alphabétique, valeurs null regroupées à la fin (peu importe où
// "Sans famille"/"Sans segment" tomberait alphabétiquement).
function trierAvecNullDernier(cles: (string | null)[]): (string | null)[] {
  return [...cles].sort((a, b) => {
    if (a === b) return 0
    if (a === null) return 1
    if (b === null) return -1
    return a.localeCompare(b)
  })
}

function grouperParFamilleEtSegment(produits: Produit[]): Map<string | null, Map<string | null, Produit[]>> {
  const groupes = new Map<string | null, Map<string | null, Produit[]>>()
  for (const p of produits) {
    if (!groupes.has(p.famille)) groupes.set(p.famille, new Map())
    const segments = groupes.get(p.famille)!
    if (!segments.has(p.segment)) segments.set(p.segment, [])
    segments.get(p.segment)!.push(p)
  }
  for (const segments of groupes.values()) {
    for (const liste of segments.values()) {
      liste.sort((a, b) => nomComplet(a).localeCompare(nomComplet(b)))
    }
  }
  return groupes
}

export function AssortimentTable({
  magasinId,
  produits,
  statutParProduit,
  typologieParProduit,
  rangParProduit,
}: {
  magasinId: string
  produits: Produit[]
  statutParProduit: Map<string, StatutProduit>
  typologieParProduit: Map<string, Typologie | null>
  rangParProduit: Map<string, 20 | 50 | 70>
}) {
  const [recherche, setRecherche] = useState('')

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    if (!q) return produits
    return produits.filter(p => p.nom.toLowerCase().includes(q) || p.code.includes(q))
  }, [produits, recherche])

  const groupes = useMemo(() => grouperParFamilleEtSegment(filtres), [filtres])
  const familles = useMemo(() => trierAvecNullDernier([...groupes.keys()]), [groupes])

  return (
    <div className="space-y-2">
      <input
        value={recherche}
        onChange={e => setRecherche(e.target.value)}
        placeholder={`Rechercher parmi ${produits.length} produits (nom, EAN)...`}
        className="border rounded px-3 py-2 w-full max-w-md"
      />
      <div className="space-y-4">
        {familles.map(famille => {
          const segments = groupes.get(famille)!
          const segmentsTries = trierAvecNullDernier([...segments.keys()])
          return (
            <div key={famille ?? '__sans_famille__'}>
              <h3 className="font-semibold">{famille ?? SANS_FAMILLE}</h3>
              {segmentsTries.map(segment => (
                <div key={segment ?? '__sans_segment__'} className="ml-4 mb-3">
                  <h4 className="text-sm font-medium text-gray-700">{segment ?? SANS_SEGMENT}</h4>
                  <table className="w-full text-sm">
                    <thead>
                      <tr>
                        <th className="text-left">Produit</th>
                        <th className="text-left">Typologie</th>
                        <th className="text-left">Statut</th>
                      </tr>
                    </thead>
                    <tbody>
                      {segments.get(segment)!.map(p => (
                        <tr key={p.id}>
                          <td>
                            <div>
                              {nomComplet(p)}
                              {rangParProduit.get(p.id) && <span className="text-xs text-gray-500 ml-2">Top {rangParProduit.get(p.id)}</span>}
                            </div>
                            <div className="text-xs text-gray-500">EAN {p.code}</div>
                          </td>
                          <td>{typologieParProduit.get(p.id) ?? '—'}</td>
                          <td>
                            <StatutSelect magasinId={magasinId} produitId={p.id} statutActuel={statutParProduit.get(p.id) ?? 'present'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
