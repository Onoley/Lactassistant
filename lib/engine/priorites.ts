import type { Magasin, Produit, PrioriteProduit, Promo, StatutProduitMagasin } from '@/lib/types'
import { scoreRangProduit, scoreUrgencePromoJalons } from './scoring'

export interface PrioriteMagasin {
  magasin: Magasin
  score: number
  raisons: string[]
}

export function calculerPrioritesMagasins(
  magasins: Magasin[],
  statuts: StatutProduitMagasin[],
  produitsParId: Map<string, Produit>,
  prioritesParProduitId: Map<string, PrioriteProduit>,
  promosParProduitId: Map<string, Promo[]>,
  aujourdHui?: Date
): PrioriteMagasin[] {
  const statutsParMagasin = new Map<string, StatutProduitMagasin[]>()
  for (const s of statuts) {
    if (s.statut === 'present') continue
    const liste = statutsParMagasin.get(s.magasin_id) ?? []
    liste.push(s)
    statutsParMagasin.set(s.magasin_id, liste)
  }

  return magasins
    .map(magasin => {
      const manquants = statutsParMagasin.get(magasin.id) ?? []
      let score = 0
      const raisons: string[] = []
      for (const statut of manquants) {
        const priorite = prioritesParProduitId.get(statut.produit_id)
        if (!priorite) continue
        const produit = produitsParId.get(statut.produit_id)
        const promosRaw = promosParProduitId.get(statut.produit_id) ?? []
        const promos = promosRaw.filter(p => p.enseigne === magasin.enseigne)
        const scoreProduit = promos.length > 0
          ? Math.max(...promos.map(p => scoreRangProduit(priorite.rang) + scoreUrgencePromoJalons([p.date_installation, p.date_debut_vente, p.date_constat], aujourdHui)))
          : scoreRangProduit(priorite.rang)
        if (scoreProduit > score) score = scoreProduit
        if (produit) raisons.push(`${produit.nom} (${statut.statut})`)
      }
      return { magasin, score, raisons }
    })
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
}
