import { describe, expect, it } from 'vitest'
import { prioritesSemaine } from './priorites'
import type { Magasin, Produit, ProduitEnseigne, Promo, StatutProduitMagasin } from '@/lib/types'

function magasin(id: string, overrides: Partial<Magasin> = {}): Magasin {
  return { id, code: id, nom: `Magasin ${id}`, enseigne: 'Carrefour', taille: 'super', adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null, ...overrides }
}

const yaourt: Produit = { id: 'p1', code: 'P1', nom: 'Yaourt', categorie: null }
const fromage: Produit = { id: 'p2', code: 'P2', nom: 'Fromage', categorie: null }
const produitsParId = new Map<string, Produit>([['p1', yaourt], ['p2', fromage]])

function promo(overrides: Partial<Promo> = {}): Promo {
  return { id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%', date_installation: null, date_debut_vente: '2026-08-20', date_constat: null, ...overrides }
}

describe('prioritesSemaine', () => {
  it('ignore un Top 20 sans promo ni rupture (aucune donnée de rang ne lui est même fournie)', () => {
    const mag = magasin('1')
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
    ]
    const result = prioritesSemaine([mag], statuts, produitsParId, [], new Map())
    expect(result).toHaveLength(0)
  })

  it('une rupture sans promo associée apparaît avec un niveau cette_semaine minimum', () => {
    const mag = magasin('1')
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'rupture', signale_par: null, signale_at: '' },
    ]
    const result = prioritesSemaine([mag], statuts, produitsParId, [], new Map(), new Date('2026-08-17'))
    expect(result).toHaveLength(1)
    expect(result[0].niveau).toBe('cette_semaine')
    expect(result[0].raison).toBe('Rupture signalée — aucune promo en cours.')
  })

  it('une promo OP Trade sur un produit manquant déclenche un niveau urgent', () => {
    const mag = magasin('1')
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
    ]
    const promoOpTrade = promo({ op_trade: 'OP LAITIERS', date_installation: '2026-12-01', date_debut_vente: '2026-12-10' })
    const promosParProduitId = new Map<string, Promo[]>([['p1', [promoOpTrade]]])
    const result = prioritesSemaine([mag], statuts, produitsParId, [], promosParProduitId, new Date('2026-08-17'))
    expect(result).toHaveLength(1)
    expect(result[0].niveau).toBe('urgent')
  })

  it('une promo OP Trade sur un produit déjà présent déclenche quand même une entrée, niveau urgent', () => {
    const mag = magasin('1')
    // Aucun statut explicite pour p1 dans ce magasin : implicitement "present".
    const promoOpTrade = promo({ op_trade: 'OP LAITIERS', date_installation: '2026-07-01', date_debut_vente: '2026-07-10', date_fin_vente: '2026-09-30' })
    const promosParProduitId = new Map<string, Promo[]>([['p1', [promoOpTrade]]])
    const result = prioritesSemaine([mag], [], produitsParId, [], promosParProduitId, new Date('2026-08-17'))
    expect(result).toHaveLength(1)
    expect(result[0].niveau).toBe('urgent')
    expect(result[0].stadePromo).toBe('controler')
  })

  it("stade constater : absent si la promo n'est pas OP Trade et que le produit est present", () => {
    const mag = magasin('1')
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'present', signale_par: null, signale_at: '' },
    ]
    const promoTerminee = promo({ date_installation: '2026-06-01', date_debut_vente: '2026-06-10', date_fin_vente: '2026-06-30' })
    const promosParProduitId = new Map<string, Promo[]>([['p1', [promoTerminee]]])
    const result = prioritesSemaine([mag], statuts, produitsParId, [], promosParProduitId, new Date('2026-08-17'))
    expect(result).toHaveLength(0)
  })

  it('stade constater : présent si le produit est toujours manquant, avec le message dédié', () => {
    const mag = magasin('1')
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
    ]
    const promoTerminee = promo({ date_installation: '2026-06-01', date_debut_vente: '2026-06-10', date_fin_vente: '2026-06-30' })
    const promosParProduitId = new Map<string, Promo[]>([['p1', [promoTerminee]]])
    const result = prioritesSemaine([mag], statuts, produitsParId, [], promosParProduitId, new Date('2026-08-17'))
    expect(result).toHaveLength(1)
    expect(result[0].raison).toBe('Promo terminée le 2026-06-30 — produit toujours manquant, à négocier.')
  })

  it("applique le statut_disponibilite de produits_enseigne pour verrouiller l'action recommandée", () => {
    const mag = magasin('1')
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'rupture', signale_par: null, signale_at: '' },
    ]
    const produitsEnseigne: ProduitEnseigne[] = [
      { produit_id: 'p1', enseigne: 'Carrefour', typologie: null, statut_disponibilite: 'arret_industriel' },
    ]
    const result = prioritesSemaine([mag], statuts, produitsParId, produitsEnseigne, new Map(), new Date('2026-08-17'))
    expect(result).toHaveLength(1)
    expect(result[0].actionRecommandee).toBe('aucune_action_commande')
  })

  it("signale l'échéance dépassée plutôt que 'dans 0 jour(s)' pour une promo sans date_fin_vente restée en controler bien après le début de vente", () => {
    const mag = magasin('1')
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'manquant', signale_par: null, signale_at: '' },
    ]
    const promoSansFin = promo({ date_installation: '2026-05-20', date_debut_vente: '2026-06-01', date_fin_vente: null })
    const promosParProduitId = new Map<string, Promo[]>([['p1', [promoSansFin]]])
    const result = prioritesSemaine([mag], statuts, produitsParId, [], promosParProduitId, new Date('2026-08-17'))
    expect(result).toHaveLength(1)
    expect(result[0].stadePromo).toBe('controler')
    expect(result[0].raison).toContain('échéance dépassée')
    expect(result[0].raison).not.toContain('dans 0 jour')
  })

  it('produit une entrée distincte par magasin', () => {
    const magA = magasin('1', { secteur_id: 'a' })
    const magB = magasin('2', { secteur_id: 'b' })
    const statuts: StatutProduitMagasin[] = [
      { magasin_id: '1', produit_id: 'p1', statut: 'rupture', signale_par: null, signale_at: '' },
      { magasin_id: '2', produit_id: 'p2', statut: 'rupture', signale_par: null, signale_at: '' },
    ]
    const result = prioritesSemaine([magA, magB], statuts, produitsParId, [], new Map(), new Date('2026-08-17'))
    expect(result).toHaveLength(2)
    expect(result.map(r => r.magasin.id).sort()).toEqual(['1', '2'])
  })
})
