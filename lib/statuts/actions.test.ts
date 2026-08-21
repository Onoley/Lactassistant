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
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }))
vi.mock('@/lib/engine/executer-pipeline', () => ({ executerPipelinePourProduit: vi.fn(async () => {}) }))

import { updateStatutProduit } from './actions'
import { executerPipelinePourProduit } from '@/lib/engine/executer-pipeline'

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

describe('updateStatutProduit — pipeline d\'opportunités', () => {
  it('appelle executerPipelinePourProduit avec le produit canonique résolu et la visite', async () => {
    vi.clearAllMocks()
    canoniqueByProduit.p1 = 'canon-1'
    try {
      await updateStatutProduit('m1', 'p1', 'rupture', 'v1')
      expect(executerPipelinePourProduit).toHaveBeenCalledOnce()
      const calls = (executerPipelinePourProduit as any).mock.calls
      expect(calls[0][1]).toBe('m1') // magasinId
      expect(calls[0][2]).toBe('canon-1') // idEffectif (produit canonique)
      expect(calls[0][3]).toBe('v1') // visiteId
    } finally {
      delete canoniqueByProduit.p1
    }
  })

  it('appelle executerPipelinePourProduit avec le produit id quand pas de canonique', async () => {
    vi.clearAllMocks()
    await updateStatutProduit('m2', 'p2', 'rupture', 'v2')
    expect(executerPipelinePourProduit).toHaveBeenCalledOnce()
    const calls = (executerPipelinePourProduit as any).mock.calls
    expect(calls[0][1]).toBe('m2') // magasinId
    expect(calls[0][2]).toBe('p2') // idEffectif (pas de canonique, donc p2)
    expect(calls[0][3]).toBe('v2') // visiteId
  })

  it('appelle executerPipelinePourProduit même quand pas de visite', async () => {
    vi.clearAllMocks()
    await updateStatutProduit('m3', 'p3', 'rupture')
    expect(executerPipelinePourProduit).toHaveBeenCalledOnce()
    const calls = (executerPipelinePourProduit as any).mock.calls
    expect(calls[0][1]).toBe('m3') // magasinId
    expect(calls[0][2]).toBe('p3') // idEffectif
    expect(calls[0][3]).toBeNull() // visiteId
  })
})
