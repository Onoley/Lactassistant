import type { PlanDeVenteImport } from './mappers'

export interface DiffEnseigne {
  enseigne: string
  references: number
  ajouts: number
  misesAJour: number
  retraits: number
  eanInconnus: string[]
  doublons: string[]
}

export interface LigneAssortimentAAppliquer {
  produit_id: string
  enseigne: string
  typologie: string | null
}

export function calculerDiffPlanDeVente(
  lignes: PlanDeVenteImport[],
  enseigne: string,
  produitIdParEan: Map<string, string>,
  assortimentActuel: { produit_id: string; typologie: string | null; actif: boolean }[]
): { resume: DiffEnseigne; aActiver: LigneAssortimentAAppliquer[]; aDesactiverProduitIds: string[] } {
  const eanInconnus: string[] = []
  const doublons: string[] = []
  const vus = new Set<string>()
  const parProduitId = new Map<string, LigneAssortimentAAppliquer>()

  for (const ligne of lignes) {
    if (vus.has(ligne.ean)) {
      doublons.push(ligne.ean)
      continue
    }
    vus.add(ligne.ean)
    const produitId = produitIdParEan.get(ligne.ean)
    if (!produitId) {
      eanInconnus.push(ligne.ean)
      continue
    }
    parProduitId.set(produitId, { produit_id: produitId, enseigne, typologie: ligne.typologie })
  }

  const actuelParProduitId = new Map(assortimentActuel.map(a => [a.produit_id, a]))
  let ajouts = 0
  let misesAJour = 0
  const aActiver: LigneAssortimentAAppliquer[] = []

  for (const [produitId, cible] of parProduitId) {
    const actuel = actuelParProduitId.get(produitId)
    if (!actuel || !actuel.actif) {
      ajouts++
      aActiver.push(cible)
    } else if (actuel.typologie !== cible.typologie) {
      misesAJour++
      aActiver.push(cible)
    }
    // sinon : identique, rien à faire (idempotence)
  }

  const aDesactiverProduitIds = assortimentActuel
    .filter(a => a.actif && !parProduitId.has(a.produit_id))
    .map(a => a.produit_id)

  return {
    resume: {
      enseigne,
      references: parProduitId.size,
      ajouts,
      misesAJour,
      retraits: aDesactiverProduitIds.length,
      eanInconnus,
      doublons,
    },
    aActiver,
    aDesactiverProduitIds,
  }
}
