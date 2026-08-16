import { describe, expect, it } from 'vitest'
import { parseRows } from './parser'

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
