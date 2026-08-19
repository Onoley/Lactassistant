import { z } from 'zod'

export const RaisonSchema = z.object({
  version: z.literal(1),
  codeSignal: z.string(),
  source: z.object({ type: z.string(), id: z.string() }),
  observedAt: z.string(),
  fraicheur: z.enum(['fraiche', 'a_verifier', 'perimee']),
  contributionScore: z.number(),
  niveauDeclenche: z.enum(['P1', 'P2', 'P3']).nullable(),
  texteCommercial: z.string(),
})

export const RaisonsActuellesSchema = z.object({
  version: z.literal(1),
  raisons: z.array(RaisonSchema),
})

export type Raison = z.infer<typeof RaisonSchema>
export type RaisonsActuelles = z.infer<typeof RaisonsActuellesSchema>
