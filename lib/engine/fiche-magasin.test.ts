import { describe, expect, it } from 'vitest'
import { comparerProduitsATravailler, estProduitManquantATravailler } from './fiche-magasin'
import type { ProduitATravailler } from './produit-a-travailler'
import type { Produit, ProduitEnseigne, StatutProduitMagasin } from '@/lib/types'

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

function statut(overrides: Partial<StatutProduitMagasin> = {}): StatutProduitMagasin {
  return { magasin_id: 'm1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '2026-01-01', raison_absence: null, ...overrides }
}

function produitEnseigne(overrides: Partial<ProduitEnseigne> = {}): ProduitEnseigne {
  return { produit_id: 'p1', enseigne: 'Carrefour', typologie: null, statut_disponibilite: 'commandable', actif: true, ...overrides }
}

describe('estProduitManquantATravailler', () => {
  it('exclut un produit signalé manquant qui n\'a pas de ligne active dans l\'assortiment de l\'enseigne', () => {
    const statutParProduit = new Map([['p1', statut({ statut: 'manquant' })]])
    const produitEnseigneParProduit = new Map<string, ProduitEnseigne>()
    expect(estProduitManquantATravailler('p1', statutParProduit, produitEnseigneParProduit)).toBe(false)
  })

  it('inclut un produit manquant présent dans l\'assortiment actif de l\'enseigne', () => {
    const statutParProduit = new Map([['p1', statut({ statut: 'manquant' })]])
    const produitEnseigneParProduit = new Map([['p1', produitEnseigne()]])
    expect(estProduitManquantATravailler('p1', statutParProduit, produitEnseigneParProduit)).toBe(true)
  })

  it('inclut un produit en rupture présent dans l\'assortiment actif de l\'enseigne', () => {
    const statutParProduit = new Map([['p1', statut({ statut: 'rupture' })]])
    const produitEnseigneParProduit = new Map([['p1', produitEnseigne()]])
    expect(estProduitManquantATravailler('p1', statutParProduit, produitEnseigneParProduit)).toBe(true)
  })

  it('exclut un produit présent (statut != manquant/rupture) même dans l\'assortiment actif', () => {
    const statutParProduit = new Map([['p1', statut({ statut: 'present' })]])
    const produitEnseigneParProduit = new Map([['p1', produitEnseigne()]])
    expect(estProduitManquantATravailler('p1', statutParProduit, produitEnseigneParProduit)).toBe(false)
  })
})
