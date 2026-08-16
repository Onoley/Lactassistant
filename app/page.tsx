import { redirect } from 'next/navigation'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'

export default async function HomePage() {
  const supabase = createServerClient()
  const profile = await getCurrentProfile(supabase)
  if (!profile) redirect('/login')
  if (profile.role === 'admin') redirect('/admin/import')
  if (profile.role === 'manager') redirect('/equipe')
  redirect('/semaine')
}
