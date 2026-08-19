import { createHash } from 'crypto'
import type { Confiance, NiveauPrioriteOpportunite, StatutOpportunite } from '@/lib/types'
import type { RaisonsActuelles } from './raison'

export interface ResultatMoteur {
  niveauPriorite: NiveauPrioriteOpportunite | null
  score: number | null
  confiance: Confiance | null
  raisons: RaisonsActuelles | null
  statut: StatutOpportunite
}

export function calculerFingerprint(resultat: ResultatMoteur): string {
  const canonique = {
    niveauPriorite: resultat.niveauPriorite,
    score: resultat.score,
    confiance: resultat.confiance,
    raisons: (resultat.raisons?.raisons ?? [])
      .map(r => ({ code: r.codeSignal, source: r.source, contribution: r.contributionScore, niveau: r.niveauDeclenche }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    statut: resultat.statut,
  }
  return createHash('sha256').update(JSON.stringify(canonique)).digest('hex')
}
