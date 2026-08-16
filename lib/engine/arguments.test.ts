import { describe, expect, it } from 'vitest'
import { genererArguments } from './arguments'
import type { Magasin, Produit, Promo, StatutProduit } from '@/lib/types'

function magasin(id: string, overrides: Partial<Magasin> = {}): Magasin {
  return { id, code: id, nom: id, enseigne: 'Carrefour', taille: 'super', adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null, ...overrides }
}

const produit: Produit = { id: 'p1', code: 'P1', nom: 'Yaourt nature', categorie: null }

describe('genererArguments', () => {
  it('signale les magasins similaires qui ont le produit', () => {
    const cible = magasin('1')
    const tous = [cible, magasin('2'), magasin('3', { enseigne: 'Leclerc' })]
    const statuts = new Map<string, StatutProduit>([['2', 'present']])
    const { arguments: args } = genererArguments(cible, produit, 20, tous, statuts, [], 'les_deux')
    expect(args.some(a => a.type === 'magasins_similaires' && a.message.includes('1'))).toBe(true)
  })

  it('signale les promos et calcule un score', () => {
    const cible = magasin('1')
    const promo: Promo = { id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%', date_installation: '2026-08-18', date_debut_vente: '2026-08-20', date_constat: '2026-08-25' }
    const { arguments: args, score } = genererArguments(cible, produit, 20, [cible], new Map(), [promo], 'les_deux')
    expect(args.some(a => a.type === 'promo')).toBe(true)
    expect(score).toBeGreaterThan(0)
  })

  it("score basé sur le rang seul en l'absence de promo", () => {
    const cible = magasin('1')
    const { score } = genererArguments(cible, produit, 20, [cible], new Map(), [], 'les_deux')
    expect(score).toBe(100)
  })

  it("ignore les promos d'une autre enseigne", () => {
    const cibleCarrefour = magasin('1', { enseigne: 'Carrefour' })
    const promoLeclerc: Promo = { id: 'pr1', code: 'PR1', enseigne: 'Leclerc', mecanique: '-20%', date_installation: '2026-08-18', date_debut_vente: '2026-08-20', date_constat: '2026-08-25' }
    const { score } = genererArguments(cibleCarrefour, produit, 20, [cibleCarrefour], new Map(), [promoLeclerc], 'les_deux')
    expect(score).toBe(100)
  })
})
