import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { calculerPrioritesMagasins } from '@/lib/engine/priorites'
import { numeroSemaineCourante } from '@/lib/semaine'
import { CalendrierSemaine } from './calendrier-semaine'

export default async function SemainePage() {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) return null

  const semaine = numeroSemaineCourante()

  const [{ data: magasins }, { data: produits }, { data: priorites }, { data: promoLiens }, { data: visites }] = await Promise.all([
    supabase.from('magasins').select('*'),
    supabase.from('produits').select('*'),
    supabase.from('priorites_produits').select('*'),
    supabase.from('promo_produits').select('produit_id, promos(*)'),
    supabase.from('visites').select('*').eq('semaine', semaine).eq('commercial_id', profile.id),
  ])

  const magasinIds = (magasins ?? []).map(m => m.id)
  const { data: statuts } = await supabase
    .from('statuts_produit_magasin')
    .select('*')
    .in('magasin_id', magasinIds.length ? magasinIds : ['00000000-0000-0000-0000-000000000000'])

  const produitsParId = new Map((produits ?? []).map(p => [p.id, p]))
  const prioritesParProduitId = new Map((priorites ?? []).map(p => [p.produit_id, p]))
  const promosParProduitId = new Map<string, any[]>()
  for (const lien of promoLiens ?? []) {
    const liste = promosParProduitId.get(lien.produit_id) ?? []
    liste.push(lien.promos)
    promosParProduitId.set(lien.produit_id, liste)
  }

  const prioritesMagasins = calculerPrioritesMagasins(
    magasins ?? [], statuts ?? [], produitsParId, prioritesParProduitId, promosParProduitId
  )

  const magasinIdsPlanifies = new Set((visites ?? []).map(v => v.magasin_id))
  const nonCouvertes = prioritesMagasins.filter(p => !magasinIdsPlanifies.has(p.magasin.id))

  return (
    <div className="p-6 grid grid-cols-2 gap-6">
      <div>
        <h1 className="text-xl font-bold mb-4">Priorités suggérées</h1>
        {nonCouvertes.length > 0 && (
          <div className="bg-amber-100 border border-amber-400 rounded p-3 mb-4 text-sm">
            {nonCouvertes.length} magasin(s) prioritaire(s) ne sont pas dans votre semaine.
          </div>
        )}
        <ul className="space-y-2">
          {prioritesMagasins.slice(0, 15).map(p => (
            <li key={p.magasin.id} className="border rounded p-2">
              <p className="font-medium">{p.magasin.nom} — score {p.score}</p>
              <p className="text-sm text-gray-600">{p.raisons.join(', ')}</p>
            </li>
          ))}
        </ul>
      </div>
      <CalendrierSemaine semaine={semaine} magasins={magasins ?? []} visites={visites ?? []} />
    </div>
  )
}
