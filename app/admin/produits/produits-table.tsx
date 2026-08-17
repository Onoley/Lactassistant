'use client'
import { useMemo, useState } from 'react'
import { ProduitRow } from './produit-row'
import { ENSEIGNES, type PrioriteProduit, type Produit, type ProduitEnseigne, type StatutDisponibilite } from '@/lib/types'

export function ProduitsTable({
  produits,
  produitsEnseigne,
  priorites,
}: {
  produits: Produit[]
  produitsEnseigne: ProduitEnseigne[]
  priorites: PrioriteProduit[]
}) {
  const [recherche, setRecherche] = useState('')

  const enseignesParProduit = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const pe of produitsEnseigne) {
      if (!map.has(pe.produit_id)) map.set(pe.produit_id, new Set())
      map.get(pe.produit_id)!.add(pe.enseigne)
    }
    return map
  }, [produitsEnseigne])

  const rangParProduit = useMemo(() => {
    const map = new Map<string, 20 | 50 | 70>()
    for (const p of priorites) map.set(p.produit_id, p.rang)
    return map
  }, [priorites])

  const statutParProduitEtEnseigne = useMemo(() => {
    const map = new Map<string, Map<string, StatutDisponibilite>>()
    for (const pe of produitsEnseigne) {
      if (!map.has(pe.produit_id)) map.set(pe.produit_id, new Map())
      map.get(pe.produit_id)!.set(pe.enseigne, pe.statut_disponibilite)
    }
    return map
  }, [produitsEnseigne])

  const typologieParProduitEtEnseigne = useMemo(() => {
    const map = new Map<string, Map<string, string | null>>()
    for (const pe of produitsEnseigne) {
      if (!map.has(pe.produit_id)) map.set(pe.produit_id, new Map())
      map.get(pe.produit_id)!.set(pe.enseigne, pe.typologie)
    }
    return map
  }, [produitsEnseigne])

  const filtres = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    if (!q) return produits
    return produits.filter(p =>
      p.nom.toLowerCase().includes(q) ||
      p.code.includes(q) ||
      (p.marque ?? '').toLowerCase().includes(q) ||
      (p.categorie ?? '').toLowerCase().includes(q)
    )
  }, [produits, recherche])

  return (
    <div className="space-y-3">
      <input
        value={recherche}
        onChange={e => setRecherche(e.target.value)}
        placeholder={`Rechercher parmi ${produits.length} produits (nom, EAN, marque, catégorie)...`}
        className="border rounded px-3 py-2 w-full max-w-md"
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="text-left">EAN</th>
              <th className="text-left">Nom</th>
              <th className="text-left">Détail</th>
              <th className="text-left">Priorité</th>
              {ENSEIGNES.map(e => <th key={e} className="text-center text-xs">{e}</th>)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtres.map(p => (
              <ProduitRow
                key={p.id}
                produit={p}
                enseignesActuelles={enseignesParProduit.get(p.id) ?? new Set()}
                rangActuel={rangParProduit.get(p.id) ?? null}
                statutParEnseigne={statutParProduitEtEnseigne.get(p.id) ?? new Map()}
                typologieParEnseigne={typologieParProduitEtEnseigne.get(p.id) ?? new Map()}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
