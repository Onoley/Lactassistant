import { describe, expect, it } from 'vitest'
import { compterRupturesRecurrentes } from './historique-ruptures'
import { CONFIG_MOTEUR_DEFAUT } from './config-moteur'
import type { StatutProduitMagasinHistorique } from '@/lib/types'

function releve(statut: 'present' | 'manquant' | 'rupture', joursAvant: number, visiteId: string | null): StatutProduitMagasinHistorique {
  const date = new Date('2026-08-19T00:00:00.000Z')
  date.setDate(date.getDate() - joursAvant)
  return { id: `r-${joursAvant}-${visiteId}`, magasin_id: 'm1', produit_id: 'p1', statut, raison_absence: null, visite_id: visiteId, signale_par: null, signale_at: date.toISOString() }
}

describe('compterRupturesRecurrentes', () => {
  it('deux ruptures sur deux visites distinctes en 60 jours = récurrente', () => {
    const historique = [releve('rupture', 10, 'v1'), releve('rupture', 40, 'v2')]
    const resultat = compterRupturesRecurrentes(historique, new Date('2026-08-19'), CONFIG_MOTEUR_DEFAUT)
    expect(resultat.nombre).toBe(2)
    expect(resultat.recurrente).toBe(true)
  })

  it('une seule rupture ne déclenche jamais la récurrence', () => {
    const historique = [releve('rupture', 10, 'v1')]
    const resultat = compterRupturesRecurrentes(historique, new Date('2026-08-19'), CONFIG_MOTEUR_DEFAUT)
    expect(resultat.recurrente).toBe(false)
  })

  it('ignore les ruptures hors fenêtre de 60 jours', () => {
    const historique = [releve('rupture', 10, 'v1'), releve('rupture', 90, 'v2')]
    const resultat = compterRupturesRecurrentes(historique, new Date('2026-08-19'), CONFIG_MOTEUR_DEFAUT)
    expect(resultat.nombre).toBe(1)
    expect(resultat.recurrente).toBe(false)
  })

  it('ignore les relevés qui ne sont pas des ruptures', () => {
    const historique = [releve('rupture', 10, 'v1'), releve('present', 20, 'v2')]
    const resultat = compterRupturesRecurrentes(historique, new Date('2026-08-19'), CONFIG_MOTEUR_DEFAUT)
    expect(resultat.nombre).toBe(1)
  })
})
