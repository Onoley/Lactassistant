import { describe, expect, it, vi } from 'vitest'

// select() doit à la fois être "then-able" directement (comme dans le vrai
// PostgrestFilterBuilder) et supporter un .not() chaîné derrière — d'où ce
// builder qui se retourne lui-même.
const builder: { then: (resolve: (v: { data: unknown[] }) => void) => void; not: () => typeof builder } = {
  then: resolve => resolve({ data: [] }),
  not: () => builder,
}
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: () => ({ select: () => builder }) }) }))
vi.mock('@/lib/engine/executer-pipeline', () => ({ executerPipelinePourProduit: vi.fn() }))

import { GET } from './route'

describe('GET /api/moteur/recalculer', () => {
  it('rejette une requête sans le secret attendu', async () => {
    const req = new Request('http://localhost/api/moteur/recalculer')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('accepte une requête avec le bon secret', async () => {
    process.env.MOTEUR_RECALCUL_SECRET = 'test-secret'
    const req = new Request('http://localhost/api/moteur/recalculer', { headers: { authorization: 'Bearer test-secret' } })
    const res = await GET(req)
    expect(res.status).toBe(200)
  })
})
