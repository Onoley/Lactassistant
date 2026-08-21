import type { SupabaseClient } from '@supabase/supabase-js'
import { moteurActif, CONFIG_MOTEUR_DEFAUT } from './config-moteur'
import { rattacherOpportunites, type ContexteRattachement } from './rattachement'
import type { Magasin, Produit, StatutProduit } from '@/lib/types'

// Point d'entrée unique appelé par les Server Actions qui modifient statuts,
// promos ou assortiment (spec §12.5). Best-effort et silencieux en shadow
// mode : une erreur du moteur ne doit jamais faire échouer l'action métier
// qui l'a déclenché.
export async function executerPipelinePourProduit(
  admin: SupabaseClient,
  magasinId: string,
  produitCanoniqueId: string,
  visiteId: string | null = null
): Promise<void> {
  if (!moteurActif()) return

  try {
    const [{ data: magasin }, { data: produit }, { data: statuts }, { data: produitsEnseigne }, { data: promoLiens }, { data: opportunites }, { data: priorite }, { data: historique }] = await Promise.all([
      admin.from('magasins').select('*').eq('id', magasinId).single(),
      admin.from('produits').select('*').eq('id', produitCanoniqueId).single(),
      admin.from('statuts_produit_magasin').select('*').eq('magasin_id', magasinId).eq('produit_id', produitCanoniqueId).maybeSingle(),
      admin.from('produits_enseigne').select('*').eq('produit_id', produitCanoniqueId),
      admin.from('promo_produits').select('promo_id, promos(*)').eq('produit_id', produitCanoniqueId),
      admin.from('opportunites').select('*').eq('magasin_id', magasinId).eq('produit_canonique_id', produitCanoniqueId),
      admin.from('priorites_produits').select('rang').eq('produit_id', produitCanoniqueId).maybeSingle(),
      admin.from('statuts_produit_magasin_historique').select('*').eq('magasin_id', magasinId).eq('produit_id', produitCanoniqueId),
    ])
    if (!magasin || !produit) return

    const produitEnseigne = (produitsEnseigne ?? []).find((pe: { enseigne: string }) => pe.enseigne === magasin.enseigne)
    const promosApplicables = (promoLiens ?? [])
      .map((l: { promos: unknown }) => l.promos)
      .filter((p: unknown): p is { enseigne: string } => Boolean(p) && (p as { enseigne: string }).enseigne === magasin.enseigne)

    const ctx: ContexteRattachement = {
      magasin: magasin as Magasin,
      produit: produit as Produit,
      statutProduitMagasin: (statuts?.statut as StatutProduit) ?? 'present',
      promosApplicables: promosApplicables as ContexteRattachement['promosApplicables'],
      opportunitesExistantes: (opportunites ?? []) as ContexteRattachement['opportunitesExistantes'],
      rangTop: (priorite?.rang as 20 | 50 | 70 | undefined) ?? null,
      historiqueRuptures: (historique ?? []) as ContexteRattachement['historiqueRuptures'],
      aujourdHui: new Date(),
      statutDisponibilite: produitEnseigne?.statut_disponibilite ?? 'commandable',
    }

    await rattacherOpportunites(admin, ctx, CONFIG_MOTEUR_DEFAUT, visiteId)
  } catch (err) {
    // Shadow mode : le moteur ne doit jamais casser l'action métier qui l'a
    // déclenché. Erreur avalée volontairement, pas de retry ici.
    console.error('executerPipelinePourProduit a échoué', err)
  }
}
