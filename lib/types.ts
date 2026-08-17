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
}

export interface PrioriteProduit {
  produit_id: string
  rang: 20 | 50 | 70
}

export const ENSEIGNES = ['Auchan', 'Carrefour', 'Carrefour Market', 'Intermarche', 'Leclerc', 'U'] as const
export type Enseigne = (typeof ENSEIGNES)[number]

export type StatutDisponibilite = 'commandable' | 'non_commandable' | 'arret_industriel' | 'en_attente_referencement'

export type Typologie = 'obligatoire' | 'picking'

export interface ProduitEnseigne {
  produit_id: string
  enseigne: string
  typologie: Typologie | null
  statut_disponibilite: StatutDisponibilite
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
