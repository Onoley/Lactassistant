'use client'
import { useState, useTransition } from 'react'
import { definirAssortiment, definirPriorite, supprimerProduit } from '@/lib/produits/actions'
import { ENSEIGNES, type Produit } from '@/lib/types'

export function ProduitRow({
  produit,
  enseignesActuelles,
  rangActuel,
}: {
  produit: Produit
  enseignesActuelles: Set<string>
  rangActuel: 20 | 50 | 70 | null
}) {
  const [enseignes, setEnseignes] = useState(enseignesActuelles)
  const [rang, setRang] = useState(rangActuel)
  const [pending, startTransition] = useTransition()

  function toggleEnseigne(enseigne: string) {
    const present = !enseignes.has(enseigne)
    const next = new Set(enseignes)
    if (present) next.add(enseigne)
    else next.delete(enseigne)
    setEnseignes(next)
    startTransition(() => { definirAssortiment(produit.id, enseigne, present) })
  }

  function handleRangChange(value: string) {
    const nouveauRang = value === '' ? null : (Number(value) as 20 | 50 | 70)
    setRang(nouveauRang)
    startTransition(() => { definirPriorite(produit.id, nouveauRang) })
  }

  async function handleDelete() {
    if (!confirm(`Supprimer "${produit.nom}" (${produit.code}) ?`)) return
    await supprimerProduit(produit.id)
  }

  return (
    <tr className={pending ? 'opacity-50' : ''}>
      <td className="whitespace-nowrap font-mono text-xs">{produit.code}</td>
      <td>{produit.nom}</td>
      <td className="text-xs text-gray-500">{[produit.marque, produit.parfum, produit.format].filter(Boolean).join(' · ') || produit.categorie}</td>
      <td>
        <select value={rang ?? ''} onChange={e => handleRangChange(e.target.value)} className="border rounded px-1 py-0.5 text-sm">
          <option value="">-</option>
          <option value="20">Top 20</option>
          <option value="50">Top 50</option>
          <option value="70">Top 70</option>
        </select>
      </td>
      {ENSEIGNES.map(e => (
        <td key={e} className="text-center">
          <input type="checkbox" checked={enseignes.has(e)} onChange={() => toggleEnseigne(e)} />
        </td>
      ))}
      <td>
        <button onClick={handleDelete} className="text-red-600 underline text-sm">Supprimer</button>
      </td>
    </tr>
  )
}
