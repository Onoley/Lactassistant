import { describe, expect, it } from 'vitest'
import { calculerPrioritesMagasins } from './priorites'
import type { Magasin, Produit, PrioriteProduit, StatutProduitMagasin } from '@/lib/types'

function magasin(id: string): Magasin {
  return { id, code: id, nom: `Magasin ${id}`, enseigne: 'Carrefour', taille: 'super', adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null }
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
    expect(result[0].raisons).toContain('Yaourt (manquant)')
  })
})
