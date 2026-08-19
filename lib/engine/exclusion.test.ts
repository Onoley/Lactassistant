import { describe, expect, it } from 'vitest'
import { typesExclus, type ContexteExclusion } from './exclusion'

function ctx(overrides: Partial<ContexteExclusion> = {}): ContexteExclusion {
  return {
    statutDisponibilite: 'commandable',
    statutCatalogue: 'permanent',
    statutProduitMagasin: 'manquant',
    promoStade: null,
    constaterDejaActionne: false,
    ...overrides,
  }
}

describe('typesExclus', () => {
  it('produit non commandable exclut tous les types', () => {
    const exclus = typesExclus(ctx({ statutDisponibilite: 'non_commandable' }))
    expect(exclus.has('referencer_produit')).toBe(true)
    expect(exclus.has('revendre_promo')).toBe(true)
    expect(exclus.size).toBe(10)
  })

  it('produit déjà présent exclut referencer_produit mais jamais revendre_promo/constater_promo/securiser_commande/optimiser_implantation', () => {
    const exclus = typesExclus(ctx({ statutProduitMagasin: 'present' }))
    expect(exclus.has('referencer_produit')).toBe(true)
    expect(exclus.has('revendre_promo')).toBe(false)
    expect(exclus.has('constater_promo')).toBe(false)
    expect(exclus.has('securiser_commande')).toBe(false)
    expect(exclus.has('optimiser_implantation')).toBe(false)
  })

  it('hors plan de vente (a_qualifier) exclut tout sauf verifier_information', () => {
    const exclus = typesExclus(ctx({ statutCatalogue: 'a_qualifier' }))
    expect(exclus.has('verifier_information')).toBe(false)
    expect(exclus.has('referencer_produit')).toBe(true)
  })

  it('promo au stade constater déjà actionnée exclut constater_promo pour cette promo', () => {
    const exclus = typesExclus(ctx({ promoStade: 'constater', constaterDejaActionne: true }))
    expect(exclus.has('constater_promo')).toBe(true)
  })

  it('promo au stade constater pas encore actionnée n\'exclut rien de plus', () => {
    const exclus = typesExclus(ctx({ promoStade: 'constater', constaterDejaActionne: false }))
    expect(exclus.has('constater_promo')).toBe(false)
  })
})
