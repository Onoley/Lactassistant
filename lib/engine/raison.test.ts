import { describe, expect, it } from 'vitest'
import { RaisonsActuellesSchema } from './raison'

describe('RaisonsActuellesSchema', () => {
  it('valide une structure conforme', () => {
    const valide = {
      version: 1,
      raisons: [{
        version: 1,
        codeSignal: 'promo_a_constater',
        source: { type: 'promo', id: 'p1' },
        observedAt: '2026-08-19T00:00:00.000Z',
        fraicheur: 'fraiche',
        contributionScore: 40,
        niveauDeclenche: 'P1',
        texteCommercial: 'Promo à constater.',
      }],
    }
    expect(() => RaisonsActuellesSchema.parse(valide)).not.toThrow()
  })

  it('rejette une fraicheur hors énumération', () => {
    const invalide = {
      version: 1,
      raisons: [{
        version: 1, codeSignal: 'x', source: { type: 'promo', id: 'p1' },
        observedAt: '2026-08-19T00:00:00.000Z', fraicheur: 'douteuse',
        contributionScore: 10, niveauDeclenche: null, texteCommercial: 'x',
      }],
    }
    expect(() => RaisonsActuellesSchema.parse(invalide)).toThrow()
  })
})
