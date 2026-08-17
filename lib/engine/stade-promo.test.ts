import { describe, expect, it } from 'vitest'
import { stadePromo } from './stade-promo'
import type { Promo } from '@/lib/types'

function promo(overrides: Partial<Promo> = {}): Promo {
  return {
    id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%',
    date_installation: '2026-09-01', date_debut_vente: '2026-09-10', date_constat: null,
    date_fin_vente: '2026-09-20',
    ...overrides,
  }
}

describe('stadePromo', () => {
  it("anticiper avant la date d'installation connue", () => {
    expect(stadePromo(promo(), new Date('2026-08-20'))).toBe('anticiper')
  })

  it("revendre entre l'installation et le début de vente", () => {
    expect(stadePromo(promo(), new Date('2026-09-05'))).toBe('revendre')
  })

  it('controler entre le début et la fin de vente', () => {
    expect(stadePromo(promo(), new Date('2026-09-15'))).toBe('controler')
  })

  it('constater après la fin de vente', () => {
    expect(stadePromo(promo(), new Date('2026-09-25'))).toBe('constater')
  })

  it('controler indéfiniment si date_fin_vente est inconnue', () => {
    const promoSansFin = promo({ date_fin_vente: null })
    expect(stadePromo(promoSansFin, new Date('2027-01-01'))).toBe('controler')
  })

  it('replie sur 21 jours avant date_debut_vente quand date_installation est inconnue', () => {
    const promoSansInstallation = promo({ date_installation: null, date_debut_vente: '2026-09-10' })
    // 26 jours avant le début de vente : encore avant le repli (21 jours) → anticiper
    expect(stadePromo(promoSansInstallation, new Date('2026-08-15'))).toBe('anticiper')
    // 16 jours avant le début de vente : après le repli (21 jours) → revendre
    expect(stadePromo(promoSansInstallation, new Date('2026-08-25'))).toBe('revendre')
  })
})
