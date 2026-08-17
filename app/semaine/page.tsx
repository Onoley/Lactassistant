import { redirect } from 'next/navigation'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { prioritesSemaine } from '@/lib/engine/priorites'
import { numeroSemaineCourante } from '@/lib/semaine'
import { CalendrierSemaine } from './calendrier-semaine'
import type { Produit, Promo } from '@/lib/types'

const LIBELLE_NIVEAU = { urgent: 'Urgent', cette_semaine: 'Cette semaine', a_anticiper: 'À anticiper' } as const

export default async function SemainePage() {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) redirect('/login')
  if (profile.role !== 'commercial') redirect('/equipe')

  const semaine = numeroSemaineCourante()

  const [{ data: magasins }, { data: produits }, { data: produitsEnseigne }, { data: promoLiens }, { data: visites }] = await Promise.all([
    supabase.from('magasins').select('*'),
    supabase.from('produits').select('*'),
    supabase.from('produits_enseigne').select('*'),
    supabase.from('promo_produits').select('produit_id, promos(*)'),
    supabase.from('visites').select('*').eq('semaine', semaine).eq('commercial_id', profile.id),
  ])

  const magasinIds = (magasins ?? []).map(m => m.id)
  const { data: statuts } = await supabase
    .from('statuts_produit_magasin')
    .select('*')
    .in('magasin_id', magasinIds.length ? magasinIds : ['00000000-0000-0000-0000-000000000000'])

  const produitsParId = new Map<string, Produit>((produits ?? []).map(p => [p.id, p]))
  const promosParProduitId = new Map<string, Promo[]>()
  for (const lien of promoLiens ?? []) {
    const liste = promosParProduitId.get(lien.produit_id) ?? []
    liste.push(lien.promos as unknown as Promo)
    promosParProduitId.set(lien.produit_id, liste)
  }

  const prioritesHebdo = prioritesSemaine(
    magasins ?? [], statuts ?? [], produitsParId, produitsEnseigne ?? [], promosParProduitId
  )

  const magasinIdsPlanifies = new Set((visites ?? []).map(v => v.magasin_id))
  const nonCouvertes = prioritesHebdo.filter(p => !magasinIdsPlanifies.has(p.magasin.id))

  return (
    <div className="p-6 grid grid-cols-2 gap-6">
      <div>
        <h1 className="text-xl font-bold mb-4">Priorités de la semaine</h1>
        {nonCouvertes.length > 0 && (
          <div className="bg-amber-100 border border-amber-400 rounded p-3 mb-4 text-sm">
            {nonCouvertes.length} priorité(s) ne sont pas couvertes par votre semaine planifiée.
          </div>
        )}
        <ul className="space-y-2">
          {prioritesHebdo.slice(0, 15).map((p, i) => (
            <li key={`${p.magasin.id}-${p.produit.id}-${i}`} className="border rounded p-2">
              <p className="font-medium">{p.magasin.nom} — {LIBELLE_NIVEAU[p.niveau]}</p>
              <p className="text-sm text-gray-600">{p.produit.nom} — {p.raison}</p>
            </li>
          ))}
        </ul>
      </div>
      <CalendrierSemaine semaine={semaine} magasins={magasins ?? []} visites={visites ?? []} />
    </div>
  )
}
