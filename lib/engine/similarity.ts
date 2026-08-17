import type { Magasin } from '@/lib/types'

export type CritereSimilarite = 'enseigne' | 'taille' | 'les_deux'

export function magasinsSimilaires(
  cible: Magasin,
  tousLesMagasins: Magasin[],
  critere: CritereSimilarite
): Magasin[] {
  return tousLesMagasins.filter(m => {
    if (m.id === cible.id) return false
    if (critere === 'enseigne' && m.enseigne !== cible.enseigne) return false
    if (critere === 'taille' && m.taille !== cible.taille) return false
    if (critere === 'les_deux' && (m.enseigne !== cible.enseigne || m.taille !== cible.taille)) return false
    if (cible.surface !== null && m.surface !== null) {
      const ratio = m.surface / cible.surface
      if (ratio < 0.7 || ratio > 1.3) return false
    }
    return true
  })
}
