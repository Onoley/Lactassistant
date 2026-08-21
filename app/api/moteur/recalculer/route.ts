import { createAdminClient } from '@/lib/supabase/admin'
import { executerPipelinePourProduit } from '@/lib/engine/executer-pipeline'
import { resoudreCanonique } from '@/lib/engine/priorites'
import type { Produit } from '@/lib/types'

// Point d'entrée pour un déclenchement externe planifié (spec §12.5) : couvre
// les engagements arrivés à échéance, les transitions de fenêtre promo, et
// le rattrapage import/modification promo + changement d'assortiment
// délibérément non câblés en synchrone (Task 15). Protégé par un secret
// partagé — aucun mécanisme de tâche planifiée n'existe encore dans ce
// projet ; le déclenchement (cron externe, Vercel Cron, ou appel manuel
// admin) reste une décision d'infrastructure hors code, à câbler séparément.
// Le fingerprint (Task 13) rend un balayage large sans danger : toute paire
// inchangée n'écrit rien.
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.MOTEUR_RECALCUL_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = createAdminClient()
  const aujourdHui = new Date().toISOString().slice(0, 10)
  const paires = new Set<string>()

  // Opportunités déjà connues, encore ouvertes.
  const { data: ouvertes } = await admin
    .from('opportunites')
    .select('magasin_id, produit_canonique_id')
    .not('statut', 'in', '(reussie,abandonnee)')
  for (const o of ouvertes ?? []) paires.add(`${o.magasin_id}:${o.produit_canonique_id}`)

  // Promos pas encore terminées, résolues au produit canonique — capte les
  // missions promo/référencement pas encore suivies (produit encore
  // "present", donc updateStatutProduit ne s'est jamais déclenché).
  const { data: produits } = await admin.from('produits').select('*')
  const produitsParId = new Map(((produits ?? []) as Produit[]).map(p => [p.id, p]))
  const { data: magasins } = await admin.from('magasins').select('id, enseigne')
  const { data: promoLiens } = await admin.from('promo_produits').select('produit_id, promos(enseigne, date_fin_vente, revente_fin)')

  for (const lien of (promoLiens ?? []) as unknown as Array<{ produit_id: string; promos: { enseigne: string; date_fin_vente: string | null; revente_fin: string | null } | null }>) {
    if (!lien.promos) continue
    const fin = lien.promos.date_fin_vente ?? lien.promos.revente_fin
    if (fin && fin < aujourdHui) continue
    const canoniqueId = resoudreCanonique(lien.produit_id, produitsParId)
    for (const m of (magasins ?? []) as Array<{ id: string; enseigne: string }>) {
      if (m.enseigne === lien.promos.enseigne) paires.add(`${m.id}:${canoniqueId}`)
    }
  }

  for (const paire of paires) {
    const [magasinId, produitId] = paire.split(':')
    await executerPipelinePourProduit(admin, magasinId, produitId)
  }

  return Response.json({ traite: paires.size })
}
