import type { Magasin, Produit, PrioriteProduit, Promo, StatutProduit, StatutProduitMagasin } from '@/lib/types'
import { magasinsSimilaires, type CritereSimilarite } from './similarity'
import { SCORE_OP_TRADE, scoreMagasinsSimilaires, scoreRangProduit, scoreUrgencePromoJalons } from './scoring'

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
  critereSimilarite: CritereSimilarite = 'les_deux',
  aujourdHui?: Date
): PrioriteMagasin[] {
  // Statut par magasin+produit (présent compris) pour repérer un produit
  // manquant ici mais déjà en rayon chez des magasins similaires du secteur.
  const statutParMagasinEtProduit = new Map<string, Map<string, StatutProduit>>()
  const manquantsParMagasin = new Map<string, StatutProduitMagasin[]>()
  for (const s of statuts) {
    if (!statutParMagasinEtProduit.has(s.magasin_id)) statutParMagasinEtProduit.set(s.magasin_id, new Map())
    statutParMagasinEtProduit.get(s.magasin_id)!.set(s.produit_id, s.statut)
    if (s.statut === 'present') continue
    const liste = manquantsParMagasin.get(s.magasin_id) ?? []
    liste.push(s)
    manquantsParMagasin.set(s.magasin_id, liste)
  }

  return magasins
    .map(magasin => {
      const manquants = manquantsParMagasin.get(magasin.id) ?? []
      // Comparaison volontairement limitée au secteur du commercial, pas au
      // parc national : l'objectif est de comparer des magasins qu'un même
      // commercial couvre, pas une moyenne nationale hors de son contrôle.
      const magasinsDuSecteur = magasins.filter(m => m.secteur_id === magasin.secteur_id)
      const similaires = magasinsSimilaires(magasin, magasinsDuSecteur, critereSimilarite)

      let score = 0
      const raisons: string[] = []
      for (const statut of manquants) {
        const priorite = prioritesParProduitId.get(statut.produit_id)
        if (!priorite) continue
        const produit = produitsParId.get(statut.produit_id)
        const promos = (promosParProduitId.get(statut.produit_id) ?? []).filter(p => p.enseigne === magasin.enseigne)
        const objectivee = promos.some(p => p.op_trade)
        const scorePromo = promos.length > 0
          ? Math.max(...promos.map(p => scoreUrgencePromoJalons([p.date_installation, p.date_debut_vente, p.date_constat], aujourdHui)))
          : 0

        const presentsChezSimilaires = similaires.filter(m => statutParMagasinEtProduit.get(m.id)?.get(statut.produit_id) === 'present')
        const scoreSimilaires = scoreMagasinsSimilaires(presentsChezSimilaires.length, similaires.length)

        let scoreProduit = scoreRangProduit(priorite.rang) + scorePromo + scoreSimilaires
        if (objectivee) scoreProduit += SCORE_OP_TRADE

        if (scoreProduit > score) score = scoreProduit
        if (produit) {
          const details: string[] = []
          if (objectivee) details.push('OP Trade')
          if (presentsChezSimilaires.length > 0) details.push(`présent chez ${presentsChezSimilaires.length}/${similaires.length} magasin(s) similaire(s)`)
          raisons.push(`${produit.nom} (${statut.statut}${details.length ? ' — ' + details.join(', ') : ''})`)
        }
      }
      return { magasin, score, raisons }
    })
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score)
}
