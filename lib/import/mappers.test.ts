import { describe, expect, it } from 'vitest'
import { mapMagasinRow, mapPlanDeVenteRow, mapProduitRow, mapPromoRows, mapVmhRow, mapVmhEnseigneRow } from './mappers'

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

describe('mapPromoRows', () => {
  function ligne(overrides: Partial<Record<string, string>> = {}) {
    return {
      'Thème': 'NOVEMBRE 1',
      'Conso déb.': '02/11/2026',
      'Conso fin': '16/11/2026',
      'Revente déb.': '06/06/2026',
      'Revente fin': '29/06/2026',
      'OP Trade': '',
      'Statut': '',
      'Support OP': 'Tract',
      'Niveau opération': 'Nationale',
      'Libellé produit': 'Yaourt A\nYaourt B',
      'EAN': '1111111111111\n2222222222222',
      'Offre conso': '3 pour 2\n3 pour 2',
      'CA Négo': '\n',
      'CA Réal': '\n',
      ...overrides,
    }
  }

  it("découpe une opération réelle en une promo par produit rattachée à la même mécanique", () => {
    const { valid, errors } = mapPromoRows([ligne()], 'Carrefour')
    expect(errors).toHaveLength(0)
    expect(valid).toHaveLength(1)
    expect(valid[0].mecanique).toBe('3 pour 2')
    expect(valid[0].produits).toHaveLength(2)
    expect(valid[0].produits[0].ean).toBe('1111111111111')
    expect(valid[0].dateDebutVente).toBe('2026-11-02')
    expect(valid[0].dateInstallation).toBe('2026-06-06')
  })

  it('éclate une opération en plusieurs promos quand les mécaniques diffèrent', () => {
    const { valid } = mapPromoRows([ligne({ 'Offre conso': '3 pour 2\n2ème à 50%' })], 'Carrefour')
    expect(valid).toHaveLength(2)
    expect(valid.map(p => p.mecanique).sort()).toEqual(['2ème à 50%', '3 pour 2'])
    expect(new Set(valid.map(p => p.code)).size).toBe(2)
    expect(valid.every(p => p.produits.length === 1)).toBe(true)
  })

  it('signale une ligne avec une date "Conso déb." mal formatée sans bloquer les autres lignes', () => {
    const { valid, errors } = mapPromoRows([ligne({ 'Conso déb.': '2026-11-02' }), ligne({ Thème: 'NOVEMBRE 2' })], 'Carrefour')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('JJ/MM/AAAA')
    expect(valid).toHaveLength(1)
  })

  it('conserve le champ OP Trade quand il est renseigné', () => {
    const { valid } = mapPromoRows([ligne({ 'OP Trade': ' OP PRODUITS LAITIERS 2026' })], 'Auchan')
    expect(valid[0].opTrade).toBe('OP PRODUITS LAITIERS 2026')
  })
})

describe('mapVmhRow', () => {
  // Colonnes 0-indexées, copiées de la ligne 6 réelle de l'onglet "Vision CAT"
  // du fichier "vmh et produit  2.xlsx" (SVELTESSE FERME ET FONDANT CAFE) :
  // 0 Produits, 10 Desc EAN, 11 Prix (Derniere Periode), 15 DV HMSM,
  // 16 DV HM, 17 DV SM, 18 VMH HM (Cumul 3), 20 VMH SM (Cumul 3).
  function ligneReelle(overrides: Partial<Record<number, string | number | null>> = {}): (string | number | null)[] {
    const base: (string | number | null)[] = new Array(34).fill(null)
    base[0] = 'SVELTESSE FERME ET FONDANT CAFE X 4 125 GR STD - 8410100068183'
    base[10] = '8410100068183'
    base[11] = 1.6220223503058064
    base[15] = 41.49097379528104
    base[16] = 59.735929218205705
    base[17] = 21.27722652169616
    base[18] = 9.241001784165155
    base[20] = 3.5875268491463155
    for (const [i, v] of Object.entries(overrides)) {
      const idx = Number(i)
      if (v !== undefined) base[idx] = v
    }
    return base
  }

  it('extrait les champs pertinents depuis une ligne réelle', () => {
    const result = mapVmhRow(ligneReelle())
    expect(result).not.toBeNull()
    expect(result?.ean).toBe('8410100068183')
    expect(result?.prixMoyen).toBeCloseTo(1.622, 3)
    expect(result?.dvHmsm).toBeCloseTo(41.49, 1)
    expect(result?.dvHyper).toBeCloseTo(59.74, 1)
    expect(result?.dvSuper).toBeCloseTo(21.28, 1)
    expect(result?.vmhHyper).toBeCloseTo(9.24, 1)
    expect(result?.vmhSuper).toBeCloseTo(3.59, 1)
  })

  it('ignore une ligne sans EAN (ligne de sous-total ou vide)', () => {
    expect(mapVmhRow(ligneReelle({ 10: null }))).toBeNull()
  })

  it('ignore une ligne avec un EAN non numérique ("#N/A", placeholder Nielsen)', () => {
    expect(mapVmhRow(ligneReelle({ 10: '#N/A' }))).toBeNull()
  })

  it('renvoie null pour les métriques absentes plutôt que NaN ou 0', () => {
    const result = mapVmhRow(ligneReelle({ 18: null, 20: null }))
    expect(result?.vmhHyper).toBeNull()
    expect(result?.vmhSuper).toBeNull()
  })
})

describe('mapVmhEnseigneRow', () => {
  // Colonnes 0-indexées, copiées de l'onglet "CRF" réel de
  // "vmh et produit  2.xlsx" : 55 Desc EAN (CAM), 60 Prix Moyen Unite (CAM),
  // 70 DV (CAM), 80 VMH Unite Ajustees (CAM).
  function ligneReelle(overrides: Partial<Record<number, string | number | null>> = {}): (string | number | null)[] {
    const base: (string | number | null)[] = new Array(106).fill(null)
    base[55] = '3023290008454'
    base[60] = 2.887085099401132
    base[70] = 59.18717625944746
    base[80] = 7.150832774351108
    for (const [i, v] of Object.entries(overrides)) {
      const idx = Number(i)
      if (v !== undefined) base[idx] = v
    }
    return base
  }

  it('extrait les champs pertinents depuis une ligne réelle', () => {
    const result = mapVmhEnseigneRow(ligneReelle())
    expect(result).not.toBeNull()
    expect(result?.ean).toBe('3023290008454')
    expect(result?.vmh).toBeCloseTo(7.15, 1)
    expect(result?.dv).toBeCloseTo(59.19, 1)
    expect(result?.prixMoyen).toBeCloseTo(2.887, 3)
  })

  it('ignore une ligne sans EAN', () => {
    expect(mapVmhEnseigneRow(ligneReelle({ 55: null }))).toBeNull()
  })

  it('renvoie null pour un VMH absent (enseigne sans donnée VMH, ex. Leclerc/Intermarché)', () => {
    const result = mapVmhEnseigneRow(ligneReelle({ 80: null }))
    expect(result?.vmh).toBeNull()
    expect(result?.dv).toBeCloseTo(59.19, 1)
  })
})

describe('mapPlanDeVenteRow', () => {
  function ligne(overrides: Partial<Record<string, string>> = {}) {
    return {
      'EAN PRODUIT': '3023290038147',
      'NOM DU PRODUIT': "SIGGI'S CITRON X 2 140 GR STD",
      'FAMILLE': 'Skyr',
      'SEGMENT': 'Skyr',
      'TYPOLOGIE': 'MN',
      ...overrides,
    }
  }

  it('extrait les champs pertinents', () => {
    const result = mapPlanDeVenteRow(ligne())
    expect(result).toEqual({ ean: '3023290038147', nom: "SIGGI'S CITRON X 2 140 GR STD", famille: 'Skyr', segment: 'Skyr', typologie: 'MN' })
  })

  it('renvoie typologie null quand la colonne est absente ou vide (Intermarché/Leclerc/Système U)', () => {
    const result = mapPlanDeVenteRow(ligne({ TYPOLOGIE: '' }))
    expect(result?.typologie).toBeNull()
  })

  it('ignore une ligne sans EAN', () => {
    expect(mapPlanDeVenteRow(ligne({ 'EAN PRODUIT': '' }))).toBeNull()
  })
})
