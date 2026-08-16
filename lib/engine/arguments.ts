import type { Magasin, Produit, Promo, StatutProduit } from '@/lib/types'
import { magasinsSimilaires, type CritereSimilarite } from './similarity'
import { scoreRangProduit, scorePriorite, type Rang } from './scoring'

export interface Argument {
  type: 'magasins_similaires' | 'promo'
  message: string
}

export function genererArguments(
  magasin: Magasin,
  produit: Produit,
  rang: Rang,
  tousLesMagasins: Magasin[],
  statutsParMagasin: Map<string, StatutProduit>,
  promosDuProduit: Promo[],
  critere: CritereSimilarite
): { arguments: Argument[]; score: number } {
  const args: Argument[] = []
  const similaires = magasinsSimilaires(magasin, tousLesMagasins, critere)
  const presentsChezSimilaires = similaires.filter(m => statutsParMagasin.get(m.id) === 'present')

  if (presentsChezSimilaires.length > 0) {
    args.push({
      type: 'magasins_similaires',
      message: `Présent dans ${presentsChezSimilaires.length} magasin(s) similaire(s) sur ${similaires.length}.`,
    })
  }

  for (const promo of promosDuProduit) {
    args.push({
      type: 'promo',
      message: `Promo "${promo.mecanique}" chez ${promo.enseigne} : installation le ${promo.date_installation}, vente le ${promo.date_debut_vente}.`,
    })
  }

  const score = promosDuProduit.length > 0
    ? Math.max(...promosDuProduit.map(p => scorePriorite(rang, [p.date_installation, p.date_debut_vente, p.date_constat].sort()[0])))
    : scoreRangProduit(rang)

  return { arguments: args, score }
}
