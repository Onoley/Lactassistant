import type { TypeMission } from '@/lib/types'

export type SourceSignal = 'promo' | 'statut' | 'engagement' | 'vmh' | 'top' | 'typologie' | 'comparable' | 'historique_rupture'

// Convention preuve vs identité (lue par l'orchestrateur, Task 14) :
// - un signal dont la promo est la PREUVE d'une mission dont l'identité n'est
//   pas la promo elle-même (ex. permanent manquant + promo proche justifiant
//   l'urgence, mission `referencer_produit`) porte `promoId: null` et
//   `sourceType: 'promo'` / `sourceId: <promo.id>` — ce couple alimente
//   `opportunite_promos_preuves`.
// - un signal dont la promo EST l'identité de la mission (`anticiper_promo`,
//   `revendre_promo`, `constater_promo`) porte `promoId` non nul.
export interface SignalDetecte {
  typeMission: TypeMission
  promoId: string | null
  niveauDeclenche: 'P1' | 'P2' | 'P3'
  codeSignal: string
  sourceType: SourceSignal
  sourceId: string
  observedAt: string
  expiresAt: string | null
  force: number
  donneesArgumentaire: Record<string, unknown>
}
