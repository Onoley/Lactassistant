import { describe, expect, it } from 'vitest'
import { classifierNiveau } from './classification'
import type { SignalDetecte } from './signal'

function signal(overrides: Partial<SignalDetecte>): SignalDetecte {
  return {
    typeMission: 'referencer_produit', promoId: null, niveauDeclenche: 'P3',
    codeSignal: 'test', sourceType: 'statut', sourceId: 's1',
    observedAt: '2026-08-19T00:00:00.000Z', expiresAt: null, force: 10,
    donneesArgumentaire: {}, ...overrides,
  }
}

describe('classifierNiveau', () => {
  it('retient le niveau le plus fort parmi plusieurs signaux', () => {
    const resultat = classifierNiveau([signal({ niveauDeclenche: 'P3', force: 5 }), signal({ niveauDeclenche: 'P1', force: 40, codeSignal: 'promo_a_constater' })])
    expect(resultat?.niveau).toBe('P1')
  })

  it('ne somme jamais plusieurs signaux P2 pour atteindre P1', () => {
    const resultat = classifierNiveau([signal({ niveauDeclenche: 'P2', force: 25 }), signal({ niveauDeclenche: 'P2', force: 25 })])
    expect(resultat?.niveau).toBe('P2')
  })

  it('retourne null pour une liste vide', () => {
    expect(classifierNiveau([])).toBeNull()
  })
})
