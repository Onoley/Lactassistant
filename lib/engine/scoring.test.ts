// lib/engine/scoring.test.ts
import { describe, expect, it } from 'vitest'
import { scoreRangProduit, scoreUrgenceDate, scorePriorite, scoreUrgencePromoJalons, calculerScoreOpportunite } from './scoring'
import { CONFIG_MOTEUR_DEFAUT } from './config-moteur'
import type { SignalDetecte } from './signal'

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

describe('scoreUrgencePromoJalons', () => {
  const aujourdHui = new Date('2026-08-16')

  it('ignore les jalons inconnus (null/undefined) et se base sur ceux connus', () => {
    expect(scoreUrgencePromoJalons([null, '2026-08-20', undefined], aujourdHui)).toBe(100)
  })

  it('retourne 0 si aucun jalon n\'est connu', () => {
    expect(scoreUrgencePromoJalons([null, undefined], aujourdHui)).toBe(0)
  })
})

describe('calculerScoreOpportunite', () => {
  function signal(overrides: Partial<SignalDetecte>): SignalDetecte {
    return {
      typeMission: 'referencer_produit', promoId: null, niveauDeclenche: 'P1',
      codeSignal: 'x', sourceType: 'statut', sourceId: 's1',
      observedAt: '2026-08-19T00:00:00.000Z', expiresAt: null, force: 10,
      donneesArgumentaire: {}, ...overrides,
    }
  }
  const contexteVide = { rangTop: null, accordDejaObtenu: false }

  it('retient le signal d\'urgence le plus fort, ne somme jamais plusieurs urgences', () => {
    const score = calculerScoreOpportunite([signal({ codeSignal: 'promo_a_constater', force: 40 }), signal({ codeSignal: 'permanent_manquant_promo_proche', force: 25 })], contexteVide, 0, CONFIG_MOTEUR_DEFAUT)
    expect(score).toBe(40)
  })

  it('ope_trade et Top 20 s\'ajoutent en impact, exclusifs entre eux pour le rang', () => {
    const score = calculerScoreOpportunite([signal({ codeSignal: 'ope_trade', force: 40 })], { rangTop: 20, accordDejaObtenu: false }, 0, CONFIG_MOTEUR_DEFAUT)
    // urgence 40 + impact(ope_trade 15 + Top20 15 = 30, plafonné à impactMax=25 §6)
    expect(score).toBe(40 + 25)
  })

  it('Top 50 et Top 70 ne s\'ajoutent jamais à Top 20', () => {
    const score50 = calculerScoreOpportunite([signal({ force: 10 })], { rangTop: 50, accordDejaObtenu: false }, 0, CONFIG_MOTEUR_DEFAUT)
    expect(score50).toBe(10 + 10)
  })

  it('accord déjà obtenu ajoute la faisabilité', () => {
    const score = calculerScoreOpportunite([signal({ force: 10 })], { rangTop: null, accordDejaObtenu: true }, 0, CONFIG_MOTEUR_DEFAUT)
    expect(score).toBe(10 + 10)
  })

  it('une pénalité de réouverture après refus réduit le score sans jamais le faire sortir de sa plage', () => {
    const scoreAvecPenalite = calculerScoreOpportunite([signal({ codeSignal: 'promo_a_constater', force: 40 })], contexteVide, CONFIG_MOTEUR_DEFAUT.penaliteReouvertureApresRefus, CONFIG_MOTEUR_DEFAUT)
    expect(scoreAvecPenalite).toBe(15)
  })

  it('score minimal jamais négatif', () => {
    const score = calculerScoreOpportunite([signal({ force: 5 })], contexteVide, -100, CONFIG_MOTEUR_DEFAUT)
    expect(score).toBe(0)
  })
})
