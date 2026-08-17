import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { prioritesSemaine } from '@/lib/engine/priorites'
import { PrioritesListe } from '@/components/priorites-liste'
import type { Produit, Promo } from '@/lib/types'

export default async function EquipePage() {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) return null

  const [{ data: magasins }, { data: produits }, { data: produitsEnseigne }, { data: promoLiens }, { data: commerciaux }] = await Promise.all([
    supabase.from('magasins').select('*'),
    supabase.from('produits').select('*'),
    supabase.from('produits_enseigne').select('*'),
    supabase.from('promo_produits').select('produit_id, promos(*)'),
    supabase.from('profiles').select('*').eq('manager_id', profile.id),
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

  const prioritesHebdo = prioritesSemaine(magasins ?? [], statuts ?? [], produitsParId, produitsEnseigne ?? [], promosParProduitId)
  const emailParSecteur = new Map((commerciaux ?? []).map(c => [c.secteur_id, c.email]))

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Mon équipe — priorités de la semaine</h1>
      <PrioritesListe priorites={prioritesHebdo} variant="table" emailParSecteur={emailParSecteur} />
    </div>
  )
}
