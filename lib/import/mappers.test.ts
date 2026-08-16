import { describe, expect, it } from 'vitest'
import { mapMagasinRow, mapProduitRow, mapPromoRow } from './mappers'

describe('mapMagasinRow', () => {
  it('accepte une ligne valide', () => {
    const result = mapMagasinRow({ code: 'M1', nom: 'Carrefour Test', enseigne: 'Carrefour', taille: 'super', secteur: 'Nord', adresse: '', contact_nom: '', contact_telephone: '', contact_email: '' })
    expect(result.code).toBe('M1')
    expect(result.secteurNom).toBe('Nord')
  })

  it("rejette une ligne sans code", () => {
    expect(() => mapMagasinRow({ nom: 'X', enseigne: 'Carrefour', taille: 'super', secteur: 'Nord' })).toThrow('code')
  })
})

describe('mapProduitRow', () => {
  it('rejette un rang invalide', () => {
    expect(() => mapProduitRow({ code: 'P1', nom: 'Yaourt', rang: '30' })).toThrow('Rang')
  })

  it('accepte un rang valide', () => {
    const result = mapProduitRow({ code: 'P1', nom: 'Yaourt', rang: '20', categorie: 'Ultra-frais' })
    expect(result.rang).toBe(20)
  })
})

describe('mapPromoRow', () => {
  it('rejette une date mal formatée', () => {
    expect(() => mapPromoRow({
      code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%',
      date_installation: '01/09/2026', date_debut_vente: '2026-09-05', date_constat: '2026-09-10',
      produits_codes: 'P1;P2',
    })).toThrow('AAAA-MM-JJ')
  })

  it('découpe les codes produits multiples', () => {
    const result = mapPromoRow({
      code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%',
      date_installation: '2026-09-01', date_debut_vente: '2026-09-05', date_constat: '2026-09-10',
      produits_codes: 'P1; P2',
    })
    expect(result.produitsCodes).toEqual(['P1', 'P2'])
  })
})
