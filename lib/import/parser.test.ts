import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { parseRows, readPlanDeVenteSheet } from './parser'

describe('parseRows', () => {
  it('sépare les lignes valides des lignes en erreur', () => {
    const rows = [{ nom: 'A' }, { nom: '' }, { nom: 'C' }]
    const result = parseRows(rows, (row) => {
      if (!row.nom) throw new Error('nom manquant')
      return { nom: row.nom }
    })
    expect(result.valid).toEqual([{ nom: 'A' }, { nom: 'C' }])
    expect(result.errors).toEqual([{ row: 3, message: 'nom manquant' }])
  })
})

describe('readPlanDeVenteSheet', () => {
  it('lit les lignes de données à partir de la ligne d\'en-tête réelle (ligne 4)', () => {
    const wb = XLSX.utils.book_new()
    const rows = [
      ['PLAN DE VENTE LNUF - CARREFOUR'],
      ['123 références • Familles et segments regroupés • Mise à jour 25/06/2026'],
      [],
      ['EAN PRODUIT', 'NOM DU PRODUIT', 'FAMILLE', 'SEGMENT', 'TYPOLOGIE'],
      ['3023290038147', "SIGGI'S CITRON X 2 140 GR STD", 'Skyr', 'Skyr', 'MN'],
    ]
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    XLSX.utils.book_append_sheet(wb, sheet, 'Carrefour')
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })

    const result = readPlanDeVenteSheet(buffer, 'Carrefour')
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ 'EAN PRODUIT': '3023290038147', 'NOM DU PRODUIT': "SIGGI'S CITRON X 2 140 GR STD", TYPOLOGIE: 'MN' })
  })

  it('lève une erreur explicite si l\'onglet est absent', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Autre')
    const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
    expect(() => readPlanDeVenteSheet(buffer, 'Carrefour')).toThrow('Onglet "Carrefour" introuvable')
  })
})
