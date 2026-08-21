import { describe, expect, it, vi } from 'vitest'

const etat = vi.hoisted(() => ({ moteurActif: false }))
vi.mock('./config-moteur', () => ({ moteurActif: () => etat.moteurActif, CONFIG_MOTEUR_DEFAUT: {} }))

const rattacherOpportunitesMock = vi.hoisted(() => vi.fn().mockResolvedValue([]))
vi.mock('./rattachement', () => ({ rattacherOpportunites: rattacherOpportunitesMock }))

import { executerPipelinePourProduit } from './executer-pipeline'

describe('executerPipelinePourProduit', () => {
  it('ne fait rien quand le moteur est désactivé (shadow mode off)', async () => {
    etat.moteurActif = false
    const admin = { from: vi.fn(), rpc: vi.fn() } as unknown as Parameters<typeof executerPipelinePourProduit>[0]
    await executerPipelinePourProduit(admin, 'm1', 'p1')
    expect(admin.from).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalled()
  })

  it('trouve une promo liée uniquement via un EAN-variante, pas seulement via l\'id canonique', async () => {
    etat.moteurActif = true
    rattacherOpportunitesMock.mockClear()

    const magasinRow = { id: 'm1', enseigne: 'Leclerc' }
    const produitRow = { id: 'p1', produit_canonique_id: null }
    const promoRow = { id: 'promoA', enseigne: 'Leclerc', mecanique: 'ODR' }

    // Chaîne minimale imitant le query builder Supabase : select/eq/in
    // renvoient le même objet (chaînable), et le résultat se résout via
    // .single()/.maybeSingle() ou en awaitant l'objet directement (.then).
    function chainable(resoudre: (filtres: Record<string, unknown>) => unknown) {
      const filtres: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (col: string, val: unknown) => { filtres[col] = val; return chain }
      chain.in = (col: string, val: unknown) => { filtres[col] = val; return chain }
      const settle = () => Promise.resolve({ data: resoudre(filtres), error: null })
      chain.single = settle
      chain.maybeSingle = settle
      chain.then = (onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) => settle().then(onFulfilled, onRejected)
      return chain
    }

    const admin = {
      from: vi.fn((table: string) => {
        switch (table) {
          case 'magasins': return chainable(() => magasinRow)
          // produits est interrogé deux fois : par id (produit canonique) et
          // par produit_canonique_id (résolution des variantes).
          case 'produits': return chainable(f => (f.id ? produitRow : [{ id: 'variant-ean-1' }]))
          case 'statuts_produit_magasin': return chainable(() => null)
          case 'produits_enseigne': return chainable(() => [])
          case 'opportunites': return chainable(() => [])
          case 'priorites_produits': return chainable(() => null)
          case 'statuts_produit_magasin_historique': return chainable(() => [])
          // promo_produits.produit_id contient l'EAN-variante, pas l'id
          // canonique 'p1' : seule une recherche sur l'ensemble (canonique +
          // variantes) la trouve.
          case 'promo_produits': return chainable(f => {
            const ids = f.produit_id as string[] | undefined
            return ids?.includes('variant-ean-1') ? [{ promo_id: 'promoA', promos: promoRow }] : []
          })
          default: return chainable(() => null)
        }
      }),
      rpc: vi.fn(),
    } as unknown as Parameters<typeof executerPipelinePourProduit>[0]

    await executerPipelinePourProduit(admin, 'm1', 'p1')

    expect(rattacherOpportunitesMock).toHaveBeenCalledTimes(1)
    const ctx = rattacherOpportunitesMock.mock.calls[0][1] as { promosApplicables: Array<{ id: string }> }
    expect(ctx.promosApplicables.map(p => p.id)).toContain('promoA')
  })
})
