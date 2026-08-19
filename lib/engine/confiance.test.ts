import { describe, expect, it } from 'vitest'
import { determinerConfiance } from './confiance'
import type { SignalDetecte } from './signal'

function signal(overrides: Partial<SignalDetecte>): SignalDetecte {
  return {
    typeMission: 'referencer_produit', promoId: null, niveauDeclenche: 'P1',
    codeSignal: 'promo_a_constater', sourceType: 'promo', sourceId: 's1',
    observedAt: '2026-08-19T00:00:00.000Z', expiresAt: null, force: 40,
    donneesArgumentaire: {}, ...overrides,
  }
}

describe('determinerConfiance', () => {
  it('signal direct daté (promo) → donnees_confirmees', () => {
    const resultat = determinerConfiance([signal({ sourceType: 'promo' })])
    expect(resultat.confiance).toBe('donnees_confirmees')
    expect(resultat.contradiction).toBe(false)
  })

  it('signal indirect (vmh/comparable) sans déclencheur direct → recommandation_probable', () => {
    const resultat = determinerConfiance([signal({ sourceType: 'vmh', codeSignal: 'vmh_favorable' })])
    expect(resultat.confiance).toBe('recommandation_probable')
  })

  it('deux signaux P1 et P3 sur le même type de mission → contradiction, information_a_verifier', () => {
    const resultat = determinerConfiance([
      signal({ typeMission: 'referencer_produit', promoId: null, niveauDeclenche: 'P1', sourceType: 'promo' }),
      signal({ typeMission: 'referencer_produit', promoId: null, niveauDeclenche: 'P3', sourceType: 'statut', codeSignal: 'statut_incoherent' }),
    ])
    expect(resultat.contradiction).toBe(true)
    expect(resultat.confiance).toBe('information_a_verifier')
  })
})
