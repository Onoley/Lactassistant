import type { Magasin, Produit, Promo, StatutProduit } from '@/lib/types'
import { magasinsSimilaires, type CritereSimilarite } from './similarity'
import { SCORE_OP_TRADE, scoreMagasinsSimilaires, scoreRangProduit, scoreUrgencePromoJalons, type Rang } from './scoring'
import { stadePromo, type StadePromo } from './stade-promo'

export interface ImportanceProduit {
  score: number
  raisons: string[]
  presentsChezComparables: { total: number; presents: number }
  promo: { promo: Promo; stade: StadePromo } | null
}

function promoPrincipale(promosScoped: Promo[], aujourdHui: Date): { promo: Promo; stade: StadePromo } | null {
  if (promosScoped.length === 0) return null
  const opTrade = promosScoped.find(p => p.op_trade)
  const promo = opTrade ?? [...promosScoped].sort(
    (a, b) => new Date(a.date_debut_vente).getTime() - new Date(b.date_debut_vente).getTime()
  )[0]
  return { promo, stade: stadePromo(promo, aujourdHui) }
}

export function importanceProduitFiche(
  magasin: Magasin,
  produit: Produit,
  rang: Rang,
  magasinsComparables: Magasin[],
  statutsComparables: Map<string, StatutProduit>,
  promosDuProduit: Promo[],
  critere: CritereSimilarite,
  aujourdHui: Date = new Date()
): ImportanceProduit {
  const raisons: string[] = []
  const similaires = magasinsSimilaires(magasin, magasinsComparables, critere)
  const presentsChezSimilaires = similaires.filter(m => statutsComparables.get(m.id) === 'present')

  if (presentsChezSimilaires.length > 0) {
    raisons.push(`Présent dans ${presentsChezSimilaires.length} magasin(s) similaire(s) sur ${similaires.length}.`)
  }

  const promosScoped = promosDuProduit.filter(p => p.enseigne === magasin.enseigne)
  const objectivee = promosScoped.some(p => p.op_trade)

  for (const promo of promosScoped) {
    const installation = promo.date_installation ? `installation le ${promo.date_installation}, ` : ''
    const prefixe = promo.op_trade ? '[OP Trade] ' : ''
    raisons.push(`${prefixe}Promo "${promo.mecanique}" chez ${promo.enseigne} : ${installation}vente le ${promo.date_debut_vente}.`)
  }

  const scorePromo = promosScoped.length > 0
    ? Math.max(...promosScoped.map(p => scoreUrgencePromoJalons([p.date_installation, p.date_debut_vente, p.date_constat], aujourdHui)))
    : 0
  const scoreSimilaires = scoreMagasinsSimilaires(presentsChezSimilaires.length, similaires.length)

  let score = scoreRangProduit(rang) + scorePromo + scoreSimilaires
  if (objectivee) score += SCORE_OP_TRADE

  return {
    score,
    raisons,
    presentsChezComparables: { total: similaires.length, presents: presentsChezSimilaires.length },
    promo: promoPrincipale(promosScoped, aujourdHui),
  }
}
