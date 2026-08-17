import { describe, expect, it } from 'vitest'
import { importanceProduitFiche } from './importance-produit'
import { scoreRangProduit } from './scoring'
import type { Magasin, Produit, Promo, StatutProduit } from '@/lib/types'

function magasin(id: string, overrides: Partial<Magasin> = {}): Magasin {
  return { id, code: id, nom: id, enseigne: 'Carrefour', taille: 'super', adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null, surface: null, ...overrides }
}

const produit: Produit = { id: 'p1', code: 'P1', nom: 'Yaourt nature', categorie: null }

describe('importanceProduitFiche', () => {
  it('signale les magasins similaires qui ont le produit', () => {
    const cible = magasin('1')
    const tous = [cible, magasin('2'), magasin('3', { enseigne: 'Leclerc' })]
    const statuts = new Map<string, StatutProduit>([['2', 'present']])
    const { raisons, presentsChezComparables } = importanceProduitFiche(cible, produit, 20, tous, statuts, [], 'les_deux')
    expect(raisons.some(r => r.includes('1 magasin(s) similaire(s) sur 1'))).toBe(true)
    expect(presentsChezComparables).toEqual({ total: 1, presents: 1 })
  })

  it('signale les promos et calcule un score', () => {
    const cible = magasin('1')
    const promo: Promo = { id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%', date_installation: '2026-08-18', date_debut_vente: '2026-08-20', date_constat: '2026-08-25' }
    const { raisons, score, promo: promoPrincipale } = importanceProduitFiche(cible, produit, 20, [cible], new Map(), [promo], 'les_deux')
    expect(raisons.some(r => r.includes('Promo'))).toBe(true)
    expect(score).toBeGreaterThan(0)
    expect(promoPrincipale?.promo.id).toBe('pr1')
  })

  it("score basé sur le rang seul en l'absence de promo", () => {
    const cible = magasin('1')
    const { score, promo } = importanceProduitFiche(cible, produit, 20, [cible], new Map(), [], 'les_deux')
    expect(score).toBe(100)
    expect(promo).toBeNull()
  })

  it("ignore les promos d'une autre enseigne", () => {
    const cibleCarrefour = magasin('1', { enseigne: 'Carrefour' })
    const promoLeclerc: Promo = { id: 'pr1', code: 'PR1', enseigne: 'Leclerc', mecanique: '-20%', date_installation: '2026-08-18', date_debut_vente: '2026-08-20', date_constat: '2026-08-25' }
    const { score } = importanceProduitFiche(cibleCarrefour, produit, 20, [cibleCarrefour], new Map(), [promoLeclerc], 'les_deux')
    expect(score).toBe(100)
  })

  it('score élevé si date_constat est imminente même si date_installation est passée', () => {
    const cible = magasin('1', { enseigne: 'Carrefour' })
    const promoWithPastInstButImminentConstat: Promo = {
      id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%',
      date_installation: '2026-08-01', date_debut_vente: '2026-08-05', date_constat: '2026-08-17',
    }
    const { score } = importanceProduitFiche(cible, produit, 20, [cible], new Map(), [promoWithPastInstButImminentConstat], 'les_deux', new Date('2026-08-16'))
    expect(score).toBe(200)
  })

  it('gère une promo sans date_installation ni date_constat connues (import réel incomplet)', () => {
    const cible = magasin('1', { enseigne: 'Carrefour' })
    const promoSansJalonsOptionnels: Promo = {
      id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%',
      date_installation: null, date_debut_vente: '2026-08-20', date_constat: null,
    }
    const { raisons, score } = importanceProduitFiche(cible, produit, 20, [cible], new Map(), [promoSansJalonsOptionnels], 'les_deux', new Date('2026-08-16'))
    expect(raisons[0]).not.toContain('null')
    expect(raisons[0]).toContain('vente le 2026-08-20')
    expect(score).toBe(scoreRangProduit(20) + 100)
  })

  it('le signal magasins comparables contribue aussi au score, pas seulement au message', () => {
    const cible = magasin('1')
    const tous = [cible, magasin('2')]
    const statuts = new Map<string, StatutProduit>([['2', 'present']])
    const { score } = importanceProduitFiche(cible, produit, 70, tous, statuts, [], 'les_deux')
    expect(score).toBeGreaterThan(scoreRangProduit(70))
  })

  it('une promo OP Trade fait dominer le score, même pour un rang faible', () => {
    const cible = magasin('1', { enseigne: 'Carrefour' })
    const promoOpTrade: Promo = {
      id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%',
      date_installation: null, date_debut_vente: '2026-12-01', date_constat: null,
      op_trade: 'OP PRODUITS LAITIERS',
    }
    const { raisons, score } = importanceProduitFiche(cible, produit, 70, [cible], new Map(), [promoOpTrade], 'les_deux')
    expect(score).toBeGreaterThan(900)
    expect(raisons.some(r => r.startsWith('[OP Trade]'))).toBe(true)
  })
})
