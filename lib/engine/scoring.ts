import type { SignalDetecte } from './signal'
import type { ConfigMoteur } from './config-moteur'

export type Rang = 20 | 50 | 70

const SCORE_PAR_RANG: Record<Rang, number> = { 20: 100, 50: 60, 70: 30 }

// ponytail: poids de score arbitraires (rang et urgence) — à recalibrer avec des
// retours terrain réels une fois l'outil utilisé en conditions réelles.
export function scoreRangProduit(rang: Rang): number {
  return SCORE_PAR_RANG[rang]
}

export function scoreUrgenceDate(dateIso: string, aujourdHui: Date = new Date()): number {
  const jours = Math.ceil((new Date(dateIso).getTime() - aujourdHui.getTime()) / 86_400_000)
  if (jours < 0) return 40
  if (jours <= 7) return 100
  if (jours <= 14) return 60
  return 20
}

export function scorePriorite(rang: Rang, dateProchainJalonIso: string, aujourdHui?: Date): number {
  return scoreRangProduit(rang) + scoreUrgenceDate(dateProchainJalonIso, aujourdHui)
}

export function scoreUrgencePromoJalons(dates: Array<string | null | undefined>, aujourdHui?: Date): number {
  const connues = dates.filter((d): d is string => Boolean(d))
  if (connues.length === 0) return 0
  return Math.max(...connues.map(d => scoreUrgenceDate(d, aujourdHui)))
}

// Une promo "OP Trade" est un objectif business explicite pour les
// commerciaux : elle doit dominer tout autre score (rang + urgence +
// magasins similaires plafonne autour de 250) pour forcer sa remontée en
// tête de liste, quel que soit le rang du produit.
export const SCORE_OP_TRADE = 1000

// Poids maximal du signal "présent chez des magasins similaires" — pondéré
// par la proportion de magasins similaires qui l'ont déjà en rayon.
export const SCORE_MAGASINS_SIMILAIRES_MAX = 50

export function scoreMagasinsSimilaires(nbPresents: number, nbSimilaires: number): number {
  if (nbSimilaires === 0 || nbPresents === 0) return 0
  return Math.round(SCORE_MAGASINS_SIMILAIRES_MAX * (nbPresents / nbSimilaires))
}

export interface ContexteScoreOpportunite {
  rangTop: 20 | 50 | 70 | null
  accordDejaObtenu: boolean
}

// Grille validée (spec §6). Urgence retient le signal le plus fort, jamais
// une somme. Impact/faisabilité n'agrègent que ce que les détecteurs de ce
// sous-projet produisent réellement (ope_trade, Top, accord déjà obtenu).
// Pertinence magasin reste à 0 : son seul déclencheur (typologie) est
// bloqué (§4.2/§9) — jamais plafonnée artificiellement à sa valeur max.
export function calculerScoreOpportunite(
  signaux: SignalDetecte[],
  contexte: ContexteScoreOpportunite,
  penalite: number,
  config: ConfigMoteur
): number {
  const urgence = signaux.length > 0 ? Math.min(Math.max(...signaux.map(s => s.force)), config.score.urgenceMax) : 0

  let impact = 0
  if (signaux.some(s => s.codeSignal === 'ope_trade')) impact += 15
  if (contexte.rangTop === 20) impact += 15
  else if (contexte.rangTop === 50) impact += 10
  else if (contexte.rangTop === 70) impact += 5
  impact = Math.min(impact, config.score.impactMax)

  const pertinence = 0

  let faisabilite = 0
  if (contexte.accordDejaObtenu) faisabilite += 10
  faisabilite = Math.min(faisabilite, config.score.faisabiliteMax)

  const brut = urgence + impact + pertinence + faisabilite + penalite
  const plafond = config.score.urgenceMax + config.score.impactMax + config.score.pertinenceMax + config.score.faisabiliteMax
  return Math.max(0, Math.min(brut, plafond))
}
