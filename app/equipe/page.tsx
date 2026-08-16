import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { calculerPrioritesMagasins } from '@/lib/engine/priorites'

export default async function EquipePage() {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) return null

  const [{ data: magasins }, { data: produits }, { data: priorites }, { data: promoLiens }, { data: commerciaux }] = await Promise.all([
    supabase.from('magasins').select('*'),
    supabase.from('produits').select('*'),
    supabase.from('priorites_produits').select('*'),
    supabase.from('promo_produits').select('produit_id, promos(*)'),
    supabase.from('profiles').select('*').eq('manager_id', profile.id),
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

  const priorites_ = calculerPrioritesMagasins(magasins ?? [], statuts ?? [], produitsParId, prioritesParProduitId, promosParProduitId)
  const emailParSecteur = new Map((commerciaux ?? []).map(c => [c.secteur_id, c.email]))

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Mon équipe — priorités</h1>
      <table className="w-full text-sm">
        <thead><tr><th className="text-left">Magasin</th><th className="text-left">Commercial</th><th className="text-left">Score</th><th className="text-left">Raisons</th></tr></thead>
        <tbody>
          {priorites_.map(p => (
            <tr key={p.magasin.id}>
              <td>{p.magasin.nom}</td>
              <td>{emailParSecteur.get(p.magasin.secteur_id) ?? '-'}</td>
              <td>{p.score}</td>
              <td>{p.raisons.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
