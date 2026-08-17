import type { Magasin, Produit, Promo, RaisonAbsence, StatutDisponibilite, StatutProduit, Typologie, VmhNational } from '@/lib/types'
import { importanceProduitFiche, promoPrincipale } from './importance-produit'
import type { CritereSimilarite } from './similarity'
import type { Rang } from './scoring'
import { actionRecommandee, type ActionRecommandee } from './action-recommandee'
import type { NiveauPriorite } from './priorites'
import { vmhPertinent } from './vmh'

export interface ProduitATravailler {
  produit: Produit
  rang: 20 | 50 | 70 | null
  typologie: Typologie | null
  raisons: string[]
  presentsChezComparables: { total: number; presents: number }
  vmhNational: { vmh: number | null; dv: number | null } | null
  raisonAbsence: RaisonAbsence | null
  argumentaire: string
  questionsDecouverte: string[]
  actionRecommandee: ActionRecommandee
  momentum: NiveauPriorite | null
  score: number  // usage interne uniquement, jamais affiché tel quel — sert au tri
}

const LIBELLE_RAISON: Record<RaisonAbsence, string> = {
  pas_de_place_rayon: 'pas de place en rayon',
  frein_prix: 'frein prix',
  jamais_reference: 'jamais référencé',
  concurrence_privilegiee: 'concurrence privilégiée',
  autre: 'autre frein',
}

const LIBELLE_ACTION: Record<ActionRecommandee, string> = {
  faire_entrer: 'Faire entrer le produit',
  securiser_commande: 'Sécuriser la commande',
  preparer_implantation: "Préparer l'implantation",
  verifier_participation: "Vérifier la participation à l'opération",
  tester: 'Proposer un test',
  preparer_dossier_referencement: 'Préparer le dossier de référencement',
  aucune_action_commande: 'Aucune action de commande possible',
}

const QUESTIONS_PAR_RAISON: Record<RaisonAbsence, string[]> = {
  pas_de_place_rayon: [
    'Quel produit fait le moins de rotation dans ce rayon actuellement ?',
    'Y a-t-il un rayon secondaire ou une tête de gondole disponible ?',
  ],
  frein_prix: [
    'Quel est le prix psychologique attendu par le client sur ce segment ?',
    'Une opération prix ponctuelle serait-elle envisageable ?',
  ],
  jamais_reference: [
    "Qu'est-ce qui bloque le référencement initial : espace, centrale, autre ?",
    'Le rayon actuel couvre-t-il déjà ce segment via un concurrent ?',
  ],
  concurrence_privilegiee: [
    "Qu'est-ce qui différencie l'offre concurrente actuellement en rayon ?",
    'Un test comparatif sur linéaire serait-il possible ?',
  ],
  autre: ['Quel est le principal frein perçu par le magasin sur ce produit ?'],
}

const QUESTIONS_GENERIQUES = [
  'Ce produit a-t-il déjà été référencé dans ce magasin par le passé ?',
  'Quel est le principal frein perçu par le magasin sur ce produit ?',
]

function questionsDecouverte(raisonAbsence: RaisonAbsence | null): string[] {
  return raisonAbsence ? QUESTIONS_PAR_RAISON[raisonAbsence] : QUESTIONS_GENERIQUES
}

function messagePromo(promo: Promo): string {
  const installation = promo.date_installation ? `installation le ${promo.date_installation}, ` : ''
  const prefixe = promo.op_trade ? '[OP Trade] ' : ''
  return `${prefixe}Promo "${promo.mecanique}" chez ${promo.enseigne} : ${installation}vente le ${promo.date_debut_vente}.`
}

function construireArgumentaire(
  typologie: Typologie | null,
  magasin: Magasin,
  presentsChezComparables: { total: number; presents: number },
  promoInfo: ReturnType<typeof promoPrincipale>,
  vmh: { vmh: number | null; dv: number | null } | null,
  raisonAbsence: RaisonAbsence | null,
  action: ActionRecommandee,
  statutDisponibilite: StatutDisponibilite
): string {
  if (action === 'aucune_action_commande') {
    const raison = statutDisponibilite === 'arret_industriel' ? 'arrêt industriel' : 'déréférencé'
    return `Produit non commandable actuellement (${raison}) — aucune action de commande possible.`
  }

  const phrases: string[] = []
  if (typologie === 'obligatoire') {
    phrases.push(`Référencement obligatoire chez ${magasin.enseigne} — son absence est un écart à signaler en priorité.`)
  }
  if (presentsChezComparables.presents > 0) {
    phrases.push(`Présent dans ${presentsChezComparables.presents} magasin(s) similaire(s) sur ${presentsChezComparables.total}.`)
  }
  if (promoInfo) {
    phrases.push(messagePromo(promoInfo.promo))
  }
  if (vmh && (vmh.vmh !== null || vmh.dv !== null)) {
    const formatLabel = magasin.taille === 'hyper' ? 'hypers' : magasin.taille === 'super' ? 'supers' : 'magasins'
    const parts: string[] = []
    if (vmh.vmh !== null) parts.push(`tourne à ${vmh.vmh.toFixed(1)} unités/semaine en moyenne`)
    if (vmh.dv !== null) parts.push(`est référencé par ${vmh.dv.toFixed(0)} % des ${formatLabel}`)
    if (parts.length > 0) phrases.push(`Au national, ce produit ${parts.join(' et ')}.`)
  }
  if (raisonAbsence) {
    phrases.push(`Frein identifié : ${LIBELLE_RAISON[raisonAbsence]}.`)
  }
  phrases.push(`→ ${LIBELLE_ACTION[action]}, à valider au prochain passage.`)

  return phrases.join(' ')
}

export function produitATravailler(
  magasin: Magasin,
  produit: Produit,
  rang: Rang | null,
  typologie: Typologie | null,
  statutProduitMagasin: StatutProduit,
  raisonAbsence: RaisonAbsence | null,
  statutDisponibilite: StatutDisponibilite,
  magasinsComparables: Magasin[],
  statutsComparables: Map<string, StatutProduit>,
  promosDuProduit: Promo[],
  vmhNational: VmhNational | null,
  critere: CritereSimilarite,
  niveauHebdo: NiveauPriorite | null,
  aujourdHui: Date = new Date()
): ProduitATravailler {
  const promosScoped = promosDuProduit.filter(p => p.enseigne === magasin.enseigne)
  const promoInfo = promoPrincipale(promosScoped, aujourdHui)

  const importance = rang !== null
    ? importanceProduitFiche(magasin, produit, rang, magasinsComparables, statutsComparables, promosDuProduit, critere, aujourdHui)
    : null

  const vmh = vmhPertinent(magasin, vmhNational)
  const action = actionRecommandee(statutDisponibilite, promoInfo?.stade ?? null, statutProduitMagasin)
  const argumentaire = construireArgumentaire(typologie, magasin, importance?.presentsChezComparables ?? { total: 0, presents: 0 }, promoInfo, vmh, raisonAbsence, action, statutDisponibilite)

  return {
    produit,
    rang,
    typologie,
    raisons: importance?.raisons ?? [],
    presentsChezComparables: importance?.presentsChezComparables ?? { total: 0, presents: 0 },
    vmhNational: vmh,
    raisonAbsence,
    argumentaire,
    questionsDecouverte: questionsDecouverte(raisonAbsence),
    actionRecommandee: action,
    momentum: niveauHebdo,
    score: importance?.score ?? 0,
  }
}
