import type { Magasin, Produit, Promo, StatutProduit } from '@/lib/types'
import { magasinsSimilaires, type CritereSimilarite } from './similarity'
import { SCORE_OP_TRADE, scoreMagasinsSimilaires, scoreRangProduit, scoreUrgencePromoJalons, type Rang } from './scoring'

export interface Argument {
  type: 'magasins_similaires' | 'promo'
  message: string
}

export function genererArguments(
  magasin: Magasin,
  produit: Produit,
  rang: Rang,
  tousLesMagasins: Magasin[],
  statutsParMagasin: Map<string, StatutProduit>,
  promosDuProduit: Promo[],
  critere: CritereSimilarite,
  aujourdHui?: Date
): { arguments: Argument[]; score: number } {
  const args: Argument[] = []
  const similaires = magasinsSimilaires(magasin, tousLesMagasins, critere)
  const presentsChezSimilaires = similaires.filter(m => statutsParMagasin.get(m.id) === 'present')

  if (presentsChezSimilaires.length > 0) {
    args.push({
      type: 'magasins_similaires',
      message: `Présent dans ${presentsChezSimilaires.length} magasin(s) similaire(s) sur ${similaires.length}.`,
    })
  }

  const promosScoped = promosDuProduit.filter(p => p.enseigne === magasin.enseigne)
  const objectivee = promosScoped.some(p => p.op_trade)

  for (const promo of promosScoped) {
    const installation = promo.date_installation ? `installation le ${promo.date_installation}, ` : ''
    const prefixe = promo.op_trade ? '[OP Trade] ' : ''
    args.push({
      type: 'promo',
      message: `${prefixe}Promo "${promo.mecanique}" chez ${promo.enseigne} : ${installation}vente le ${promo.date_debut_vente}.`,
    })
  }

  const scorePromo = promosScoped.length > 0
    ? Math.max(...promosScoped.map(p => scoreUrgencePromoJalons([p.date_installation, p.date_debut_vente, p.date_constat], aujourdHui)))
    : 0
  const scoreSimilaires = scoreMagasinsSimilaires(presentsChezSimilaires.length, similaires.length)

  let score = scoreRangProduit(rang) + scorePromo + scoreSimilaires
  if (objectivee) score += SCORE_OP_TRADE

  return { arguments: args, score }
}
