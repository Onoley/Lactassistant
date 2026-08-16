// lib/engine/scoring.test.ts
import { describe, expect, it } from 'vitest'
import { scoreRangProduit, scoreUrgenceDate, scorePriorite } from './scoring'

describe('scoreRangProduit', () => {
  it('donne un score plus élevé aux rangs prioritaires', () => {
    expect(scoreRangProduit(20)).toBeGreaterThan(scoreRangProduit(50))
    expect(scoreRangProduit(50)).toBeGreaterThan(scoreRangProduit(70))
  })
})

describe('scoreUrgenceDate', () => {
  const aujourdHui = new Date('2026-08-16')

  it('score maximal pour une échéance dans la semaine', () => {
    expect(scoreUrgenceDate('2026-08-20', aujourdHui)).toBe(100)
  })

  it('score moyen pour une échéance dans 10 jours', () => {
    expect(scoreUrgenceDate('2026-08-26', aujourdHui)).toBe(60)
  })

  it('score faible pour une échéance lointaine', () => {
    expect(scoreUrgenceDate('2026-10-01', aujourdHui)).toBe(20)
  })

  it('score intermédiaire pour une date passée récemment', () => {
    expect(scoreUrgenceDate('2026-08-10', aujourdHui)).toBe(40)
  })
})

describe('scorePriorite', () => {
  it('combine rang et urgence', () => {
    const aujourdHui = new Date('2026-08-16')
    expect(scorePriorite(20, '2026-08-20', aujourdHui)).toBe(scoreRangProduit(20) + 100)
  })
})
