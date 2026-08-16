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
}

export interface Produit {
  id: string
  code: string
  nom: string
  categorie: string | null
}

export interface PrioriteProduit {
  produit_id: string
  rang: 20 | 50 | 70
}

export interface Promo {
  id: string
  code: string
  enseigne: string
  mecanique: string
  date_installation: string
  date_debut_vente: string
  date_constat: string
}

export type StatutProduit = 'present' | 'manquant' | 'rupture'

export interface StatutProduitMagasin {
  magasin_id: string
  produit_id: string
  statut: StatutProduit
  signale_par: string | null
  signale_at: string
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
