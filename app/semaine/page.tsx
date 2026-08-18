import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { prioritesSemaine, resoudreCanonique } from '@/lib/engine/priorites'
import { chargerTousLesPromoLiens } from '@/lib/engine/promo-liens'
import { dateDuJour, decalerSemaine, numeroSemaineCourante } from '@/lib/semaine'
import { CalendrierSemaine } from './calendrier-semaine'
import { PrioritesListe } from '@/components/priorites-liste'
import type { Produit, Promo } from '@/lib/types'

export default async function SemainePage({ searchParams }: { searchParams: Promise<{ semaine?: string }> }) {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) redirect('/login')
  if (profile.role !== 'commercial') redirect('/equipe')

  const semaineCourante = numeroSemaineCourante()
  const semaine = (await searchParams).semaine || semaineCourante
  // Pour la semaine en cours, référence = maintenant (comportement historique
  // inchangé). Pour une semaine passée ou future consultée via la navigation,
  // référence = le lundi de cette semaine-là, pour que les niveaux d'urgence
  // se recalculent comme si on s'y trouvait.
  const aujourdHui = semaine === semaineCourante ? new Date() : new Date(dateDuJour(semaine, 0))

  const [{ data: magasins }, { data: produits }, { data: produitsEnseigne }, promoLiens, { data: visites }] = await Promise.all([
    supabase.from('magasins').select('*'),
    supabase.from('produits').select('*'),
    supabase.from('produits_enseigne').select('*'),
    chargerTousLesPromoLiens(supabase),
    supabase.from('visites').select('*').eq('semaine', semaine).eq('commercial_id', profile.id),
  ])

  const magasinIds = (magasins ?? []).map(m => m.id)
  const { data: statuts } = await supabase
    .from('statuts_produit_magasin')
    .select('*')
    .in('magasin_id', magasinIds.length ? magasinIds : ['00000000-0000-0000-0000-000000000000'])

  const produitsParId = new Map<string, Produit>((produits ?? []).map(p => [p.id, p]))
  const promosParProduitId = new Map<string, Promo[]>()
  for (const lien of promoLiens) {
    const idEffectif = resoudreCanonique(lien.produit_id, produitsParId)
    const liste = promosParProduitId.get(idEffectif) ?? []
    liste.push(lien.promos as unknown as Promo)
    promosParProduitId.set(idEffectif, liste)
  }

  const prioritesHebdo = prioritesSemaine(
    magasins ?? [], statuts ?? [], produitsParId, produitsEnseigne ?? [], promosParProduitId, aujourdHui
  )

  const magasinIdsPlanifies = new Set((visites ?? []).map(v => v.magasin_id))
  const nonCouvertes = prioritesHebdo.filter(p => !magasinIdsPlanifies.has(p.magasin.id))

  return (
    <div className="p-6 grid grid-cols-2 gap-6">
      <div>
        <div className="flex items-center gap-3 mb-4">
          <Link href={`/semaine?semaine=${decalerSemaine(semaine, -1)}`} className="text-sm underline">← Semaine précédente</Link>
          <h1 className="text-xl font-bold">Priorités de la semaine ({semaine})</h1>
          <Link href={`/semaine?semaine=${decalerSemaine(semaine, 1)}`} className="text-sm underline">Semaine suivante →</Link>
          {semaine !== semaineCourante && (
            <Link href="/semaine" className="text-sm underline text-blue-600">Revenir à cette semaine</Link>
          )}
        </div>
        {nonCouvertes.length > 0 && (
          <div className="bg-amber-100 border border-amber-400 rounded p-3 mb-4 text-sm">
            {nonCouvertes.length} priorité(s) ne sont pas couvertes par votre semaine planifiée.
          </div>
        )}
        <PrioritesListe priorites={prioritesHebdo} variant="liste" />
      </div>
      <CalendrierSemaine semaine={semaine} magasins={magasins ?? []} visites={visites ?? []} />
    </div>
  )
}
