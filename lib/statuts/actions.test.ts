// lib/statuts/actions.test.ts
import { describe, expect, it, vi } from 'vitest'

const upsertCalls: unknown[] = []
const insertCalls: unknown[] = []
// Per-produit override for produit_canonique_id, keyed by produitId. Empty by
// default so existing tests keep resolving to `null` (idEffectif === produitId).
const canoniqueByProduit: Record<string, string | null> = {}

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: (_col: string, id: string) => ({
          single: async () => ({ data: { produit_canonique_id: canoniqueByProduit[id] ?? null } }),
        }),
      }),
      upsert: (payload: unknown, opts: unknown) => {
        upsertCalls.push({ table, payload, opts })
        return Promise.resolve({ error: null })
      },
      insert: (payload: unknown) => {
        insertCalls.push({ table, payload })
        return Promise.resolve({ error: null })
      },
    }),
  }),
  getCurrentProfile: async () => ({ id: 'commercial-1' }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

import { updateStatutProduit } from './actions'

describe('updateStatutProduit — historique', () => {
  it('upsert sur (magasin,produit,visite) quand une visite est fournie', async () => {
    upsertCalls.length = 0
    await updateStatutProduit('m1', 'p1', 'rupture', 'v1')
    const historiqueCall = upsertCalls.find(c => (c as { table: string }).table === 'statuts_produit_magasin_historique')
    expect(historiqueCall).toBeDefined()
    expect((historiqueCall as { opts: { onConflict: string } }).opts.onConflict).toBe('magasin_id,produit_id,visite_id')
  })

  it('insert simple quand aucune visite n\'est fournie', async () => {
    insertCalls.length = 0
    await updateStatutProduit('m1', 'p1', 'rupture')
    const historiqueCall = insertCalls.find(c => (c as { table: string }).table === 'statuts_produit_magasin_historique')
    expect(historiqueCall).toBeDefined()
  })

  it('résout le produit canonique avant d\'écrire dans l\'historique', async () => {
    upsertCalls.length = 0
    canoniqueByProduit.p1 = 'canon-1'
    try {
      await updateStatutProduit('m1', 'p1', 'rupture', 'v1')
      const historiqueCall = upsertCalls.find(c => (c as { table: string }).table === 'statuts_produit_magasin_historique')
      expect(historiqueCall).toBeDefined()
      expect((historiqueCall as { payload: { produit_id: string } }).payload.produit_id).toBe('canon-1')
    } finally {
      delete canoniqueByProduit.p1
    }
  })
})
