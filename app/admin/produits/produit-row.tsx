'use client'
import { useState, useTransition } from 'react'
import { definirAssortiment, definirPriorite, definirStatutDisponibilite, supprimerProduit } from '@/lib/produits/actions'
import { ENSEIGNES, type Produit, type StatutDisponibilite } from '@/lib/types'

const LIBELLES_STATUT: Record<StatutDisponibilite, string> = {
  commandable: 'Commandable',
  non_commandable: 'Non commandable (déréférencé)',
  arret_industriel: 'Arrêt industriel',
  en_attente_referencement: 'En attente de référencement',
}

export function ProduitRow({
  produit,
  enseignesActuelles,
  rangActuel,
  statutParEnseigne,
}: {
  produit: Produit
  enseignesActuelles: Set<string>
  rangActuel: 20 | 50 | 70 | null
  statutParEnseigne: Map<string, StatutDisponibilite>
}) {
  const [enseignes, setEnseignes] = useState(enseignesActuelles)
  const [rang, setRang] = useState(rangActuel)
  const [statuts, setStatuts] = useState(statutParEnseigne)
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

  function handleStatutChange(enseigne: string, statut: StatutDisponibilite) {
    const next = new Map(statuts)
    next.set(enseigne, statut)
    setStatuts(next)
    startTransition(() => { definirStatutDisponibilite(produit.id, enseigne, statut) })
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
          {enseignes.has(e) && (
            <select
              value={statuts.get(e) ?? 'commandable'}
              onChange={ev => handleStatutChange(e, ev.target.value as StatutDisponibilite)}
              className="block text-[10px] border rounded mt-1"
            >
              {Object.entries(LIBELLES_STATUT).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          )}
        </td>
      ))}
      <td>
        <button onClick={handleDelete} className="text-red-600 underline text-sm">Supprimer</button>
      </td>
    </tr>
  )
}
