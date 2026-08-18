import { describe, expect, it } from 'vitest'
import { comparerProduitsATravailler } from './fiche-magasin'
import type { ProduitATravailler } from './produit-a-travailler'
import type { Produit } from '@/lib/types'

function item(overrides: Partial<ProduitATravailler> = {}): ProduitATravailler {
  const produit: Produit = { id: 'p1', code: 'P1', nom: 'Test', categorie: null, produit_canonique_id: null, famille: null, segment: null, statut_catalogue: 'permanent', type_liaison: null }
  return {
    produit,
    rang: null,
    typologie: null,
    raisons: [],
    presentsChezComparables: { total: 0, presents: 0 },
    vmh: null,
    raisonAbsence: null,
    argumentaire: '',
    questionsDecouverte: [],
    actionRecommandee: 'tester',
    momentum: null,
    score: 0,
    ...overrides,
  }
}

describe('comparerProduitsATravailler', () => {
  it('trie par score décroissant', () => {
    const bas = item({ typologie: 'picking', score: 10 })
    const haut = item({ typologie: 'picking', score: 100 })
    const result = [bas, haut].sort(comparerProduitsATravailler)
    expect(result[0]).toBe(haut)
    expect(result[1]).toBe(bas)
  })
})
