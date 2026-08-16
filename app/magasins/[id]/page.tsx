import { Fragment } from 'react'
import { notFound, redirect } from 'next/navigation'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import type { StatutProduit } from '@/lib/types'
import { chargerArgumentsFicheMagasin } from '@/lib/engine/fiche-magasin'
import { StatutSelect } from './statut-select'

export default async function FicheMagasinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) redirect('/login')
  if (profile.role !== 'commercial') redirect('/equipe')

  const { data: magasin } = await supabase.from('magasins').select('*').eq('id', id).single()
  if (!magasin) notFound()

  const { data: produits } = await supabase.from('produits').select('*').order('nom')
  const { data: statuts } = await supabase.from('statuts_produit_magasin').select('*').eq('magasin_id', magasin.id)
  const statutParProduit = new Map((statuts ?? []).map(s => [s.produit_id, s.statut as StatutProduit]))

  const lignesAvecArguments = await chargerArgumentsFicheMagasin(magasin.id)
  const argumentsParProduit = new Map(lignesAvecArguments.map(l => [l.produitId, l]))

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">{magasin.nom} — {magasin.enseigne}</h1>
      <p className="text-sm text-gray-600">{magasin.adresse}</p>
      {magasin.contact_nom && (
        <p className="text-sm">Contact : {magasin.contact_nom} — {magasin.contact_telephone} — {magasin.contact_email}</p>
      )}

      <table className="w-full text-sm">
        <thead><tr><th className="text-left">Produit</th><th className="text-left">Statut</th></tr></thead>
        <tbody>
          {(produits ?? []).map(p => (
            <Fragment key={p.id}>
              <tr>
                <td>{p.nom}</td>
                <td>
                  <StatutSelect
                    magasinId={magasin.id}
                    produitId={p.id}
                    statutActuel={statutParProduit.get(p.id) ?? 'present'}
                  />
                </td>
              </tr>
              {argumentsParProduit.get(p.id)?.arguments.map((arg, i) => (
                <tr key={`${p.id}-arg-${i}`}>
                  <td colSpan={2} className="text-sm text-amber-700 pl-4">{arg.message}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
