import { describe, expect, it } from 'vitest'
import { decalerSemaine, numeroSemaineCourante } from './semaine'

describe('numeroSemaineCourante', () => {
  it('calcule la semaine ISO correcte', () => {
    expect(numeroSemaineCourante(new Date('2026-08-16'))).toBe('2026-W33')
  })

  it('gère le passage d\'année', () => {
    expect(numeroSemaineCourante(new Date('2026-01-01'))).toBe('2026-W01')
  })
})

describe('decalerSemaine', () => {
  it('avance à la semaine suivante', () => {
    expect(decalerSemaine('2026-W33', 1)).toBe('2026-W34')
  })

  it('recule à la semaine précédente', () => {
    expect(decalerSemaine('2026-W34', -1)).toBe('2026-W33')
  })

  it('gère le passage d\'année en avançant', () => {
    expect(decalerSemaine('2025-W52', 1)).toBe('2026-W01')
  })

  it('gère le passage d\'année en reculant', () => {
    expect(decalerSemaine('2026-W01', -1)).toBe('2025-W52')
  })
})
