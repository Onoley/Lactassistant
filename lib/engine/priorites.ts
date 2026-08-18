import type { Magasin, Produit, ProduitEnseigne, Promo, StatutDisponibilite, StatutProduit, StatutProduitMagasin } from '@/lib/types'
import { actionRecommandee, type ActionRecommandee } from './action-recommandee'
import { stadePromo, type StadePromo } from './stade-promo'

export type NiveauPriorite = 'urgent' | 'cette_semaine' | 'a_anticiper'

export interface PrioriteHebdo {
  magasin: Magasin
  produit: Produit
  niveau: NiveauPriorite
  raison: string
  stadePromo: StadePromo | null
  promo: Promo | null
  actionRecommandee: ActionRecommandee
}

const ORDRE_NIVEAU: Record<NiveauPriorite, number> = { a_anticiper: 1, cette_semaine: 2, urgent: 3 }

// Un produit_id issu de promo_produits ou statuts_produit_magasin peut être
// une variante d'emballage promo (EAN distinct du produit réel en rayon) —
// résout vers le produit canonique quand un lien existe, sinon no-op.
export function resoudreCanonique(produitId: string, produitsParId: Map<string, Produit>): string {
  return produitsParId.get(produitId)?.produit_canonique_id ?? produitId
}

function jalonsFuturs(promo: Promo, aujourdHui: Date): number[] {
  return [promo.date_installation, promo.date_debut_vente, promo.date_fin_vente]
    .filter((d): d is string => Boolean(d))
    .map(d => Math.ceil((new Date(d).getTime() - aujourdHui.getTime()) / 86_400_000))
    .filter(j => j >= 0)
}

function joursAvantEcheance(promo: Promo, aujourdHui: Date): number {
  const futurs = jalonsFuturs(promo, aujourdHui)
  // Tous les jalons connus sont passés (stade constater, ou controler sans
  // date_fin_vente connue) : traité comme urgent pour le niveau, mais le
  // message doit dire "échéance dépassée", pas "dans 0 jour(s)".
  return futurs.length > 0 ? Math.min(...futurs) : 0
}

function niveauDepuisJours(jours: number): NiveauPriorite {
  if (jours <= 7) return 'urgent'
  if (jours <= 14) return 'cette_semaine'
  return 'a_anticiper'
}

// Jours avant le prochain jalon "à venir" (installation ou vente) — exclut
// délibérément date_fin_vente : une fois l'installation et la vente passées
// (stade controler ou constater), il n'y a plus de compte à rebours
// pertinent pour le niveau, qu'il reste 2 jours ou 2 mois avant la fin.
function joursAvantProchainJalonPrincipal(promo: Promo, aujourdHui: Date): number | null {
  const jalons = [promo.date_installation, promo.date_debut_vente]
    .filter((d): d is string => Boolean(d))
    .map(d => Math.ceil((new Date(d).getTime() - aujourdHui.getTime()) / 86_400_000))
    .filter(j => j >= 0)
  return jalons.length > 0 ? Math.min(...jalons) : null
}

function raisonPromo(promo: Promo, stade: StadePromo, jours: number, opTrade: boolean, statutProduitMagasin: StatutProduit, aujourdHui: Date): string {
  if (stade === 'constater') {
    const dateFin = promo.date_fin_vente ?? promo.date_debut_vente
    if (opTrade) return `Opération Trade "${promo.mecanique}" terminée le ${dateFin} — à constater (présence, stock, prix).`
    const encoreManquant = statutProduitMagasin === 'manquant' || statutProduitMagasin === 'rupture'
    return encoreManquant
      ? `Promo terminée le ${dateFin} — produit toujours manquant, à négocier.`
      : `Promo terminée le ${dateFin}.`
  }
  const prefixe = opTrade ? 'Promo OP Trade' : 'Promo'
  const jalon = stade === 'anticiper'
    ? (promo.date_installation
        ? `installation le ${promo.date_installation}`
        : `vente le ${promo.date_debut_vente}`)
    : `vente le ${promo.date_debut_vente}`
  const enRetard = jalonsFuturs(promo, aujourdHui).length === 0
  const echeance = enRetard ? 'échéance dépassée' : `dans ${jours} jour(s)`
  return `${prefixe} "${promo.mecanique}" chez ${promo.enseigne} : ${jalon}, ${echeance}.`
}

interface Candidat {
  niveau: NiveauPriorite
  jours: number
  promo: Promo | null
  stade: StadePromo | null
  raison: string
}

function candidatsPourProduit(statutProduitMagasin: StatutProduit, promosApplicables: Promo[], aujourdHui: Date): Candidat[] {
  const candidats: Candidat[] = []
  const enRupture = statutProduitMagasin === 'rupture'
  const manquant = statutProduitMagasin === 'manquant' || enRupture

  if (enRupture) {
    candidats.push({
      niveau: 'cette_semaine',
      jours: Infinity,
      promo: null,
      stade: null,
      raison: promosApplicables.length === 0 ? 'Rupture signalée — aucune promo en cours.' : 'Rupture signalée.',
    })
  }

  for (const promo of promosApplicables) {
    const opTrade = Boolean(promo.op_trade)
    // Rupture/manquant + promo classique : déclenche. Promo OP Trade : déclenche
    // toujours, présent compris. Aucune autre combinaison ne déclenche.
    if (!opTrade && !manquant) continue
    const stade = stadePromo(promo, aujourdHui)
    const jours = joursAvantEcheance(promo, aujourdHui)
    const joursJalonPrincipal = joursAvantProchainJalonPrincipal(promo, aujourdHui)
    // Tant qu'il reste un jalon à venir (installation ou vente), le niveau
    // suit les mêmes seuils que n'importe quelle promo — une OP Trade encore
    // loin dans le temps ne noie plus la liste en "urgent" par défaut. Une
    // fois ces deux jalons passés (controler ou constater), il n'y a plus de
    // compte à rebours pertinent : seule une OP Trade reste urgente
    // indéfiniment, une promo classique redescend à cette_semaine.
    const niveau: NiveauPriorite = joursJalonPrincipal !== null
      ? niveauDepuisJours(joursJalonPrincipal)
      : (opTrade ? 'urgent' : 'cette_semaine')
    candidats.push({ niveau, jours, promo, stade, raison: raisonPromo(promo, stade, jours, opTrade, statutProduitMagasin, aujourdHui) })
  }

  return candidats
}

function meilleurCandidat(candidats: Candidat[]): Candidat | null {
  if (candidats.length === 0) return null
  return candidats.reduce((meilleur, c) => {
    if (ORDRE_NIVEAU[c.niveau] > ORDRE_NIVEAU[meilleur.niveau]) return c
    if (ORDRE_NIVEAU[c.niveau] < ORDRE_NIVEAU[meilleur.niveau]) return meilleur
    return c.jours < meilleur.jours ? c : meilleur
  })
}

interface ResultatInterne {
  hebdo: PrioriteHebdo
  jours: number
}

export function prioritesSemaine(
  magasins: Magasin[],
  statuts: StatutProduitMagasin[],
  produitsParId: Map<string, Produit>,
  produitsEnseigne: ProduitEnseigne[],
  promosParProduitId: Map<string, Promo[]>,
  aujourdHui: Date = new Date()
): PrioriteHebdo[] {
  const statutDispoParProduitEtEnseigne = new Map<string, StatutDisponibilite>()
  for (const pe of produitsEnseigne) {
    statutDispoParProduitEtEnseigne.set(`${pe.produit_id}:${pe.enseigne}`, pe.statut_disponibilite)
  }

  const statutParMagasinEtProduit = new Map<string, Map<string, StatutProduit>>()
  for (const s of statuts) {
    const idEffectif = resoudreCanonique(s.produit_id, produitsParId)
    if (!statutParMagasinEtProduit.has(s.magasin_id)) statutParMagasinEtProduit.set(s.magasin_id, new Map())
    statutParMagasinEtProduit.get(s.magasin_id)!.set(idEffectif, s.statut)
  }

  // promosParProduitId peut encore référencer l'EAN d'une variante promo (pas
  // encore résolu par l'appelant) — fusionne vers le produit canonique ici
  // aussi, en plus de la résolution faite en amont (Step 3/6 des appelants) :
  // no-op idempotent si déjà résolu, donc sans risque de double comptage.
  const promosParProduitIdResolu = new Map<string, Promo[]>()
  for (const [produitId, promos] of promosParProduitId) {
    const idEffectif = resoudreCanonique(produitId, produitsParId)
    const liste = promosParProduitIdResolu.get(idEffectif) ?? []
    liste.push(...promos)
    promosParProduitIdResolu.set(idEffectif, liste)
  }

  const resultats: ResultatInterne[] = []

  for (const magasin of magasins) {
    const statutsMagasin = statutParMagasinEtProduit.get(magasin.id) ?? new Map<string, StatutProduit>()

    // Produits à évaluer pour ce magasin : ceux avec un statut explicite +
    // ceux avec une promo OP Trade dans l'enseigne du magasin (même sans
    // statut, donc implicitement présents) — une Opé Trade se suit même
    // quand le produit est déjà en rayon.
    const produitIds = new Set<string>(statutsMagasin.keys())
    for (const [produitId, promos] of promosParProduitIdResolu) {
      if (promos.some(p => p.enseigne === magasin.enseigne && p.op_trade)) produitIds.add(produitId)
    }

    for (const produitId of produitIds) {
      const produit = produitsParId.get(produitId)
      if (!produit) continue
      const statutProduitMagasin = statutsMagasin.get(produitId) ?? 'present'
      const promosApplicables = (promosParProduitIdResolu.get(produitId) ?? []).filter(p => p.enseigne === magasin.enseigne)

      const meilleur = meilleurCandidat(candidatsPourProduit(statutProduitMagasin, promosApplicables, aujourdHui))
      if (!meilleur) continue

      const statutDisponibilite = statutDispoParProduitEtEnseigne.get(`${produitId}:${magasin.enseigne}`) ?? 'commandable'

      resultats.push({
        hebdo: {
          magasin,
          produit,
          niveau: meilleur.niveau,
          raison: meilleur.raison,
          stadePromo: meilleur.stade,
          promo: meilleur.promo,
          actionRecommandee: actionRecommandee(statutDisponibilite, meilleur.stade, statutProduitMagasin),
        },
        jours: meilleur.jours,
      })
    }
  }

  // Tri par niveau, puis par jours ascendant au sein d'un même niveau — sans
  // ça, /semaine .slice(0, 15) coupe arbitrairement selon l'ordre de boucle
  // plutôt que par échéance réelle. `jours` reste interne : pas exposé sur
  // PrioriteHebdo, aucun consommateur n'en a besoin.
  return resultats
    .sort((a, b) => {
      const diffNiveau = ORDRE_NIVEAU[b.hebdo.niveau] - ORDRE_NIVEAU[a.hebdo.niveau]
      return diffNiveau !== 0 ? diffNiveau : a.jours - b.jours
    })
    .map(r => r.hebdo)
}
