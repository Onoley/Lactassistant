import { describe, expect, it } from 'vitest'
import { produitATravailler } from './produit-a-travailler'
import type { Magasin, Produit, Promo, StatutProduit, VmhNational } from '@/lib/types'

function magasin(overrides: Partial<Magasin> = {}): Magasin {
  return { id: '1', code: '1', nom: 'Magasin Test', enseigne: 'Carrefour', taille: 'hyper', adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null, ...overrides }
}

const produit: Produit = { id: 'p1', code: 'P1', nom: 'Yaourt Nature', categorie: null }

describe('produitATravailler', () => {
  it("n'affiche jamais d'action de commande pour un produit non commandable, meme obligatoire", () => {
    const result = produitATravailler(
      magasin(), produit, 20, 'obligatoire', 'manquant', null, 'arret_industriel',
      [], new Map(), [], null, 'les_deux', null
    )
    expect(result.actionRecommandee).toBe('aucune_action_commande')
    expect(result.argumentaire).toContain('non commandable')
    expect(result.argumentaire).not.toContain('obligatoire')
  })

  it("ouvre l'argumentaire par le rappel de conformité pour un produit obligatoire commandable", () => {
    const result = produitATravailler(
      magasin(), produit, 20, 'obligatoire', 'manquant', null, 'commandable',
      [], new Map(), [], null, 'les_deux', null
    )
    expect(result.argumentaire).toContain('Référencement obligatoire chez Carrefour')
  })

  it("n'ouvre pas par le rappel de conformité pour un produit picking", () => {
    const result = produitATravailler(
      magasin(), produit, 20, 'picking', 'manquant', null, 'commandable',
      [], new Map(), [], null, 'les_deux', null
    )
    expect(result.argumentaire).not.toContain('obligatoire')
  })

  it('intègre le VMH national quand disponible, scopé au format hyper', () => {
    const vmh: VmhNational = { produit_id: 'p1', vmh_hyper: 9.2, vmh_super: 3.6, dv_hmsm: 41.5, dv_hyper: 59.7, dv_super: 21.3, prix_moyen: 1.6, periode_reference: null, updated_at: '' }
    const result = produitATravailler(
      magasin({ taille: 'hyper' }), produit, 20, null, 'manquant', null, 'commandable',
      [], new Map(), [], vmh, 'les_deux', null
    )
    expect(result.vmhNational).toEqual({ vmh: 9.2, dv: 59.7 })
    expect(result.argumentaire).toContain('9.2 unités/semaine')
    expect(result.argumentaire).toContain('60 % des hypers')
  })

  it('ne mentionne pas le VMH quand aucune ligne vmh_national pour ce produit', () => {
    const result = produitATravailler(
      magasin(), produit, 20, null, 'manquant', null, 'commandable',
      [], new Map(), [], null, 'les_deux', null
    )
    expect(result.vmhNational).toBeNull()
    expect(result.argumentaire).not.toContain('national')
  })

  it('intègre la raison d\'absence dans l\'argumentaire et les questions de découverte', () => {
    const result = produitATravailler(
      magasin(), produit, 20, null, 'manquant', 'pas_de_place_rayon', 'commandable',
      [], new Map(), [], null, 'les_deux', null
    )
    expect(result.argumentaire).toContain('pas de place en rayon')
    expect(result.questionsDecouverte.length).toBeGreaterThan(0)
    expect(result.questionsDecouverte[0]).toContain('rotation')
  })

  it('utilise des questions génériques quand la raison d\'absence est inconnue', () => {
    const result = produitATravailler(
      magasin(), produit, 20, null, 'manquant', null, 'commandable',
      [], new Map(), [], null, 'les_deux', null
    )
    expect(result.questionsDecouverte.length).toBeGreaterThan(0)
  })

  it('fonctionne sans rang assigné : raisons/comparables vides mais promo et VMH toujours pris en compte', () => {
    const promo: Promo = { id: 'pr1', code: 'PR1', enseigne: 'Carrefour', mecanique: '-20%', date_installation: null, date_debut_vente: '2026-09-01', date_constat: null }
    const result = produitATravailler(
      magasin(), produit, null, null, 'manquant', null, 'commandable',
      [], new Map(), [promo], null, 'les_deux', null
    )
    expect(result.rang).toBeNull()
    expect(result.raisons).toEqual([])
    expect(result.presentsChezComparables).toEqual({ total: 0, presents: 0 })
    expect(result.argumentaire).toContain('-20%')
  })

  it('reporte le niveau hebdomadaire tel quel comme momentum', () => {
    const result = produitATravailler(
      magasin(), produit, 20, null, 'manquant', null, 'commandable',
      [], new Map(), [], null, 'les_deux', 'urgent'
    )
    expect(result.momentum).toBe('urgent')
  })

  it('conclut toujours par l\'action recommandée quand une commande est possible', () => {
    const result = produitATravailler(
      magasin(), produit, 20, null, 'manquant', null, 'commandable',
      [], new Map(), [], null, 'les_deux', null
    )
    expect(result.argumentaire).toMatch(/→ .+, à valider au prochain passage\.$/)
  })

  it('couvre les 5 valeurs de raisonAbsence avec des questions de découverte non vides', () => {
    const raisons: Array<'pas_de_place_rayon' | 'frein_prix' | 'jamais_reference' | 'concurrence_privilegiee' | 'autre'> = [
      'pas_de_place_rayon', 'frein_prix', 'jamais_reference', 'concurrence_privilegiee', 'autre',
    ]
    for (const raison of raisons) {
      const result = produitATravailler(
        magasin(), produit, 20, null, 'manquant', raison, 'commandable',
        [], new Map(), [], null, 'les_deux', null
      )
      expect(result.questionsDecouverte.length).toBeGreaterThan(0)
    }
  })
})
