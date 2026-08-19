import { describe, expect, it } from 'vitest'
import { detecterSignaux, type ContexteDetection } from './detecteurs'
import { CONFIG_MOTEUR_DEFAUT } from './config-moteur'
import type { Magasin, Produit, Promo, Opportunite } from '@/lib/types'

const magasin: Magasin = { id: 'm1', code: 'M1', nom: 'Test', enseigne: 'Carrefour', taille: 'hyper', adresse: null, secteur_id: 's1', contact_nom: null, contact_telephone: null, contact_email: null, surface: null }
const produit: Produit = { id: 'p1', code: 'EAN1', nom: 'Produit Test', categorie: null, produit_canonique_id: null, famille: null, segment: null, statut_catalogue: 'permanent', type_liaison: null }

function promo(overrides: Partial<Promo> = {}): Promo {
  return { id: 'promo1', code: 'PR1', enseigne: 'Carrefour', mecanique: 'ODR', date_installation: null, date_debut_vente: '2026-08-20', date_constat: null, date_fin_vente: null, op_trade: null, ...overrides }
}

function ctx(overrides: Partial<ContexteDetection> = {}): ContexteDetection {
  return {
    magasin, produit,
    statutProduitMagasin: 'manquant',
    promosApplicables: [],
    opportunitesExistantes: [],
    rangTop: null,
    historiqueRuptures: [],
    aujourdHui: new Date('2026-08-19'),
    ...overrides,
  }
}

describe('detecterSignaux', () => {
  it('promo au stade constater produit un signal constater_promo P1', () => {
    const signaux = detecterSignaux(ctx({ promosApplicables: [promo({ date_debut_vente: '2026-07-01', date_fin_vente: '2026-08-10' })] }), CONFIG_MOTEUR_DEFAUT)
    const signal = signaux.find(s => s.typeMission === 'constater_promo')
    expect(signal).toBeDefined()
    expect(signal!.niveauDeclenche).toBe('P1')
    expect(signal!.promoId).toBe('promo1')
  })

  it('permanent manquant + promo à J-14 produit un signal referencer_produit citant la promo en preuve', () => {
    const signaux = detecterSignaux(ctx({ promosApplicables: [promo({ date_installation: '2026-09-02', date_debut_vente: '2026-09-05' })] }), CONFIG_MOTEUR_DEFAUT)
    const signal = signaux.find(s => s.typeMission === 'referencer_produit')
    expect(signal).toBeDefined()
    expect(signal!.promoId).toBeNull()
    expect(signal!.sourceType).toBe('promo')
    expect(signal!.sourceId).toBe('promo1')
    expect(signal!.niveauDeclenche).toBe('P1')
  })

  it('produit présent n\'émet aucun signal referencer_produit même avec promo proche', () => {
    const signaux = detecterSignaux(ctx({ statutProduitMagasin: 'present', promosApplicables: [promo({ date_installation: '2026-09-02', date_debut_vente: '2026-09-05' })] }), CONFIG_MOTEUR_DEFAUT)
    expect(signaux.find(s => s.typeMission === 'referencer_produit')).toBeUndefined()
  })

  it('engagement échu produit un signal suivre_engagement P1', () => {
    const opp: Opportunite = {
      id: 'o1', magasin_id: 'm1', produit_canonique_id: 'p1', type_mission: 'referencer_produit', promo_id: null,
      statut: 'accord_obtenu', niveau_priorite: 'P1', score: 80, confiance: 'donnees_confirmees', raisons_actuelles: null,
      score_calcule_at: null, fingerprint: null, version_moteur: null, cycle: 1, derniere_reouverture_at: null,
      cree_at: '2026-08-01', cloture_at: null, prochaine_action_at: '2026-08-15',
    }
    const signaux = detecterSignaux(ctx({ opportunitesExistantes: [opp] }), CONFIG_MOTEUR_DEFAUT)
    const signal = signaux.find(s => s.typeMission === 'suivre_engagement')
    expect(signal).toBeDefined()
    expect(signal!.niveauDeclenche).toBe('P1')
  })

  it('rupture récurrente sur Top 20 produit un signal corriger_rupture P1', () => {
    const historique = [
      { id: 'h1', magasin_id: 'm1', produit_id: 'p1', statut: 'rupture' as const, raison_absence: null, visite_id: 'v1', signale_par: null, signale_at: '2026-08-01' },
      { id: 'h2', magasin_id: 'm1', produit_id: 'p1', statut: 'rupture' as const, raison_absence: null, visite_id: 'v2', signale_par: null, signale_at: '2026-08-10' },
    ]
    const signaux = detecterSignaux(ctx({ rangTop: 20, historiqueRuptures: historique }), CONFIG_MOTEUR_DEFAUT)
    const signal = signaux.find(s => s.typeMission === 'corriger_rupture')
    expect(signal).toBeDefined()
    expect(signal!.niveauDeclenche).toBe('P1')
  })

  it('ope_trade produit un signal P1 quel que soit le stade', () => {
    const signaux = detecterSignaux(ctx({ promosApplicables: [promo({ date_debut_vente: '2026-10-01', op_trade: 'oui' })] }), CONFIG_MOTEUR_DEFAUT)
    expect(signaux.some(s => s.codeSignal === 'ope_trade' && s.niveauDeclenche === 'P1')).toBe(true)
  })

  it('ope_trade au stade revendre produit securiser_commande avec promoId null (type structurel)', () => {
    const signaux = detecterSignaux(ctx({ promosApplicables: [promo({ date_installation: '2026-08-01', date_debut_vente: '2026-09-01', op_trade: 'oui' })] }), CONFIG_MOTEUR_DEFAUT)
    const signal = signaux.find(s => s.codeSignal === 'ope_trade')
    expect(signal).toBeDefined()
    expect(signal!.typeMission).toBe('securiser_commande')
    expect(signal!.promoId).toBeNull()
  })

  it('engagement échu sur une opportunité promo n\'hérite pas du promo_id (suivre_engagement est structurel)', () => {
    const opp: Opportunite = {
      id: 'o1', magasin_id: 'm1', produit_canonique_id: 'p1', type_mission: 'revendre_promo', promo_id: 'promoX',
      statut: 'accord_obtenu', niveau_priorite: 'P1', score: 80, confiance: 'donnees_confirmees', raisons_actuelles: null,
      score_calcule_at: null, fingerprint: null, version_moteur: null, cycle: 1, derniere_reouverture_at: null,
      cree_at: '2026-08-01', cloture_at: null, prochaine_action_at: '2026-08-15',
    }
    const signaux = detecterSignaux(ctx({ opportunitesExistantes: [opp] }), CONFIG_MOTEUR_DEFAUT)
    const signal = signaux.find(s => s.typeMission === 'suivre_engagement')
    expect(signal).toBeDefined()
    expect(signal!.promoId).toBeNull()
  })
})
