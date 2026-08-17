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

  // Trié par importance décroissante (rang Top70, magasins comparables,
  // promo) — les manquants les plus importants à pousser apparaissent en
  // premier.
  const lignesImportance = await chargerArgumentsFicheMagasin(magasin.id)
  const importanceParProduit = new Map(lignesImportance.map(l => [l.produitId, l]))
  const idsManquants = new Set(lignesImportance.map(l => l.produitId))
  const produitsParId = new Map((produits ?? []).map(p => [p.id, p]))

  const produitsTries = [
    ...lignesImportance.map(l => produitsParId.get(l.produitId)).filter((p): p is NonNullable<typeof p> => Boolean(p)),
    ...(produits ?? []).filter(p => !idsManquants.has(p.id)),
  ]

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
          {produitsTries.map(p => (
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
              {importanceParProduit.get(p.id)?.raisons.map((raison, i) => (
                <tr key={`${p.id}-raison-${i}`}>
                  <td colSpan={2} className="text-sm text-amber-700 pl-4">{raison}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
