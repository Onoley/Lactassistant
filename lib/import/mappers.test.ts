import { describe, expect, it } from 'vitest'
import { mapMagasinRow, mapProduitRow, mapPromoRow } from './mappers'

describe('mapMagasinRow', () => {
  function ligne(overrides: Partial<Record<string, string>> = {}) {
    return {
      'Priorisation': 'Linéaire <125m',
      'Raison Sociale': 'CARREFOUR MARKET',
      'Code Postal': '75009',
      'Ville': 'PARIS 09EME',
      'Téléphone': '01 45 26 83 37',
      'Adresse': '61 RUE MARGUERITE DE ROCHECHOUART',
      'Code du Point de Vente': '75115',
      ...overrides,
    }
  }

  it('accepte une ligne réelle de l\'export "MES MAGASINS"', () => {
    const result = mapMagasinRow(ligne())
    expect(result.code).toBe('75115')
    expect(result.enseigne).toBe('Carrefour Market')
    expect(result.taille).toBe('super')
    expect(result.nom).toContain('Carrefour Market')
    expect(result.adresse).toContain('75009')
  })

  it('déduit hyper/proxi/drive depuis la Priorisation', () => {
    expect(mapMagasinRow(ligne({ Priorisation: 'Linéaire >125m', 'Raison Sociale': 'CARREFOUR' })).taille).toBe('hyper')
    expect(mapMagasinRow(ligne({ Priorisation: 'Proxi', 'Raison Sociale': 'INTERMARCHE EXPRESS' })).taille).toBe('proxi')
    expect(mapMagasinRow(ligne({ Priorisation: 'Drive', 'Raison Sociale': 'E. LECLERC DRIVE' })).taille).toBe('drive')
  })

  it('retombe sur le format déduit de l\'enseigne pour les magasins "Non Priorisé"', () => {
    expect(mapMagasinRow(ligne({ Priorisation: 'Non Priorisé', 'Raison Sociale': 'E. LECLERC DRIVE' })).taille).toBe('drive')
    expect(mapMagasinRow(ligne({ Priorisation: 'Non Priorisé', 'Raison Sociale': 'AUCHAN SUPERMARCHE' })).taille).toBe('super')
  })

  it('rejette une raison sociale sans correspondance connue', () => {
    expect(() => mapMagasinRow(ligne({ 'Raison Sociale': 'MONOPRIX' }))).toThrow('Enseigne inconnue')
  })

  it('rejette une ligne sans code du point de vente', () => {
    const { 'Code du Point de Vente': _omit, ...sansCode } = ligne()
    expect(() => mapMagasinRow(sansCode)).toThrow('Code du Point de Vente')
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
