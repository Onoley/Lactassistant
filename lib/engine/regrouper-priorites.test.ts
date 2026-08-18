import { describe, expect, it } from 'vitest'
import { regrouperParPromo } from './regrouper-priorites'
import type { PrioriteHebdo } from './priorites'
import type { Magasin, Produit, Promo } from '@/lib/types'

function magasin(id: string): Magasin {
  return {
    id, code: id, nom: `Magasin ${id}`, enseigne: 'Carrefour', taille: 'super',
    adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null, surface: null,
  }
}

function produit(id: string): Produit {
  return { id, code: id, nom: `Produit ${id}`, categorie: null, produit_canonique_id: null, famille: null, segment: null, statut_catalogue: 'permanent', type_liaison: null }
}

function promo(id: string): Promo {
  return {
    id, code: id, enseigne: 'Carrefour', mecanique: '3 pour 2', theme: 'Rentrée',
    date_installation: null, date_debut_vente: '2026-09-01', date_constat: null,
  }
}

function hebdo(overrides: Partial<PrioriteHebdo> & { magasin: Magasin; produit: Produit }): PrioriteHebdo {
  return {
    niveau: 'urgent',
    raison: 'raison',
    stadePromo: null,
    promo: null,
    actionRecommandee: 'faire_entrer',
    ...overrides,
  }
}

describe('regrouperParPromo', () => {
  it('regroupe deux produits sous la même promo dans le même magasin', () => {
    const m = magasin('1')
    const p = promo('promoA')
    const priorites = [
      hebdo({ magasin: m, produit: produit('a'), promo: p }),
      hebdo({ magasin: m, produit: produit('b'), promo: p }),
    ]
    const groupes = regrouperParPromo(priorites)
    expect(groupes).toHaveLength(1)
    expect(groupes[0].produits.map(pr => pr.id)).toEqual(['a', 'b'])
  })

  it('sépare les produits de promos différentes', () => {
    const m = magasin('1')
    const priorites = [
      hebdo({ magasin: m, produit: produit('a'), promo: promo('promoA') }),
      hebdo({ magasin: m, produit: produit('b'), promo: promo('promoB') }),
    ]
    const groupes = regrouperParPromo(priorites)
    expect(groupes).toHaveLength(2)
  })

  it('sépare les produits de la même promo dans des magasins différents', () => {
    const p = promo('promoA')
    const priorites = [
      hebdo({ magasin: magasin('1'), produit: produit('a'), promo: p }),
      hebdo({ magasin: magasin('2'), produit: produit('b'), promo: p }),
    ]
    const groupes = regrouperParPromo(priorites)
    expect(groupes).toHaveLength(2)
  })

  it('ne regroupe jamais deux ruptures (promo null) entre elles, même magasin', () => {
    const m = magasin('1')
    const priorites = [
      hebdo({ magasin: m, produit: produit('a'), promo: null }),
      hebdo({ magasin: m, produit: produit('b'), promo: null }),
    ]
    const groupes = regrouperParPromo(priorites)
    expect(groupes).toHaveLength(2)
  })

  it('préserve l\'ordre de première apparition', () => {
    const priorites = [
      hebdo({ magasin: magasin('1'), produit: produit('a'), promo: promo('promoA') }),
      hebdo({ magasin: magasin('2'), produit: produit('b'), promo: promo('promoB') }),
      hebdo({ magasin: magasin('1'), produit: produit('c'), promo: promo('promoA') }),
    ]
    const groupes = regrouperParPromo(priorites)
    expect(groupes.map(g => g.magasin.id)).toEqual(['1', '2'])
    expect(groupes[0].produits.map(p => p.id)).toEqual(['a', 'c'])
  })
})
