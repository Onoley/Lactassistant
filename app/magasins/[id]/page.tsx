import { notFound, redirect } from 'next/navigation'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import type { Produit, Promo, StatutProduit } from '@/lib/types'
import { chargerProduitsATravailler } from '@/lib/engine/fiche-magasin'
import { prioritesSemaine } from '@/lib/engine/priorites'
import { PdlBloc } from './pdl-bloc'
import { PrioritesMagasin } from './priorites-magasin'
import { ProduitATravaillerCarte } from './produit-a-travailler-carte'
import { AssortimentTable } from './assortiment-table'

export default async function FicheMagasinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) redirect('/login')
  if (profile.role !== 'commercial') redirect('/equipe')

  const { data: magasin } = await supabase.from('magasins').select('*').eq('id', id).single()
  if (!magasin) notFound()

  const [{ data: produits }, { data: statuts }, { data: pdl }, { data: produitsEnseigne }, { data: promoLiens }] = await Promise.all([
    supabase.from('produits').select('*').order('nom'),
    supabase.from('statuts_produit_magasin').select('*').eq('magasin_id', magasin.id),
    supabase.from('pdl_magasin').select('*').eq('magasin_id', magasin.id).maybeSingle(),
    supabase.from('produits_enseigne').select('*').eq('enseigne', magasin.enseigne).eq('actif', true),
    supabase.from('promo_produits').select('produit_id, promos!inner(*)').eq('promos.enseigne', magasin.enseigne),
  ])

  const statutParProduit = new Map((statuts ?? []).map(s => [s.produit_id, s.statut as StatutProduit]))
  const produitsParId = new Map<string, Produit>((produits ?? []).map(p => [p.id, p]))
  const typologieParProduit = new Map((produitsEnseigne ?? []).map(pe => [pe.produit_id, pe.typologie]))
  const produitsAssortiment = (produits ?? []).filter(p => typologieParProduit.has(p.id))
  const promosParProduitId = new Map<string, Promo[]>()
  for (const lien of promoLiens ?? []) {
    const liste = promosParProduitId.get(lien.produit_id) ?? []
    liste.push(lien.promos as unknown as Promo)
    promosParProduitId.set(lien.produit_id, liste)
  }

  const produitsATravailler = await chargerProduitsATravailler(magasin.id)
  const prioritesHebdo = prioritesSemaine(
    [magasin], statuts ?? [], produitsParId, produitsEnseigne ?? [], promosParProduitId
  )

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold">{magasin.nom} — {magasin.enseigne}</h1>
        <p className="text-sm text-gray-600">{magasin.adresse}</p>
        {magasin.contact_nom && (
          <p className="text-sm">Contact : {magasin.contact_nom} — {magasin.contact_telephone} — {magasin.contact_email}</p>
        )}
      </div>

      <PdlBloc
        magasinId={magasin.id}
        pdl={{
          pdl_generale: pdl?.pdl_generale ?? null,
          pdl_yaos: pdl?.pdl_yaos ?? null,
          pdl_siggis: pdl?.pdl_siggis ?? null,
          pdl_dessert: pdl?.pdl_dessert ?? null,
        }}
      />

      <PrioritesMagasin priorites={prioritesHebdo} />

      <div className="space-y-3">
        <h2 className="font-semibold">Produits manquants à travailler</h2>
        {produitsATravailler.length === 0 ? (
          <p className="text-sm text-gray-500">Aucun produit manquant à travailler pour ce magasin.</p>
        ) : (
          produitsATravailler.map(item => (
            <ProduitATravaillerCarte key={item.produit.id} magasinId={magasin.id} item={item} />
          ))
        )}
      </div>

      <div>
        <h2 className="font-semibold mb-2">Assortiment</h2>
        <AssortimentTable
          magasinId={magasin.id}
          produits={produitsAssortiment}
          statutParProduit={statutParProduit}
          typologieParProduit={typologieParProduit}
        />
      </div>
    </div>
  )
}
