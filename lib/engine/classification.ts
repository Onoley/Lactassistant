import type { NiveauPrioriteOpportunite } from '@/lib/types'
import type { SignalDetecte } from './signal'

const ORDRE_NIVEAU: Record<NiveauPrioriteOpportunite, number> = { P3: 1, P2: 2, P1: 3 }

export function classifierNiveau(signaux: SignalDetecte[]): { niveau: NiveauPrioriteOpportunite; raisonPrincipale: string } | null {
  if (signaux.length === 0) return null

  const meilleur = signaux.reduce((a, b) => (ORDRE_NIVEAU[b.niveauDeclenche] > ORDRE_NIVEAU[a.niveauDeclenche] ? b : a))

  return {
    niveau: meilleur.niveauDeclenche,
    raisonPrincipale: meilleur.codeSignal,
  }
}
