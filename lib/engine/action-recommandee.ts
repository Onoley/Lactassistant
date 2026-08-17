import type { StadePromo } from './stade-promo'
import type { StatutDisponibilite, StatutProduit } from '@/lib/types'

export type ActionRecommandee =
  | 'faire_entrer'
  | 'securiser_commande'
  | 'preparer_implantation'
  | 'verifier_participation'
  | 'tester'
  | 'preparer_dossier_referencement'
  | 'aucune_action_commande'

export function actionRecommandee(
  statutDisponibilite: StatutDisponibilite,
  stadePromo: StadePromo | null,
  statutProduitMagasin: StatutProduit
): ActionRecommandee {
  if (statutDisponibilite === 'non_commandable' || statutDisponibilite === 'arret_industriel') {
    return 'aucune_action_commande'
  }
  if (statutDisponibilite === 'en_attente_referencement') {
    return 'preparer_dossier_referencement'
  }

  const manque = statutProduitMagasin === 'manquant' || statutProduitMagasin === 'rupture'

  if (stadePromo === 'anticiper') return manque ? 'faire_entrer' : 'preparer_implantation'
  if (stadePromo === 'revendre') return 'securiser_commande'
  if (stadePromo === 'controler') return 'verifier_participation'
  if (stadePromo === 'constater') return manque ? 'verifier_participation' : 'aucune_action_commande'

  return manque ? 'faire_entrer' : 'tester'
}
