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

// Onglets "par enseigne" (LCL/ITM/CRF/CFR MARKET/Auchan HM/Auchan SM/U) :
// deux lignes d'en-tête (groupe de métrique, puis période), chaque métrique
// répétée 5x (P4, P5, Dernière Période, Cumul 3 Dernières Périodes, CAM).
// La période est lue directement dans la ligne d'en-tête plutôt que sur une
// cellule fixe, ce format n'ayant pas de cellule dédiée comme Vision CAT.
export function readVmhEnseigneSheet(buffer: ArrayBuffer, sheetName: string): { periodeReference: string; rows: (string | number | null)[][] } {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error(`Onglet "${sheetName}" introuvable dans le fichier`)

  const [lignePeriodes] = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 8, raw: true, defval: null }) as (string | number | null)[][]
  const periodeReference = String(lignePeriodes?.[80] ?? '').trim()

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, range: 9, raw: true, defval: null }) as (string | number | null)[][]

  return { periodeReference, rows }
}

// Lit l'onglet "plan de vente" d'une enseigne : titre (ligne 1), sous-titre
// avec compteur (ligne 2), ligne vide (ligne 3), en-têtes (ligne 4), données
// à partir de la ligne 5. TYPOLOGIE est absente pour les enseignes qui n'ont
// pas cette donnée (Intermarché/Leclerc/Système U).
export function readPlanDeVenteSheet(buffer: ArrayBuffer, sheetName: string): Record<string, string>[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error(`Onglet "${sheetName}" introuvable dans le fichier`)
  return XLSX.utils.sheet_to_json(sheet, { range: 3, defval: '', raw: false })
}
