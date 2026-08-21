import type { SupabaseClient } from '@supabase/supabase-js'
import type { Opportunite, StatutDisponibilite } from '@/lib/types'
import { detecterSignaux, type ContexteDetection } from './detecteurs'
import { typesExclus } from './exclusion'
import { classifierNiveau } from './classification'
import { calculerScoreOpportunite } from './scoring'
import { determinerConfiance } from './confiance'
import { calculerFingerprint } from './fingerprint'
import { RaisonsActuellesSchema, type RaisonsActuelles } from './raison'
import { stadePromo } from './stade-promo'
import type { ConfigMoteur } from './config-moteur'
import type { SignalDetecte, SourceSignal } from './signal'

// Sources qui, seules, ne justifient jamais une réouverture après refus
// (spec §5) — un changement de score/VMH/comparables/Top n'est jamais un
// déclencheur réel à lui seul.
const SOURCES_JAMAIS_SEULES_DECLENCHEUR: SourceSignal[] = ['vmh', 'comparable', 'top']

export function estDeclencheurReel(signaux: SignalDetecte[], opportuniteExistante: Opportunite | null): boolean {
  if (signaux.length === 0) return !opportuniteExistante
  return signaux.some(s => !SOURCES_JAMAIS_SEULES_DECLENCHEUR.includes(s.sourceType))
}

export type ContexteRattachement = ContexteDetection & { statutDisponibilite: StatutDisponibilite }

export interface ResultatRattachement {
  opportunite: Opportunite
  opportuniteVerification: Opportunite | null
}

function cleGroupe(typeMission: string, promoId: string | null): string {
  return `${typeMission}:${promoId ?? ''}`
}

async function rattacherUnGroupe(
  admin: SupabaseClient,
  ctx: ContexteRattachement,
  groupeSignaux: SignalDetecte[],
  config: ConfigMoteur,
  visiteId: string | null
): Promise<ResultatRattachement> {
  const identite = groupeSignaux[0]

  // Preuves complémentaires : toute autre promo applicable à ce produit,
  // hormis celle qui porte l'identité de ce groupe (le cas échéant) — dérivé
  // directement du contexte plutôt que des signaux, pour couvrir une
  // campagne future qui n'a encore déclenché aucun signal elle-même
  // (validé section 1 : « campagne B citée en preuve pour la campagne A »).
  const preuvesPromoIds = [...new Set(
    ctx.promosApplicables.map(p => p.id).filter(id => id !== identite.promoId)
  )]

  const { niveau } = classifierNiveau(groupeSignaux)!

  const opportuniteExistante = ctx.opportunitesExistantes.find(
    o => o.type_mission === identite.typeMission && o.promo_id === identite.promoId
  ) ?? null
  const declencheurReel = estDeclencheurReel(groupeSignaux, opportuniteExistante)

  const penalite = opportuniteExistante?.statut === 'refusee' && declencheurReel ? config.penaliteReouvertureApresRefus : 0
  const accordDejaObtenu = opportuniteExistante?.statut === 'accord_obtenu' || opportuniteExistante?.statut === 'commandee'
  const score = calculerScoreOpportunite(groupeSignaux, { rangTop: ctx.rangTop, accordDejaObtenu }, penalite, config)
  const { confiance, contradiction } = determinerConfiance(groupeSignaux)

  const raisons: RaisonsActuelles = {
    version: 1,
    raisons: groupeSignaux.map(s => ({
      version: 1, codeSignal: s.codeSignal, source: { type: s.sourceType, id: s.sourceId },
      observedAt: s.observedAt, fraicheur: 'fraiche', contributionScore: s.force,
      niveauDeclenche: s.niveauDeclenche, texteCommercial: s.codeSignal,
    })),
  }
  RaisonsActuellesSchema.parse(raisons)

  const confianceFinale = contradiction ? 'information_a_verifier' : confiance
  const fingerprint = calculerFingerprint({
    niveauPriorite: niveau, score, confiance: confianceFinale, raisons, statut: opportuniteExistante?.statut ?? 'detectee',
  })

  const { data, error } = await admin.rpc('rattacher_opportunite', {
    p_magasin_id: ctx.magasin.id,
    p_produit_canonique_id: ctx.produit.id,
    p_type_mission: identite.typeMission,
    p_promo_id: identite.promoId,
    p_niveau_priorite: niveau,
    p_score: score,
    p_confiance: confianceFinale,
    p_raisons: raisons,
    p_fingerprint: fingerprint,
    p_version_moteur: config.version,
    p_declencheur_reel: declencheurReel,
    p_preuves_promo_ids: preuvesPromoIds,
    p_visite_id: visiteId,
  })
  if (error) throw error

  let opportuniteVerification: Opportunite | null = null
  if (contradiction) {
    const raisonsVerif: RaisonsActuelles = { version: 1, raisons: raisons.raisons }
    const { data: dataVerif, error: errorVerif } = await admin.rpc('rattacher_opportunite', {
      p_magasin_id: ctx.magasin.id,
      p_produit_canonique_id: ctx.produit.id,
      p_type_mission: 'verifier_information',
      p_promo_id: null,
      p_niveau_priorite: niveau,
      p_score: score,
      p_confiance: 'information_a_verifier',
      p_raisons: raisonsVerif,
      p_fingerprint: calculerFingerprint({ niveauPriorite: niveau, score, confiance: 'information_a_verifier', raisons: raisonsVerif, statut: 'detectee' }),
      p_version_moteur: config.version,
      p_declencheur_reel: true,
      p_preuves_promo_ids: [],
      p_visite_id: visiteId,
    })
    if (errorVerif) throw errorVerif
    opportuniteVerification = dataVerif as Opportunite
  }

  return { opportunite: data as Opportunite, opportuniteVerification }
}

export async function rattacherOpportunites(
  admin: SupabaseClient,
  ctx: ContexteRattachement,
  config: ConfigMoteur,
  visiteId: string | null = null
): Promise<ResultatRattachement[]> {
  const signaux = detecterSignaux(ctx, config)
  if (signaux.length === 0) return []

  const promoPrincipale = ctx.promosApplicables[0]
  const exclus = typesExclus({
    statutDisponibilite: ctx.statutDisponibilite,
    statutCatalogue: ctx.produit.statut_catalogue,
    statutProduitMagasin: ctx.statutProduitMagasin,
    promoStade: promoPrincipale ? stadePromo(promoPrincipale, ctx.aujourdHui) : null,
    constaterDejaActionne: ctx.opportunitesExistantes.some(o => o.type_mission === 'constater_promo' && o.statut === 'reussie'),
  })

  const signauxRetenus = signaux.filter(s => !exclus.has(s.typeMission))
  if (signauxRetenus.length === 0) return []

  const groupes = new Map<string, SignalDetecte[]>()
  for (const s of signauxRetenus) {
    const cle = cleGroupe(s.typeMission, s.promoId)
    const liste = groupes.get(cle) ?? []
    liste.push(s)
    groupes.set(cle, liste)
  }

  const resultats: ResultatRattachement[] = []
  for (const groupeSignaux of groupes.values()) {
    resultats.push(await rattacherUnGroupe(admin, ctx, groupeSignaux, config, visiteId))
  }
  return resultats
}
