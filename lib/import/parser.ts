import * as XLSX from 'xlsx'

export interface ImportError {
  row: number
  message: string
}

export interface ParseResult<T> {
  valid: T[]
  errors: ImportError[]
}

export function readSpreadsheet(buffer: ArrayBuffer): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  return XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false })
}

export function parseRows<T>(
  rows: Record<string, string>[],
  mapRow: (row: Record<string, string>) => T
): ParseResult<T> {
  const valid: T[] = []
  const errors: ImportError[] = []
  rows.forEach((row, index) => {
    try {
      valid.push(mapRow(row))
    } catch (err) {
      errors.push({ row: index + 2, message: (err as Error).message })
    }
  })
  return { valid, errors }
}

export function readVmhSheet(buffer: ArrayBuffer): { periodeReference: string; rows: (string | number | null)[][] } {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets['Vision CAT']
  if (!sheet) throw new Error('Onglet "Vision CAT" introuvable dans le fichier')

  const periodeCell = sheet['M5']
  const periodeReference = periodeCell ? String(periodeCell.v ?? '').trim() : ''

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 5, raw: true, defval: null }) as (string | number | null)[][]

  return { periodeReference, rows }
}
