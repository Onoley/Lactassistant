import { describe, expect, it } from 'vitest'
import { chargerTousLesPromoLiens } from './promo-liens'

function fakeSupabase(total: number) {
  const toutesLesLignes = Array.from({ length: total }, (_, i) => ({
    produit_id: `p${i}`,
    promos: { id: `promo${i}` },
  }))
  return {
    from: () => ({
      select: () => ({
        range: (debut: number, fin: number) =>
          Promise.resolve({ data: toutesLesLignes.slice(debut, fin + 1), error: null }),
      }),
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

describe('chargerTousLesPromoLiens', () => {
  it('pagine au-delà de la limite PostgREST de 1000 lignes', async () => {
    const lignes = await chargerTousLesPromoLiens(fakeSupabase(1500))
    expect(lignes).toHaveLength(1500)
    expect(lignes[1499].produit_id).toBe('p1499')
  })

  it("s'arrête proprement quand le total est un multiple exact de la taille de page", async () => {
    const lignes = await chargerTousLesPromoLiens(fakeSupabase(2000))
    expect(lignes).toHaveLength(2000)
  })

  it('gère un total sous la taille de page en un seul aller', async () => {
    const lignes = await chargerTousLesPromoLiens(fakeSupabase(3))
    expect(lignes).toHaveLength(3)
  })
})
