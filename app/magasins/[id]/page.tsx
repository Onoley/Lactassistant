import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/server'
import type { StatutProduit } from '@/lib/types'

export default async function FicheMagasinPage({ params }: { params: { id: string } }) {
  const supabase = createServerClient()
  const { data: magasin } = await supabase.from('magasins').select('*').eq('id', params.id).single()
  if (!magasin) notFound()

  const { data: produits } = await supabase.from('produits').select('*').order('nom')
  const { data: statuts } = await supabase.from('statuts_produit_magasin').select('*').eq('magasin_id', magasin.id)
  const statutParProduit = new Map((statuts ?? []).map(s => [s.produit_id, s.statut as StatutProduit]))

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
            <tr key={p.id}>
              <td>{p.nom}</td>
              <td>{statutParProduit.get(p.id) ?? 'present'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
