import type { Magasin, Produit, Promo, Opportunite, StatutProduit, StatutProduitMagasinHistorique, TypeMission } from '@/lib/types'
import { TYPES_MISSION_PROMO } from '@/lib/types'
import { stadePromo } from './stade-promo'
import { compterRupturesRecurrentes } from './historique-ruptures'
import type { ConfigMoteur } from './config-moteur'
import type { SignalDetecte } from './signal'

export interface ContexteDetection {
  magasin: Magasin
  produit: Produit
  statutProduitMagasin: StatutProduit
  promosApplicables: Promo[]
  opportunitesExistantes: Opportunite[]
  rangTop: 20 | 50 | 70 | null
  historiqueRuptures: StatutProduitMagasinHistorique[]
  aujourdHui: Date
}

function joursEntre(dateIso: string, aujourdHui: Date): number {
  return Math.ceil((new Date(dateIso).getTime() - aujourdHui.getTime()) / 86_400_000)
}

export function detecterSignaux(ctx: ContexteDetection, config: ConfigMoteur): SignalDetecte[] {
  const signaux: SignalDetecte[] = []
  const manquant = ctx.statutProduitMagasin === 'manquant' || ctx.statutProduitMagasin === 'rupture'

  for (const promo of ctx.promosApplicables) {
    const stade = stadePromo(promo, ctx.aujourdHui)

    if (stade === 'constater') {
      signaux.push({
        typeMission: 'constater_promo', promoId: promo.id, niveauDeclenche: 'P1',
        codeSignal: 'promo_a_constater', sourceType: 'promo', sourceId: promo.id,
        observedAt: ctx.aujourdHui.toISOString(), expiresAt: null, force: 40,
        donneesArgumentaire: { mecanique: promo.mecanique, dateFinVente: promo.date_fin_vente },
      })
    }

    if (stade === 'revendre') {
      signaux.push({
        typeMission: 'revendre_promo', promoId: promo.id, niveauDeclenche: 'P1',
        codeSignal: 'promo_a_revendre', sourceType: 'promo', sourceId: promo.id,
        observedAt: ctx.aujourdHui.toISOString(), expiresAt: promo.date_debut_vente, force: 35,
        donneesArgumentaire: { mecanique: promo.mecanique, dateDebutVente: promo.date_debut_vente },
      })
    }

    if (stade === 'anticiper' && manquant) {
      const jalon = promo.date_installation ?? promo.date_debut_vente
      const jours = joursEntre(jalon, ctx.aujourdHui)
      if (jours <= 28) {
        signaux.push({
          typeMission: 'referencer_produit', promoId: null, niveauDeclenche: jours <= 14 ? 'P1' : 'P2',
          codeSignal: 'permanent_manquant_promo_proche', sourceType: 'promo', sourceId: promo.id,
          observedAt: ctx.aujourdHui.toISOString(), expiresAt: jalon, force: jours <= 14 ? 35 : 25,
          donneesArgumentaire: { mecanique: promo.mecanique, jours },
        })
      }
    }

    if (promo.op_trade) {
      const typeMissionOpTrade: TypeMission = stade === 'constater' ? 'constater_promo' : stade === 'controler' || stade === 'revendre' ? 'securiser_commande' : 'anticiper_promo'
      signaux.push({
        typeMission: typeMissionOpTrade,
        promoId: TYPES_MISSION_PROMO.includes(typeMissionOpTrade) ? promo.id : null,
        niveauDeclenche: 'P1', codeSignal: 'ope_trade', sourceType: 'promo', sourceId: promo.id,
        observedAt: ctx.aujourdHui.toISOString(), expiresAt: promo.date_debut_vente, force: 40,
        donneesArgumentaire: { mecanique: promo.mecanique, opTrade: promo.op_trade },
      })
    }
  }

  for (const opp of ctx.opportunitesExistantes) {
    if (opp.prochaine_action_at && (opp.statut === 'accord_obtenu' || opp.statut === 'commandee')) {
      const echu = new Date(opp.prochaine_action_at) <= ctx.aujourdHui
      if (echu) {
        signaux.push({
          typeMission: 'suivre_engagement', promoId: null, niveauDeclenche: 'P1',
          codeSignal: 'engagement_echu', sourceType: 'engagement', sourceId: opp.id,
          observedAt: ctx.aujourdHui.toISOString(), expiresAt: null, force: 35,
          donneesArgumentaire: { prochaineActionAt: opp.prochaine_action_at, statutPrecedent: opp.statut },
        })
      }
    }
  }

  const recurrence = compterRupturesRecurrentes(ctx.historiqueRuptures, ctx.aujourdHui, config)
  if (recurrence.recurrente) {
    signaux.push({
      typeMission: 'corriger_rupture', promoId: null, niveauDeclenche: ctx.rangTop === 20 ? 'P1' : 'P2',
      codeSignal: 'rupture_recurrente', sourceType: 'historique_rupture', sourceId: `${ctx.magasin.id}:${ctx.produit.id}`,
      observedAt: ctx.aujourdHui.toISOString(), expiresAt: null, force: 25,
      donneesArgumentaire: { nombreRuptures: recurrence.nombre, fenetreJours: config.fenetreRecurrenceJours },
    })
  }

  return signaux
}
