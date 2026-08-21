import { describe, expect, it, vi } from 'vitest'

vi.mock('./config-moteur', () => ({ moteurActif: () => false, CONFIG_MOTEUR_DEFAUT: {} }))

import { executerPipelinePourProduit } from './executer-pipeline'

describe('executerPipelinePourProduit', () => {
  it('ne fait rien quand le moteur est désactivé (shadow mode off)', async () => {
    const admin = { from: vi.fn(), rpc: vi.fn() } as unknown as Parameters<typeof executerPipelinePourProduit>[0]
    await executerPipelinePourProduit(admin, 'm1', 'p1')
    expect(admin.from).not.toHaveBeenCalled()
    expect(admin.rpc).not.toHaveBeenCalled()
  })
})
