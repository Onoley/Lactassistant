import { describe, expect, it } from 'vitest'
import { calculerPrioritesMagasins } from './priorites'
import type { Magasin, Produit, PrioriteProduit, Promo, StatutProduitMagasin } from '@/lib/types'

function magasin(id: string, overrides: Partial<Magasin> = {}): Magasin {
  return { id, code: id, nom: `Magasin ${id}`, enseigne: 'Carrefour', taille: 'super', adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null, ...overrides }
}

describe('calculerPrioritesMagasins', () => {
  it('trie les magasins par score décroissant et ignore ceux sans manque', () => {
    const magasins = [magasin('1'), magasin('2'), magasin('3')]
    const produits = new Map<string, Produit>([['p1', { id: 'p1', code: 'P1', nom: 'Yaourt', categorie: null }]])
    const priorites = new Map<string, PrioriteProduit>([['p1', { produit_id: 'p1', rang: 20 }]])
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
      { magasin_id: '2', produit_id: 'p1', statut: 'present', signale_par: null, signale_at: '' },
    ]

    const result = calculerPrioritesMagasins(magasins, statuts, produits, priorites, new Map())

    expect(result).toHaveLength(1)
    expect(result[0].magasin.id).toBe('1')
    // Magasin 2 est similaire (même enseigne/taille/secteur) et a le produit
    // en rayon : la raison le mentionne, en plus du statut manquant.
    expect(result[0].raisons[0]).toContain('Yaourt (manquant')
    expect(result[0].raisons[0]).toContain('présent chez 1/2 magasin(s) similaire(s)')
  })

  it('trie plusieurs magasins avec promos par score décroissant', () => {
    const mag1 = magasin('1', { enseigne: 'Carrefour' })
    const mag2 = magasin('2', { enseigne: 'Carrefour' })
    const magasins = [mag1, mag2]
    const produits = new Map<string, Produit>([
      ['p1', { id: 'p1', code: 'P1', nom: 'Yaourt', categorie: null }],
      ['p2', { id: 'p2', code: 'P2', nom: 'Fromage', categorie: null }],
    ])
    const priorites = new Map<string, PrioriteProduit>([
      ['p1', { produit_id: 'p1', rang: 20 }],
      ['p2', { produit_id: 'p2', rang: 50 }],
    ])
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
      { magasin_id: '2', produit_id: 'p2', statut: 'manquant', signale_par: null, signale_at: '' },
    ]
    const promo: Promo = { id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%', date_installation: '2026-08-18', date_debut_vente: '2026-08-20', date_constat: '2026-08-25' }
    const promosParProduitId = new Map<string, Promo[]>([
      ['p1', [promo]],
      ['p2', [promo]],
    ])

    const result = calculerPrioritesMagasins(magasins, statuts, produits, priorites, promosParProduitId)

    expect(result).toHaveLength(2)
    expect(result[0].magasin.id).toBe('1')
    expect(result[1].magasin.id).toBe('2')
    expect(result[0].score).toBeGreaterThan(result[1].score)
  })

  it("ignore les promos d'une autre enseigne", () => {
    const magCarrefour = magasin('1', { enseigne: 'Carrefour' })
    const magasins = [magCarrefour]
    const produits = new Map<string, Produit>([['p1', { id: 'p1', code: 'P1', nom: 'Yaourt', categorie: null }]])
    const priorites = new Map<string, PrioriteProduit>([['p1', { produit_id: 'p1', rang: 20 }]])
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
    ]
    const promoLeclerc: Promo = { id: 'pr1', code: 'PR1', enseigne: 'Leclerc', mecanique: '-20%', date_installation: '2026-08-18', date_debut_vente: '2026-08-20', date_constat: '2026-08-25' }
    const promosParProduitId = new Map<string, Promo[]>([['p1', [promoLeclerc]]])

    const result = calculerPrioritesMagasins(magasins, statuts, produits, priorites, promosParProduitId)

    expect(result).toHaveLength(1)
    expect(result[0].score).toBe(100)
  })

  it('score élevé si date_constat est imminente même si date_installation est passée', () => {
    const magasins = [magasin('1', { enseigne: 'Carrefour' })]
    const produits = new Map<string, Produit>([['p1', { id: 'p1', code: 'P1', nom: 'Yaourt', categorie: null }]])
    const priorites = new Map<string, PrioriteProduit>([['p1', { produit_id: 'p1', rang: 20 }]])
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
    ]
    const promoWithPastInstallButImminentConstat: Promo = {
      id: 'pr1',
      code: 'PR1',
      enseigne: 'Carrefour',
      mecanique: '-20%',
      date_installation: '2026-08-01',
      date_debut_vente: '2026-08-05',
      date_constat: '2026-08-17'
    }
    const promosParProduitId = new Map<string, Promo[]>([['p1', [promoWithPastInstallButImminentConstat]]])

    const result = calculerPrioritesMagasins(magasins, statuts, produits, priorites, promosParProduitId, 'les_deux', new Date('2026-08-16'))

    expect(result).toHaveLength(1)
    expect(result[0].score).toBe(200)
  })

  it('fait remonter en tête un magasin dont le manquant est lié à une promo OP Trade, même avec un rang plus faible', () => {
    const magTop20 = magasin('1', { enseigne: 'Carrefour' })
    const magOpTrade = magasin('2', { enseigne: 'Carrefour' })
    const produits = new Map<string, Produit>([
      ['p1', { id: 'p1', code: 'P1', nom: 'Top20', categorie: null }],
      ['p2', { id: 'p2', code: 'P2', nom: 'Top70 objectivé', categorie: null }],
    ])
    const priorites = new Map<string, PrioriteProduit>([
      ['p1', { produit_id: 'p1', rang: 20 }],
      ['p2', { produit_id: 'p2', rang: 70 }],
    ])
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
      { magasin_id: '2', produit_id: 'p2', statut: 'manquant', signale_par: null, signale_at: '' },
    ]
    const promoOpTrade: Promo = {
      id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%',
      date_installation: null, date_debut_vente: '2026-12-01', date_constat: null,
      op_trade: 'OP PRODUITS LAITIERS',
    }
    const promosParProduitId = new Map<string, Promo[]>([['p2', [promoOpTrade]]])

    const result = calculerPrioritesMagasins([magTop20, magOpTrade], statuts, produits, priorites, promosParProduitId)

    expect(result[0].magasin.id).toBe('2')
    expect(result[0].raisons[0]).toContain('OP Trade')
  })

  it('ne compare que les magasins du même secteur pour le signal "magasins similaires"', () => {
    const magSecteurA = magasin('1', { secteur_id: 'a' })
    const magSecteurB = magasin('2', { secteur_id: 'b' })
    const produits = new Map<string, Produit>([['p1', { id: 'p1', code: 'P1', nom: 'Yaourt', categorie: null }]])
    const priorites = new Map<string, PrioriteProduit>([['p1', { produit_id: 'p1', rang: 70 }]])
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
      { magasin_id: '2', produit_id: 'p1', statut: 'present', signale_par: null, signale_at: '' },
    ]

    const result = calculerPrioritesMagasins([magSecteurA, magSecteurB], statuts, produits, priorites, new Map())

    // Le magasin similaire est dans un autre secteur : pas de bonus, pas de mention.
    expect(result[0].raisons[0]).not.toContain('similaire')
    expect(result[0].score).toBe(30) // rang 70 seul
  })
})
