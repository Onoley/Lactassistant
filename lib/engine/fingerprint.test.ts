import { describe, expect, it } from 'vitest'
import { calculerFingerprint } from './fingerprint'
import type { RaisonsActuelles } from './raison'

const raisons: RaisonsActuelles = {
  version: 1,
  raisons: [{ version: 1, codeSignal: 'promo_a_constater', source: { type: 'promo', id: 'p1' }, observedAt: '2026-08-19', fraicheur: 'fraiche', contributionScore: 40, niveauDeclenche: 'P1', texteCommercial: 'x' }],
}

describe('calculerFingerprint', () => {
  it('produit le même fingerprint pour un résultat identique', () => {
    const a = calculerFingerprint({ niveauPriorite: 'P1', score: 80, confiance: 'donnees_confirmees', raisons, statut: 'detectee' })
    const b = calculerFingerprint({ niveauPriorite: 'P1', score: 80, confiance: 'donnees_confirmees', raisons, statut: 'detectee' })
    expect(a).toBe(b)
  })

  it('produit un fingerprint différent si le score change', () => {
    const a = calculerFingerprint({ niveauPriorite: 'P1', score: 80, confiance: 'donnees_confirmees', raisons, statut: 'detectee' })
    const b = calculerFingerprint({ niveauPriorite: 'P1', score: 55, confiance: 'donnees_confirmees', raisons, statut: 'detectee' })
    expect(a).not.toBe(b)
  })

  it('est indépendant de l\'ordre des raisons', () => {
    const raisons2: RaisonsActuelles = { version: 1, raisons: [...raisons.raisons].reverse() }
    const a = calculerFingerprint({ niveauPriorite: 'P1', score: 80, confiance: 'donnees_confirmees', raisons, statut: 'detectee' })
    const b = calculerFingerprint({ niveauPriorite: 'P1', score: 80, confiance: 'donnees_confirmees', raisons: raisons2, statut: 'detectee' })
    expect(a).toBe(b)
  })
})
