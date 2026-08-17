import { createServerClient } from '@/lib/supabase/server'
import { ProduitForm } from './produit-form'
import { ProduitsTable } from './produits-table'

export default async function ProduitsPage() {
  const supabase = createServerClient()
  const [{ data: produits }, { data: produitsEnseigne }, { data: priorites }] = await Promise.all([
    supabase.from('produits').select('*').order('nom'),
    supabase.from('produits_enseigne').select('*'),
    supabase.from('priorites_produits').select('*'),
  ])

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Produits</h1>
      <p className="text-sm text-gray-600">
        Coche les enseignes qui référencent chaque produit et choisis sa priorité (Top 20/50/70).
      </p>
      <ProduitForm />
      <ProduitsTable
        produits={produits ?? []}
        produitsEnseigne={produitsEnseigne ?? []}
        priorites={priorites ?? []}
      />
    </div>
  )
}
