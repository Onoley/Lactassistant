import { describe, expect, it } from 'vitest'
import { actionRecommandee } from './action-recommandee'
import type { StadePromo } from './stade-promo'
import type { StatutDisponibilite, StatutProduit } from '@/lib/types'

const TOUS_STADES: Array<StadePromo | null> = [null, 'anticiper', 'revendre', 'controler', 'constater']
const TOUS_STATUTS: StatutProduit[] = ['present', 'manquant', 'rupture']

describe('actionRecommandee', () => {
  it('ne recommande jamais de valeur de commande quand le statut est non_commandable ou arret_industriel', () => {
    const statutsVerrouilles: StatutDisponibilite[] = ['non_commandable', 'arret_industriel']
    for (const statutDisponibilite of statutsVerrouilles) {
      for (const stade of TOUS_STADES) {
        for (const statutProduitMagasin of TOUS_STATUTS) {
          expect(actionRecommandee(statutDisponibilite, stade, statutProduitMagasin)).toBe('aucune_action_commande')
        }
      }
    }
  })

  it('recommande toujours de préparer le dossier de référencement quand en_attente_referencement', () => {
    for (const stade of TOUS_STADES) {
      for (const statutProduitMagasin of TOUS_STATUTS) {
        expect(actionRecommandee('en_attente_referencement', stade, statutProduitMagasin)).toBe('preparer_dossier_referencement')
      }
    }
  })

  it('anticiper + manquant → faire_entrer, si commandable', () => {
    expect(actionRecommandee('commandable', 'anticiper', 'manquant')).toBe('faire_entrer')
  })

  it('revendre → securiser_commande, si commandable', () => {
    expect(actionRecommandee('commandable', 'revendre', 'present')).toBe('securiser_commande')
  })

  it('controler → verifier_participation, si commandable', () => {
    expect(actionRecommandee('commandable', 'controler', 'present')).toBe('verifier_participation')
  })

  it('pas de promo mais présent → tester, si commandable', () => {
    expect(actionRecommandee('commandable', null, 'present')).toBe('tester')
  })

  it('constater + toujours manquant → verifier_participation, si commandable', () => {
    expect(actionRecommandee('commandable', 'constater', 'manquant')).toBe('verifier_participation')
  })

  it('constater + present → aucune_action_commande, si commandable (rien à négocier)', () => {
    expect(actionRecommandee('commandable', 'constater', 'present')).toBe('aucune_action_commande')
  })
})
