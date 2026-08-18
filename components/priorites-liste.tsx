'use client'
import { useMemo, useState } from 'react'
import type { PrioriteHebdo, NiveauPriorite } from '@/lib/engine/priorites'
import { regrouperParPromo } from '@/lib/engine/regrouper-priorites'
import { nomComplet } from '@/lib/engine/nom-complet'

export const LIBELLE_NIVEAU: Record<NiveauPriorite, string> = { urgent: 'Urgent', cette_semaine: 'Cette semaine', a_anticiper: 'À anticiper' }
export const COULEUR_NIVEAU: Record<NiveauPriorite, string> = {
  urgent: 'bg-red-100 text-red-800 border-red-400',
  cette_semaine: 'bg-amber-100 text-amber-800 border-amber-400',
  a_anticiper: 'bg-blue-100 text-blue-800 border-blue-400',
}
const NIVEAUX: NiveauPriorite[] = ['urgent', 'cette_semaine', 'a_anticiper']

type Type = 'rupture' | 'promo_manquant' | 'op_trade'
const LIBELLE_TYPE: Record<Type, string> = {
  op_trade: 'OP Trade / temps fort',
  promo_manquant: 'Produit manquant en promotion',
  rupture: 'Rupture',
}
const TYPES: Type[] = ['op_trade', 'promo_manquant', 'rupture']

function typeDe(p: PrioriteHebdo): Type {
  if (!p.promo) return 'rupture'
  return p.promo.op_trade ? 'op_trade' : 'promo_manquant'
}

function toggle<T>(set: Set<T>, valeur: T): Set<T> {
  const next = new Set(set)
  if (next.has(valeur)) next.delete(valeur)
  else next.add(valeur)
  return next
}

export function PrioritesListe({
  priorites,
  variant,
  emailParSecteur,
}: {
  priorites: PrioriteHebdo[]
  variant: 'liste' | 'table'
  emailParSecteur?: Map<string, string>
}) {
  const enseignesPresentes = useMemo(
    () => Array.from(new Set(priorites.map(p => p.magasin.enseigne))).sort(),
    [priorites]
  )

  const [niveaux, setNiveaux] = useState<Set<NiveauPriorite>>(new Set(NIVEAUX))
  const [enseignes, setEnseignes] = useState<Set<string>>(new Set(enseignesPresentes))
  const [types, setTypes] = useState<Set<Type>>(new Set(TYPES))

  const filtrees = priorites.filter(p => niveaux.has(p.niveau) && enseignes.has(p.magasin.enseigne) && types.has(typeDe(p)))
  const groupes = regrouperParPromo(filtrees)

  return (
    <div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 mb-3 text-sm">
        <fieldset className="flex flex-wrap gap-3 items-center">
          <legend className="sr-only">Niveau</legend>
          {NIVEAUX.map(n => (
            <label key={n} className="flex items-center gap-1">
              <input type="checkbox" checked={niveaux.has(n)} onChange={() => setNiveaux(toggle(niveaux, n))} />
              {LIBELLE_NIVEAU[n]}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-wrap gap-3 items-center">
          <legend className="sr-only">Enseigne</legend>
          {enseignesPresentes.map(e => (
            <label key={e} className="flex items-center gap-1">
              <input type="checkbox" checked={enseignes.has(e)} onChange={() => setEnseignes(toggle(enseignes, e))} />
              {e}
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-wrap gap-3 items-center">
          <legend className="sr-only">Type</legend>
          {TYPES.map(t => (
            <label key={t} className="flex items-center gap-1">
              <input type="checkbox" checked={types.has(t)} onChange={() => setTypes(toggle(types, t))} />
              {LIBELLE_TYPE[t]}
            </label>
          ))}
        </fieldset>
      </div>

      {variant === 'liste' ? (
        <ul className="space-y-2">
          {groupes.slice(0, 15).map(g => (
            <li key={g.cle} className={`border rounded p-2 ${COULEUR_NIVEAU[g.niveau]}`}>
              <p className="font-medium">{g.magasin.nom} — {LIBELLE_NIVEAU[g.niveau]}</p>
              {g.promo && <p className="text-sm font-semibold">{g.promo.theme ?? g.promo.mecanique}</p>}
              <p className="text-sm">{g.raison}</p>
              <p className="text-sm text-gray-600">{g.produits.map(nomComplet).join(', ')}</p>
            </li>
          ))}
        </ul>
      ) : (
        <table className="w-full text-sm">
          <thead><tr><th className="text-left">Magasin</th><th className="text-left">Commercial</th><th className="text-left">Promo</th><th className="text-left">Produit(s)</th><th className="text-left">Niveau</th><th className="text-left">Raison</th></tr></thead>
          <tbody>
            {groupes.map(g => (
              <tr key={g.cle}>
                <td>{g.magasin.nom}</td>
                <td>{emailParSecteur?.get(g.magasin.secteur_id) ?? '-'}</td>
                <td>{g.promo ? (g.promo.theme ?? g.promo.mecanique) : '-'}</td>
                <td>{g.produits.map(nomComplet).join(', ')}</td>
                <td><span className={`px-2 py-0.5 rounded border text-xs ${COULEUR_NIVEAU[g.niveau]}`}>{LIBELLE_NIVEAU[g.niveau]}</span></td>
                <td>{g.raison}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
