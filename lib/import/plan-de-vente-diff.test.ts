import { describe, expect, it } from 'vitest'
import { calculerDiffPlanDeVente } from './plan-de-vente-diff'
import type { PlanDeVenteImport } from './mappers'

describe('calculerDiffPlanDeVente', () => {
  const produitIdParEan = new Map([['111', 'p1'], ['222', 'p2'], ['333', 'p3']])

  it('compte ajout, mise à jour de typologie et retrait', () => {
    const lignes: PlanDeVenteImport[] = [
      { ean: '111', nom: 'A', famille: null, segment: null, typologie: 'T1' },
      { ean: '222', nom: 'B', famille: null, segment: null, typologie: 'T2' },
    ]
    const assortimentActuel = [
      { produit_id: 'p2', typologie: 'T1', actif: true },
      { produit_id: 'p3', typologie: null, actif: true },
    ]
    const { resume, aActiver, aDesactiverProduitIds } = calculerDiffPlanDeVente(lignes, 'Carrefour', produitIdParEan, assortimentActuel)

    expect(resume).toEqual({ enseigne: 'Carrefour', references: 2, ajouts: 1, misesAJour: 1, retraits: 1, eanInconnus: [], doublons: [] })
    expect(aActiver).toEqual(expect.arrayContaining([
      { produit_id: 'p1', enseigne: 'Carrefour', typologie: 'T1' },
      { produit_id: 'p2', enseigne: 'Carrefour', typologie: 'T2' },
    ]))
    expect(aDesactiverProduitIds).toEqual(['p3'])
  })

  it('signale un EAN du classeur introuvable dans produits, sans bloquer le reste', () => {
    const lignes: PlanDeVenteImport[] = [
      { ean: '999', nom: 'Inconnu', famille: null, segment: null, typologie: null },
      { ean: '111', nom: 'A', famille: null, segment: null, typologie: null },
    ]
    const { resume, aActiver } = calculerDiffPlanDeVente(lignes, 'Carrefour', produitIdParEan, [])
    expect(resume.eanInconnus).toEqual(['999'])
    expect(aActiver).toEqual([{ produit_id: 'p1', enseigne: 'Carrefour', typologie: null }])
  })

  it('signale un EAN dupliqué dans le classeur, ne le compte qu\'une fois', () => {
    const lignes: PlanDeVenteImport[] = [
      { ean: '111', nom: 'A', famille: null, segment: null, typologie: 'T1' },
      { ean: '111', nom: 'A', famille: null, segment: null, typologie: 'T2' },
    ]
    const { resume, aActiver } = calculerDiffPlanDeVente(lignes, 'Carrefour', produitIdParEan, [])
    expect(resume.doublons).toEqual(['111'])
    expect(aActiver).toHaveLength(1)
  })

  it('ré-import identique : 0 ajout, 0 mise à jour, 0 retrait (idempotence)', () => {
    const lignes: PlanDeVenteImport[] = [{ ean: '111', nom: 'A', famille: null, segment: null, typologie: 'T1' }]
    const assortimentActuel = [{ produit_id: 'p1', typologie: 'T1', actif: true }]
    const { resume } = calculerDiffPlanDeVente(lignes, 'Carrefour', produitIdParEan, assortimentActuel)
    expect(resume).toMatchObject({ ajouts: 0, misesAJour: 0, retraits: 0 })
  })

  it('réactive un produit précédemment désactivé', () => {
    const lignes: PlanDeVenteImport[] = [{ ean: '111', nom: 'A', famille: null, segment: null, typologie: 'T1' }]
    const assortimentActuel = [{ produit_id: 'p1', typologie: 'T1', actif: false }]
    const { resume, aActiver } = calculerDiffPlanDeVente(lignes, 'Carrefour', produitIdParEan, assortimentActuel)
    expect(resume.ajouts).toBe(1)
    expect(aActiver).toEqual([{ produit_id: 'p1', enseigne: 'Carrefour', typologie: 'T1' }])
  })
})
