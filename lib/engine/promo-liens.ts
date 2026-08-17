import type { createServerClient } from '@/lib/supabase/server'
import type { Promo } from '@/lib/types'

const TAILLE_PAGE = 1000

export interface PromoLien {
  produit_id: string
  promos: Promo
}

// PostgREST plafonne chaque requête à max-rows (1000, non configurable
// depuis le code). promo_produits dépasse déjà ce seuil (1427 lignes) :
// un select() simple tronque silencieusement le reste. Pagine tant qu'une
// page pleine est reçue.
export async function chargerTousLesPromoLiens(
  supabase: ReturnType<typeof createServerClient>
): Promise<PromoLien[]> {
  const lignes: PromoLien[] = []
  let debut = 0
  while (true) {
    const { data, error } = await supabase
      .from('promo_produits')
      .select('produit_id, promos(*)')
      .range(debut, debut + TAILLE_PAGE - 1)
    if (error) throw error
    lignes.push(...((data ?? []) as unknown as PromoLien[]))
    if (!data || data.length < TAILLE_PAGE) break
    debut += TAILLE_PAGE
  }
  return lignes
}
