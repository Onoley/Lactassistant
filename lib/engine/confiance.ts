import type { Confiance } from '@/lib/types'
import type { SignalDetecte } from './signal'

const SOURCES_DIRECTES: SignalDetecte['sourceType'][] = ['promo', 'engagement', 'historique_rupture']

export function determinerConfiance(signaux: SignalDetecte[]): { confiance: Confiance; contradiction: boolean } {
  const parTypeEtPromo = new Map<string, SignalDetecte[]>()
  for (const s of signaux) {
    const cle = `${s.typeMission}:${s.promoId ?? ''}`
    const liste = parTypeEtPromo.get(cle) ?? []
    liste.push(s)
    parTypeEtPromo.set(cle, liste)
  }

  const contradiction = [...parTypeEtPromo.values()].some(groupe => {
    const niveaux = new Set(groupe.map(s => s.niveauDeclenche))
    return niveaux.has('P1') && niveaux.has('P3')
  })

  if (contradiction) return { confiance: 'information_a_verifier', contradiction: true }

  const aUnSignalDirect = signaux.some(s => SOURCES_DIRECTES.includes(s.sourceType))
  return { confiance: aUnSignalDirect ? 'donnees_confirmees' : 'recommandation_probable', contradiction: false }
}
