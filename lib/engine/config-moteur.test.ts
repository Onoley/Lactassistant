import { describe, expect, it, vi, afterEach } from 'vitest'
import { CONFIG_MOTEUR_DEFAUT, moteurActif } from './config-moteur'

describe('config-moteur', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('expose les poids et seuils par défaut validés dans la spec', () => {
    expect(CONFIG_MOTEUR_DEFAUT.seuilRecurrenceRuptures).toBe(2)
    expect(CONFIG_MOTEUR_DEFAUT.fenetreRecurrenceJours).toBe(60)
    expect(CONFIG_MOTEUR_DEFAUT.cooldownRefusJours).toBe(30)
    expect(CONFIG_MOTEUR_DEFAUT.penaliteReouvertureApresRefus).toBe(-25)
    expect(CONFIG_MOTEUR_DEFAUT.score.urgenceMax).toBe(40)
    expect(CONFIG_MOTEUR_DEFAUT.score.impactMax).toBe(25)
    expect(CONFIG_MOTEUR_DEFAUT.score.pertinenceMax).toBe(20)
    expect(CONFIG_MOTEUR_DEFAUT.score.faisabiliteMax).toBe(15)
  })

  it('moteurActif() lit MOTEUR_OPPORTUNITES_ACTIF, activé par défaut', () => {
    vi.stubEnv('MOTEUR_OPPORTUNITES_ACTIF', undefined as unknown as string)
    expect(moteurActif()).toBe(true)
  })

  it('moteurActif() retourne false quand explicitement désactivé', () => {
    vi.stubEnv('MOTEUR_OPPORTUNITES_ACTIF', 'false')
    expect(moteurActif()).toBe(false)
  })
})
