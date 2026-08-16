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
