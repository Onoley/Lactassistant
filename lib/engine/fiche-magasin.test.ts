import { describe, expect, it } from 'vitest'
import { comparerProduitsATravailler } from './fiche-magasin'
import type { ProduitATravailler } from './produit-a-travailler'
import type { Produit } from '@/lib/types'

function item(overrides: Partial<ProduitATravailler> = {}): ProduitATravailler {
  const produit: Produit = { id: 'p1', code: 'P1', nom: 'Test', categorie: null }
  return {
    produit,
    rang: null,
    typologie: null,
    raisons: [],
    presentsChezComparables: { total: 0, presents: 0 },
    vmhNational: null,
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
  it('place un produit obligatoire avant un produit picking mieux classé', () => {
    const picking = item({ typologie: 'picking', score: 100 })
    const obligatoire = item({ typologie: 'obligatoire', score: 10 })
    const result = [picking, obligatoire].sort(comparerProduitsATravailler)
    expect(result[0]).toBe(obligatoire)
    expect(result[1]).toBe(picking)
  })

  it('trie par score décroissant au sein du même palier de typologie', () => {
    const bas = item({ typologie: 'picking', score: 10 })
    const haut = item({ typologie: 'picking', score: 100 })
    const result = [bas, haut].sort(comparerProduitsATravailler)
    expect(result[0]).toBe(haut)
    expect(result[1]).toBe(bas)
  })

  it('traite typologie null comme picking (pas de régression sur les enseignes non classées)', () => {
    const nonClasse = item({ typologie: null, score: 100 })
    const obligatoire = item({ typologie: 'obligatoire', score: 10 })
    const result = [nonClasse, obligatoire].sort(comparerProduitsATravailler)
    expect(result[0]).toBe(obligatoire)
    expect(result[1]).toBe(nonClasse)
  })
})
