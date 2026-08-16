import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/server'

export default async function MagasinsPage() {
  const supabase = createServerClient()
  const { data: magasins } = await supabase.from('magasins').select('*').order('nom')

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold mb-4">Mes magasins</h1>
      <ul className="space-y-1">
        {(magasins ?? []).map(m => (
          <li key={m.id}>
            <Link href={`/magasins/${m.id}`} className="text-blue-600 underline">{m.nom} — {m.enseigne}</Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
