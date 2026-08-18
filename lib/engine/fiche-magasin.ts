import { createServerClient } from '@/lib/supabase/server'
import { produitATravailler, type ProduitATravailler } from './produit-a-travailler'
import { prioritesSemaine, resoudreCanonique } from './priorites'
import type { CritereSimilarite } from './similarity'
import type { Produit, ProduitEnseigne, Promo, RaisonAbsence, StatutProduit, StatutProduitMagasin, Typologie, VmhEnseigne, VmhNational } from '@/lib/types'

export function comparerProduitsATravailler(a: ProduitATravailler, b: ProduitATravailler): number {
  return b.score - a.score
}

// Un produit "manquant à travailler" doit aussi être dans l'assortiment actif
// de l'enseigne du magasin — sinon un statut orphelin (produit retiré du plan
// de vente depuis) fait apparaître une carte non éditable pour un produit qui
// ne devrait plus être suivi du tout.
export function estProduitManquantATravailler(
  produitId: string,
  statutParProduit: Map<string, StatutProduitMagasin>,
  produitEnseigneParProduit: Map<string, ProduitEnseigne>
): boolean {
  if (!produitEnseigneParProduit.has(produitId)) return false
  const s = statutParProduit.get(produitId)?.statut
  return s === 'manquant' || s === 'rupture'
}

export async function chargerProduitsATravailler(
  magasinId: string,
  critere: CritereSimilarite = 'les_deux'
): Promise<ProduitATravailler[]> {
  const supabase = createServerClient()
  const { data: magasin } = await supabase.from('magasins').select('*').eq('id', magasinId).single()
  if (!magasin) return []

  const [{ data: produits }, { data: statuts }, { data: priorites }, { data: produitsEnseigne }] = await Promise.all([
    supabase.from('produits').select('*'),
    supabase.from('statuts_produit_magasin').select('*').eq('magasin_id', magasinId),
    supabase.from('priorites_produits').select('*'),
    supabase.from('produits_enseigne').select('*').eq('enseigne', magasin.enseigne).eq('actif', true),
  ])

  const produitsParId = new Map((produits ?? []).map(p => [p.id, p as Produit]))
  const prioriteParProduit = new Map((priorites ?? []).map(p => [p.produit_id, p]))
  const produitEnseigneParProduit = new Map((produitsEnseigne ?? []).map(pe => [pe.produit_id, pe]))
  const statutParProduit = new Map((statuts ?? []).map(s => [resoudreCanonique(s.produit_id, produitsParId), s]))
  const manquants = (produits ?? []).filter(p => estProduitManquantATravailler(p.id, statutParProduit, produitEnseigneParProduit))
  if (manquants.length === 0) return []

  // Comparaison "magasins comparables" limitée au secteur du magasin consulté
  // (pas au parc national) — RLS autorise déjà un commercial/manager à lire
  // les autres magasins et statuts de son propre secteur, pas besoin du
  // client admin ici.
  const [{ data: magasinsSecteur }] = await Promise.all([
    supabase.from('magasins').select('*').eq('secteur_id', magasin.secteur_id),
  ])
  const { data: statutsSecteur } = await supabase
    .from('statuts_produit_magasin')
    .select('*')
    .in('magasin_id', (magasinsSecteur ?? []).map(m => m.id))
    .in('produit_id', manquants.map(p => p.id))
  const { data: promoLiens } = await supabase
    .from('promo_produits')
    .select('produit_id, promos(*)')
    .in('produit_id', manquants.map(p => p.id))
  const { data: vmhLignes } = await supabase
    .from('vmh_national')
    .select('*')
    .in('produit_id', manquants.map(p => p.id))
  const { data: vmhEnseigneLignes } = await supabase
    .from('vmh_enseigne')
    .select('*')
    .eq('enseigne', magasin.enseigne)
    .in('produit_id', manquants.map(p => p.id))

  const promosParProduit = new Map<string, Promo[]>()
  for (const lien of promoLiens ?? []) {
    const idEffectif = resoudreCanonique(lien.produit_id, produitsParId)
    const liste = promosParProduit.get(idEffectif) ?? []
    liste.push(lien.promos as unknown as Promo)
    promosParProduit.set(idEffectif, liste)
  }
  const vmhParProduit = new Map((vmhLignes ?? []).map(v => [v.produit_id, v as VmhNational]))
  const vmhEnseigneParProduit = new Map((vmhEnseigneLignes ?? []).map(v => [v.produit_id, v as VmhEnseigne]))

  // Momentum : le niveau hebdomadaire de ce magasin, si ce produit y figure.
  const prioritesHebdoMagasin = prioritesSemaine(
    [magasin], statuts ?? [], produitsParId, produitsEnseigne ?? [], promosParProduit
  )
  const niveauParProduit = new Map(prioritesHebdoMagasin.map(p => [p.produit.id, p.niveau]))

  return manquants
    .map(produit => {
      const priorite = prioriteParProduit.get(produit.id)
      const statut = statutParProduit.get(produit.id)!
      const produitEnseigne = produitEnseigneParProduit.get(produit.id)

      const statutsPourCeProduit = new Map<string, StatutProduit>(
        (statutsSecteur ?? [])
          .filter(s => resoudreCanonique(s.produit_id, produitsParId) === produit.id)
          .map(s => [s.magasin_id, s.statut as StatutProduit])
      )

      return produitATravailler(
        magasin,
        produit,
        (priorite?.rang as 20 | 50 | 70 | undefined) ?? null,
        (produitEnseigne?.typologie as Typologie | null) ?? null,
        statut.statut,
        (statut.raison_absence as RaisonAbsence | null) ?? null,
        produitEnseigne?.statut_disponibilite ?? 'commandable',
        magasinsSecteur ?? [],
        statutsPourCeProduit,
        promosParProduit.get(produit.id) ?? [],
        vmhParProduit.get(produit.id) ?? null,
        vmhEnseigneParProduit.get(produit.id) ?? null,
        critere,
        niveauParProduit.get(produit.id) ?? null
      )
    })
    .sort(comparerProduitsATravailler)
}
