import { describe, expect, it, vi } from 'vitest'
import { estDeclencheurReel, rattacherOpportunites } from './rattachement'
import { CONFIG_MOTEUR_DEFAUT } from './config-moteur'
import type { SignalDetecte } from './signal'
import type { Opportunite, Magasin, Produit, Promo } from '@/lib/types'

function signal(overrides: Partial<SignalDetecte>): SignalDetecte {
  return {
    typeMission: 'referencer_produit', promoId: null, niveauDeclenche: 'P2',
    codeSignal: 'x', sourceType: 'vmh', sourceId: 's1',
    observedAt: '2026-08-19T00:00:00.000Z', expiresAt: null, force: 10,
    donneesArgumentaire: {}, ...overrides,
  }
}

const magasin: Magasin = { id: 'm1', code: 'M1', nom: 'T', enseigne: 'Carrefour', taille: 'hyper', adresse: null, secteur_id: 's1', contact_nom: null, contact_telephone: null, contact_email: null, surface: null }
const produit: Produit = { id: 'p1', code: 'E1', nom: 'P', categorie: null, produit_canonique_id: null, famille: null, segment: null, statut_catalogue: 'permanent', type_liaison: null }

function ctxVide(overrides: Record<string, unknown> = {}) {
  return {
    magasin, produit, statutProduitMagasin: 'manquant', promosApplicables: [], opportunitesExistantes: [],
    rangTop: null, historiqueRuptures: [], aujourdHui: new Date('2026-08-19'),
    statutDisponibilite: 'commandable', ...overrides,
  }
}

describe('estDeclencheurReel', () => {
  it('un signal VMH/comparable/Top seul n\'est jamais un déclencheur réel', () => {
    expect(estDeclencheurReel([signal({ sourceType: 'vmh' }), signal({ sourceType: 'comparable' }), signal({ sourceType: 'top' })], null)).toBe(false)
  })

  it('une promo entrant dans sa fenêtre d\'action est un déclencheur réel', () => {
    expect(estDeclencheurReel([signal({ sourceType: 'promo', codeSignal: 'promo_a_revendre' })], null)).toBe(true)
  })

  it('une rupture nouvellement observée est un déclencheur réel', () => {
    expect(estDeclencheurReel([signal({ sourceType: 'historique_rupture' })], null)).toBe(true)
  })

  it('un engagement échu est un déclencheur réel', () => {
    expect(estDeclencheurReel([signal({ sourceType: 'engagement' })], null)).toBe(true)
  })

  it('aucune opportunité existante = toujours un déclencheur réel (création)', () => {
    expect(estDeclencheurReel([], null)).toBe(true)
  })
})

describe('rattacherOpportunites', () => {
  it('sans aucun signal détecté, ne rattache rien et n\'appelle jamais le RPC', async () => {
    const rpc = vi.fn()
    const admin = { rpc } as unknown as Parameters<typeof rattacherOpportunites>[0]
    const resultats = await rattacherOpportunites(admin, ctxVide() as never, CONFIG_MOTEUR_DEFAUT, null)
    expect(resultats).toEqual([])
    expect(rpc).not.toHaveBeenCalled()
  })

  it('deux missions distinctes sur le même produit produisent deux appels RPC séparés, pas un seul', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'o1', statut: 'detectee' }, error: null })
    const admin = { rpc } as unknown as Parameters<typeof rattacherOpportunites>[0]
    // Une promo au stade "revendre" (référencer_produit ne s'applique pas ici,
    // manquant=false) + un engagement échu sur une opportunité totalement
    // différente : deux groupes (typeMission, promoId) distincts.
    const promo: Promo = { id: 'promoA', code: 'PA', enseigne: 'Carrefour', mecanique: 'ODR', date_installation: '2026-08-01', date_debut_vente: '2026-09-01', date_constat: null, date_fin_vente: null, op_trade: null }
    const oppExistante: Opportunite = {
      id: 'o0', magasin_id: 'm1', produit_canonique_id: 'p1', type_mission: 'securiser_commande', promo_id: null,
      statut: 'accord_obtenu', niveau_priorite: 'P1', score: 70, confiance: 'donnees_confirmees', raisons_actuelles: null,
      score_calcule_at: null, fingerprint: null, version_moteur: null, cycle: 1, derniere_reouverture_at: null,
      cree_at: '2026-08-01', cloture_at: null, prochaine_action_at: '2026-08-15',
    }

    const resultats = await rattacherOpportunites(admin, ctxVide({
      statutProduitMagasin: 'present', promosApplicables: [promo], opportunitesExistantes: [oppExistante],
    }) as never, CONFIG_MOTEUR_DEFAUT, null)

    expect(resultats.length).toBe(2)
    expect(rpc).toHaveBeenCalledTimes(2)
    const typesAppeles = rpc.mock.calls.map(c => (c[1] as { p_type_mission: string }).p_type_mission).sort()
    expect(typesAppeles).toEqual(['revendre_promo', 'suivre_engagement'])
  })
})
