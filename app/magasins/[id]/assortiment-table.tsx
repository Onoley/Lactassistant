'use client'
import { useMemo, useState } from 'react'
import type { Produit, StatutProduit } from '@/lib/types'
import { StatutSelect } from './statut-select'
import { nomComplet } from '@/lib/engine/nom-complet'

export function AssortimentTable({
  magasinId,
  produits,
  statutParProduit,
}: {
  magasinId: string
  produits: Produit[]
  statutParProduit: Map<string, StatutProduit>
}) {
  const [recherche, setRecherche] = useState('')

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    if (!q) return produits
    return produits.filter(p => p.nom.toLowerCase().includes(q) || p.code.includes(q))
  }, [produits, recherche])

  return (
    <div className="space-y-2">
      <input
        value={recherche}
        onChange={e => setRecherche(e.target.value)}
        placeholder={`Rechercher parmi ${produits.length} produits (nom, EAN)...`}
        className="border rounded px-3 py-2 w-full max-w-md"
      />
      <table className="w-full text-sm">
        <thead><tr><th className="text-left">Produit</th><th className="text-left">Statut</th></tr></thead>
        <tbody>
          {filtres.map(p => (
            <tr key={p.id}>
              <td>{nomComplet(p)}</td>
              <td>
                <StatutSelect magasinId={magasinId} produitId={p.id} statutActuel={statutParProduit.get(p.id) ?? 'present'} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
