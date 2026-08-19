import type { StatutDisponibilite, StatutProduit, Produit, TypeMission } from '@/lib/types'
import type { StadePromo } from './stade-promo'

const TOUS_TYPES_MISSION: TypeMission[] = [
  'anticiper_promo', 'revendre_promo', 'constater_promo',
  'referencer_produit', 'corriger_rupture', 'securiser_commande',
  'suivre_engagement', 'optimiser_implantation', 'proposer_test_ht', 'verifier_information',
]

export interface ContexteExclusion {
  statutDisponibilite: StatutDisponibilite
  statutCatalogue: Produit['statut_catalogue']
  statutProduitMagasin: StatutProduit
  promoStade: StadePromo | null
  constaterDejaActionne: boolean
}

export function typesExclus(ctx: ContexteExclusion): Set<TypeMission> {
  if (ctx.statutDisponibilite === 'non_commandable' || ctx.statutDisponibilite === 'arret_industriel') {
    return new Set(TOUS_TYPES_MISSION)
  }

  const exclus = new Set<TypeMission>()

  if (ctx.statutCatalogue === 'a_qualifier') {
    for (const t of TOUS_TYPES_MISSION) {
      if (t !== 'verifier_information') exclus.add(t)
    }
  }

  if (ctx.statutProduitMagasin === 'present') {
    exclus.add('referencer_produit')
  }

  if (ctx.promoStade === 'constater' && ctx.constaterDejaActionne) {
    exclus.add('constater_promo')
  }

  return exclus
}
