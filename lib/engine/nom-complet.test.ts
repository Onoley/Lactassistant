import { describe, expect, it } from 'vitest'
import { nomComplet } from './nom-complet'

describe('nomComplet', () => {
  it('ajoute le format quand il est renseigné', () => {
    expect(nomComplet({ nom: 'Sveltesse Ferme Et Fondant Cafe', format: 'x4 125g' }))
      .toBe('Sveltesse Ferme Et Fondant Cafe — x4 125g')
  })

  it("n'ajoute rien quand le format est déjà inclus dans le nom (produit sans colonne format séparée)", () => {
    expect(nomComplet({ nom: 'La Laitière FDM chocolat 3x57g +1 offert', format: null }))
      .toBe('La Laitière FDM chocolat 3x57g +1 offert')
  })

  it('distingue deux produits de même nom par leur format', () => {
    const a = nomComplet({ nom: "Siggi's Nature", format: 'x2 140g' })
    const b = nomComplet({ nom: "Siggi's Nature", format: 'x1 450g' })
    expect(a).not.toBe(b)
  })
})
