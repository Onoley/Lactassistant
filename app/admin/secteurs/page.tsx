import { createServerClient } from '@/lib/supabase/server'
import { SecteursListe } from './secteurs-liste'

export default async function SecteursPage() {
  const supabase = createServerClient()
  const [{ data: secteurs }, { data: magasins }, { data: profiles }] = await Promise.all([
    supabase.from('secteurs').select('*').order('nom'),
    supabase.from('magasins').select('secteur_id'),
    supabase.from('profiles').select('secteur_id'),
  ])

  const secteursAvecCompteurs = (secteurs ?? []).map(s => ({
    id: s.id,
    nom: s.nom,
    nbMagasins: (magasins ?? []).filter(m => m.secteur_id === s.id).length,
    nbCommerciaux: (profiles ?? []).filter(p => p.secteur_id === s.id).length,
  }))

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Secteurs</h1>
      <p className="text-sm text-gray-600">
        Un secteur regroupe un parc de magasins et le(s) commercial(aux) qui le couvrent — voir aussi Import (parc de magasins) et Utilisateurs (rattacher un commercial).
      </p>
      <SecteursListe secteurs={secteursAvecCompteurs} />
    </div>
  )
}
