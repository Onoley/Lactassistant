export interface ConfigMoteurScore {
  urgenceMax: number
  impactMax: number
  pertinenceMax: number
  faisabiliteMax: number
}

export interface ConfigMoteur {
  version: string
  seuilRecurrenceRuptures: number
  fenetreRecurrenceJours: number
  cooldownRefusJours: number
  penaliteReouvertureApresRefus: number
  score: ConfigMoteurScore
}

// Valeurs par défaut validées dans la spec (§4.2, §5, §6) — isolées ici pour
// rester testables et modifiables sans toucher à la logique du pipeline.
// Édition admin hors scope de ce sous-projet (spec §9).
export const CONFIG_MOTEUR_DEFAUT: ConfigMoteur = {
  version: '1',
  seuilRecurrenceRuptures: 2,
  fenetreRecurrenceJours: 60,
  cooldownRefusJours: 30,
  penaliteReouvertureApresRefus: -25,
  score: { urgenceMax: 40, impactMax: 25, pertinenceMax: 20, faisabiliteMax: 15 },
}

// Shadow mode (spec §12.7) : indicateur d'activation lu depuis l'environnement,
// jamais depuis une suppression de données — désactiver n'efface rien.
export function moteurActif(): boolean {
  return process.env.MOTEUR_OPPORTUNITES_ACTIF !== 'false'
}
