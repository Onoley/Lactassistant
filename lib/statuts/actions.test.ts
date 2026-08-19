// lib/statuts/actions.test.ts
import { describe, expect, it, vi } from 'vitest'

const upsertCalls: unknown[] = []
const insertCalls: unknown[] = []

vi.mock('@/lib/supabase/server', () => ({
  createServerClient: () => ({
    from: (table: string) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { produit_canonique_id: null } }) }) }),
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
})
