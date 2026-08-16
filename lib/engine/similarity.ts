import type { Magasin } from '@/lib/types'

export type CritereSimilarite = 'enseigne' | 'taille' | 'les_deux'

export function magasinsSimilaires(
  cible: Magasin,
  tousLesMagasins: Magasin[],
  critere: CritereSimilarite
): Magasin[] {
  return tousLesMagasins.filter(m => {
    if (m.id === cible.id) return false
    if (critere === 'enseigne') return m.enseigne === cible.enseigne
    if (critere === 'taille') return m.taille === cible.taille
    return m.enseigne === cible.enseigne && m.taille === cible.taille
  })
}
