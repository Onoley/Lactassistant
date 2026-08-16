import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { genererArguments, type Argument } from './arguments'
import type { CritereSimilarite } from './similarity'
import type { Promo, StatutProduit } from '@/lib/types'

export interface LigneProduitAvecArguments {
  produitId: string
  produitNom: string
  statut: StatutProduit
  arguments: Argument[]
  score: number
}

export async function chargerArgumentsFicheMagasin(
  magasinId: string,
  critere: CritereSimilarite = 'les_deux'
): Promise<LigneProduitAvecArguments[]> {
  const supabase = createServerClient()
  const { data: magasin } = await supabase.from('magasins').select('*').eq('id', magasinId).single()
  if (!magasin) return []

  const { data: produits } = await supabase.from('produits').select('*')
  const { data: statuts } = await supabase.from('statuts_produit_magasin').select('*').eq('magasin_id', magasinId)
  const { data: priorites } = await supabase.from('priorites_produits').select('*')

  const prioriteParProduit = new Map((priorites ?? []).map(p => [p.produit_id, p]))
  const statutParProduit = new Map((statuts ?? []).map(s => [s.produit_id, s.statut as StatutProduit]))
  const manquants = (produits ?? []).filter(p => {
    const s = statutParProduit.get(p.id)
    return s === 'manquant' || s === 'rupture'
  })
  if (manquants.length === 0) return []

  // Lecture parc entier via client admin : nécessaire pour comparer avec des
  // magasins hors du secteur du commercial connecté (RLS ne l'autoriserait pas).
  const admin = createAdminClient()
  const { data: tousLesMagasins } = await admin.from('magasins').select('*')
  const { data: tousLesStatuts } = await admin
    .from('statuts_produit_magasin')
    .select('*')
    .in('produit_id', manquants.map(p => p.id))
  const { data: promoLiens } = await supabase
    .from('promo_produits')
    .select('produit_id, promos(*)')
    .in('produit_id', manquants.map(p => p.id))

  const promosParProduit = new Map<string, Promo[]>()
  for (const lien of promoLiens ?? []) {
    const liste = promosParProduit.get(lien.produit_id) ?? []
    liste.push(lien.promos as unknown as Promo)
    promosParProduit.set(lien.produit_id, liste)
  }

  return manquants.map(produit => {
    const priorite = prioriteParProduit.get(produit.id)
    const statut = statutParProduit.get(produit.id)!
    if (!priorite) return { produitId: produit.id, produitNom: produit.nom, statut, arguments: [], score: 0 }

    const statutsPourCeProduit = new Map<string, StatutProduit>(
      (tousLesStatuts ?? []).filter(s => s.produit_id === produit.id).map(s => [s.magasin_id, s.statut as StatutProduit])
    )

    const { arguments: args, score } = genererArguments(
      magasin, produit, priorite.rang as 20 | 50 | 70,
      tousLesMagasins ?? [], statutsPourCeProduit,
      promosParProduit.get(produit.id) ?? [], critere
    )

    return { produitId: produit.id, produitNom: produit.nom, statut, arguments: args, score }
  })
}
