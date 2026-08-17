'use client'
import { useState, useTransition } from 'react'
import { definirPdl } from '@/lib/pdl/actions'

type ChampPdl = 'pdl_generale' | 'pdl_yaos' | 'pdl_siggis' | 'pdl_dessert'

const CHAMPS: Array<{ cle: ChampPdl; label: string }> = [
  { cle: 'pdl_generale', label: 'PDL générale' },
  { cle: 'pdl_yaos', label: 'PDL YAOS' },
  { cle: 'pdl_siggis', label: "PDL SIGGI'S" },
  { cle: 'pdl_dessert', label: 'PDL Dessert (Viennois + La Laitière)' },
]

export function PdlBloc({ magasinId, pdl }: { magasinId: string; pdl: Record<ChampPdl, number | null> }) {
  const [valeurs, setValeurs] = useState(pdl)
  const [pending, startTransition] = useTransition()

  function handleBlur(cle: ChampPdl, valeurTexte: string) {
    const nombre = valeurTexte.trim() === '' ? null : Number(valeurTexte)
    if (nombre !== null && !Number.isFinite(nombre)) return
    setValeurs({ ...valeurs, [cle]: nombre })
    startTransition(() => { definirPdl(magasinId, cle, nombre) })
  }

  return (
    <div className={`flex flex-wrap gap-4 border rounded p-3 text-sm ${pending ? 'opacity-50' : ''}`}>
      {CHAMPS.map(({ cle, label }) => (
        <label key={cle} className="flex items-center gap-2">
          {label}
          <input
            type="number"
            step="0.1"
            defaultValue={valeurs[cle] ?? ''}
            placeholder="-"
            onBlur={e => handleBlur(cle, e.target.value)}
            className="border rounded px-2 py-1 w-20"
          />
          %
        </label>
      ))}
    </div>
  )
}
