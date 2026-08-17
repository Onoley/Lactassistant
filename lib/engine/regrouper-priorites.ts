import type { PrioriteHebdo, NiveauPriorite } from './priorites'
import type { Magasin, Produit, Promo } from '@/lib/types'

export interface GroupePriorite {
  cle: string
  magasin: Magasin
  niveau: NiveauPriorite
  promo: Promo | null
  raison: string
  produits: Produit[]
}

// prioritesSemaine ne produit qu'une entrée par (magasin, produit), donc
// regrouper par (magasin, promo) ne perd jamais de produit — ça fusionne
// juste l'affichage de plusieurs produits sous la même promo. Une rupture
// (promo null) reste un bloc par produit : rien à regrouper avec elle.
export function regrouperParPromo(priorites: PrioriteHebdo[]): GroupePriorite[] {
  const groupes = new Map<string, GroupePriorite>()
  for (const p of priorites) {
    const cle = p.promo ? `${p.magasin.id}:${p.promo.id}` : `${p.magasin.id}:rupture:${p.produit.id}`
    const existant = groupes.get(cle)
    if (existant) {
      existant.produits.push(p.produit)
    } else {
      groupes.set(cle, { cle, magasin: p.magasin, niveau: p.niveau, promo: p.promo, raison: p.raison, produits: [p.produit] })
    }
  }
  return Array.from(groupes.values())
}
