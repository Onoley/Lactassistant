import { describe, expect, it } from 'vitest'
import { calculerFingerprint } from './fingerprint'
import type { RaisonsActuelles } from './raison'

const raisons: RaisonsActuelles = {
  version: 1,
  raisons: [
    { version: 1, codeSignal: 'promo_a_constater', source: { type: 'promo', id: 'p1' }, observedAt: '2026-08-19', fraicheur: 'fraiche', contributionScore: 40, niveauDeclenche: 'P1', texteCommercial: 'x' },
    { version: 1, codeSignal: 'promo_a_revendre', source: { type: 'promo', id: 'p2' }, observedAt: '2026-08-19', fraicheur: 'fraiche', contributionScore: 30, niveauDeclenche: 'P2', texteCommercial: 'y' },
  ],
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

  it('est indépendant de l\'ordre d\'entrée quand deux raisons partagent le même codeSignal (tri par source.id en clé secondaire)', () => {
    // detecteurs.ts émet un signal `permanent_manquant_promo_proche` par promo
    // applicable : même code, source.id différent. Le tri par code seul n'est
    // pas un ordre total (Array.prototype.sort est stable), donc l'ordre
    // d'entrée — dépendant d'une requête Supabase non ordonnée — peut faire
    // varier le hash pour des données identiques.
    const raisonsMemeCode: RaisonsActuelles = {
      version: 1,
      raisons: [
        { version: 1, codeSignal: 'permanent_manquant_promo_proche', source: { type: 'promo', id: 'promoB' }, observedAt: '2026-08-19', fraicheur: 'fraiche', contributionScore: 25, niveauDeclenche: 'P2', texteCommercial: 'x' },
        { version: 1, codeSignal: 'permanent_manquant_promo_proche', source: { type: 'promo', id: 'promoA' }, observedAt: '2026-08-19', fraicheur: 'fraiche', contributionScore: 35, niveauDeclenche: 'P1', texteCommercial: 'y' },
      ],
    }
    const raisonsMemeCodeInverse: RaisonsActuelles = { version: 1, raisons: [...raisonsMemeCode.raisons].reverse() }
    const a = calculerFingerprint({ niveauPriorite: 'P1', score: 60, confiance: 'donnees_confirmees', raisons: raisonsMemeCode, statut: 'detectee' })
    const b = calculerFingerprint({ niveauPriorite: 'P1', score: 60, confiance: 'donnees_confirmees', raisons: raisonsMemeCodeInverse, statut: 'detectee' })
    expect(a).toBe(b)
  })
})
