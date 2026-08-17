import type { Promo } from '@/lib/types'

export type StadePromo = 'anticiper' | 'revendre' | 'controler' | 'constater'

// ponytail: repli arbitraire (21 jours) quand date_installation est inconnue —
// cohérent avec les seuils déjà utilisés ailleurs dans le moteur, à recalibrer
// avec le retour terrain.
const JOURS_ANTICIPATION_PAR_DEFAUT = 21

export function stadePromo(promo: Promo, aujourdHui: Date = new Date()): StadePromo {
  const debutVente = new Date(promo.date_debut_vente)
  const debutInstallation = promo.date_installation
    ? new Date(promo.date_installation)
    : new Date(debutVente.getTime() - JOURS_ANTICIPATION_PAR_DEFAUT * 86_400_000)
  const finVente = promo.date_fin_vente ? new Date(promo.date_fin_vente) : null

  if (aujourdHui < debutInstallation) return 'anticiper'
  if (aujourdHui < debutVente) return 'revendre'
  if (finVente === null || aujourdHui <= finVente) return 'controler'
  return 'constater'
}
