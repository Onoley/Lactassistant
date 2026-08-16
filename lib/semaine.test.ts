import { describe, expect, it } from 'vitest'
import { numeroSemaineCourante } from './semaine'

describe('numeroSemaineCourante', () => {
  it('calcule la semaine ISO correcte', () => {
    expect(numeroSemaineCourante(new Date('2026-08-16'))).toBe('2026-W33')
  })

  it('gère le passage d\'année', () => {
    expect(numeroSemaineCourante(new Date('2026-01-01'))).toBe('2026-W01')
  })
})
