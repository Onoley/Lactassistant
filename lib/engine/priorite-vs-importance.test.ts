import { describe, expect, it } from 'vitest'
import { prioritesSemaine } from './priorites'
import { importanceProduitFiche } from './importance-produit'
import type { Magasin, Produit, StatutProduit, StatutProduitMagasin } from '@/lib/types'

function magasin(id: string, overrides: Partial<Magasin> = {}): Magasin {
  return { id, code: id, nom: `Magasin ${id}`, enseigne: 'Carrefour', taille: 'super', adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null, ...overrides }
}

describe('séparation priorité hebdomadaire vs importance fiche magasin', () => {
  it('un Top 20 très présent chez des comparables mais sans promo ni rupture est absent des priorités de la semaine, mais bien noté dans la fiche magasin', () => {
    const cible = magasin('1')
    const comparable1 = magasin('2')
    const comparable2 = magasin('3')
    const tousLesMagasins = [cible, comparable1, comparable2]
    const produit: Produit = { id: 'p1', code: 'P1', nom: 'Yaourt Top20', categorie: null }
    const produitsParId = new Map([['p1', produit]])

    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '', raison_absence: null },
      { magasin_id: '2', produit_id: 'p1', statut: 'present', signale_par: null, signale_at: '', raison_absence: null },
      { magasin_id: '3', produit_id: 'p1', statut: 'present', signale_par: null, signale_at: '', raison_absence: null },
    ]

    // Priorité de la semaine : ni promo ni rupture, donc jamais remonté ici,
    // quelle que soit sa présence chez les magasins comparables.
    const hebdo = prioritesSemaine(tousLesMagasins, statuts, produitsParId, [], new Map())
    expect(hebdo).toHaveLength(0)

    // Fiche magasin : le même produit ressort bien grâce au rang Top20 et à
    // sa présence chez 2/2 magasins comparables.
    const statutsComparables = new Map<string, StatutProduit>([['2', 'present'], ['3', 'present']])
    const importance = importanceProduitFiche(cible, produit, 20, tousLesMagasins, statutsComparables, [], 'les_deux')
    expect(importance.score).toBeGreaterThan(0)
    expect(importance.presentsChezComparables).toEqual({ total: 2, presents: 2 })
  })
})
