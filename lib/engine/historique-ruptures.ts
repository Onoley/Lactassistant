import type { StatutProduitMagasinHistorique } from '@/lib/types'
import type { ConfigMoteur } from './config-moteur'

export function compterRupturesRecurrentes(
  historique: StatutProduitMagasinHistorique[],
  aujourdHui: Date,
  config: ConfigMoteur
): { nombre: number; recurrente: boolean } {
  const limite = new Date(aujourdHui)
  limite.setDate(limite.getDate() - config.fenetreRecurrenceJours)

  const nombre = historique.filter(h => h.statut === 'rupture' && new Date(h.signale_at) >= limite).length

  return { nombre, recurrente: nombre >= config.seuilRecurrenceRuptures }
}
