export type Role = 'admin' | 'manager' | 'commercial'

export interface Profile {
  id: string
  email: string
  role: Role
  secteur_id: string | null
  manager_id: string | null
  user_id: string | null
}

export interface Magasin {
  id: string
  code: string
  nom: string
  enseigne: string
  taille: string
  adresse: string | null
  secteur_id: string
  contact_nom: string | null
  contact_telephone: string | null
  contact_email: string | null
  surface: number | null
}

export interface Produit {
  id: string
  code: string
  nom: string
  categorie: string | null
  marque?: string | null
  gamme?: string | null
  parfum?: string | null
  format?: string | null
  produit_canonique_id: string | null
  famille: string | null
  segment: string | null
  statut_catalogue: 'permanent' | 'a_qualifier' | 'variante_promo' | 'arrete'
  type_liaison: 'conditionnement_promo' | 'ancien_ean' | 'repackaging' | null
}

export interface PrioriteProduit {
  produit_id: string
  rang: 20 | 50 | 70
}

export const ENSEIGNES = ['Auchan', 'Carrefour', 'Carrefour Market', 'Intermarche', 'Leclerc', 'U'] as const
export type Enseigne = (typeof ENSEIGNES)[number]

export type StatutDisponibilite = 'commandable' | 'non_commandable' | 'arret_industriel' | 'en_attente_referencement'

export type Typologie = string

export interface ProduitEnseigne {
  produit_id: string
  enseigne: string
  typologie: Typologie | null
  statut_disponibilite: StatutDisponibilite
  actif: boolean
}

export interface Promo {
  id: string
  code: string
  enseigne: string
  mecanique: string
  date_installation: string | null
  date_debut_vente: string
  date_constat: string | null
  date_fin_vente?: string | null
  revente_fin?: string | null
  theme?: string | null
  support_op?: string | null
  statut?: string | null
  op_trade?: string | null
  niveau_operation?: string | null
}

export type StatutProduit = 'present' | 'manquant' | 'rupture'

export type RaisonAbsence = 'pas_de_place_rayon' | 'frein_prix' | 'jamais_reference' | 'concurrence_privilegiee' | 'autre'

export interface StatutProduitMagasin {
  magasin_id: string
  produit_id: string
  statut: StatutProduit
  signale_par: string | null
  signale_at: string
  raison_absence: RaisonAbsence | null
}

export type StatutVisite = 'planifie' | 'realise'

export interface Visite {
  id: string
  magasin_id: string
  commercial_id: string
  semaine: string
  jour: string
  statut: StatutVisite
}

export interface PdlMagasin {
  magasin_id: string
  pdl_generale: number | null
  pdl_yaos: number | null
  pdl_siggis: number | null
  pdl_dessert: number | null
  updated_at: string
  updated_by: string | null
}

export interface VmhNational {
  produit_id: string
  vmh_hyper: number | null
  vmh_super: number | null
  dv_hmsm: number | null
  dv_hyper: number | null
  dv_super: number | null
  prix_moyen: number | null
  periode_reference: string | null
  updated_at: string
}

export interface VmhEnseigne {
  produit_id: string
  enseigne: string
  vmh_hyper: number | null
  vmh_super: number | null
  dv_hmsm: number | null
  dv_hyper: number | null
  dv_super: number | null
  prix_moyen: number | null
  periode_reference: string | null
  updated_at: string
}

import type { RaisonsActuelles } from './engine/raison'

export type TypeMission =
  | 'anticiper_promo' | 'revendre_promo' | 'constater_promo'
  | 'referencer_produit' | 'corriger_rupture' | 'securiser_commande'
  | 'suivre_engagement' | 'optimiser_implantation' | 'proposer_test_ht' | 'verifier_information'

export const TYPES_MISSION_PROMO: readonly TypeMission[] = ['anticiper_promo', 'revendre_promo', 'constater_promo']

export type StatutOpportunite =
  | 'detectee' | 'a_preparer' | 'presentee' | 'accord_obtenu' | 'en_attente'
  | 'refusee' | 'commandee' | 'mise_en_place' | 'a_constater' | 'reussie' | 'abandonnee'

export type NiveauPrioriteOpportunite = 'P1' | 'P2' | 'P3'
export type Confiance = 'donnees_confirmees' | 'recommandation_probable' | 'information_a_verifier'

export interface Opportunite {
  id: string
  magasin_id: string
  produit_canonique_id: string
  type_mission: TypeMission
  promo_id: string | null
  statut: StatutOpportunite
  niveau_priorite: NiveauPrioriteOpportunite | null
  score: number | null
  confiance: Confiance | null
  raisons_actuelles: RaisonsActuelles | null
  score_calcule_at: string | null
  fingerprint: string | null
  version_moteur: string | null
  cycle: number
  derniere_reouverture_at: string | null
  cree_at: string
  cloture_at: string | null
  prochaine_action_at: string | null
}

export type TypeEvenementOpportunite =
  | 'creation' | 'recalcul_score' | 'changement_statut' | 'preuve_ajoutee'
  | 'preuve_retiree' | 'reouverture' | 'presentee' | 'decision' | 'commentaire' | 'cloture'

export interface OpportuniteEvenement {
  id: string
  opportunite_id: string
  type: TypeEvenementOpportunite
  visite_id: string | null
  score_a_ce_moment: number | null
  raisons: RaisonsActuelles | null
  statut_avant: string | null
  statut_apres: string | null
  raison_refus: string | null
  commentaire: string | null
  cree_par: string | null
  cree_at: string
}

export interface OpportunitePromoPreuve {
  opportunite_id: string
  promo_id: string
  ajoute_at: string
}

export interface StatutProduitMagasinHistorique {
  id: string
  magasin_id: string
  produit_id: string
  statut: StatutProduit
  raison_absence: RaisonAbsence | null
  visite_id: string | null
  signale_par: string | null
  signale_at: string
}
