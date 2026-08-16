import { redirect } from 'next/navigation'
import { createServerClient, getCurrentProfile } from '@/lib/supabase/server'
import { SignOutButton } from './sign-out-button'

export default async function HomePage() {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  const profile = await getCurrentProfile(supabase)

  if (!profile) {
    if (!user) redirect('/login')
    return (
      <div className="p-6 space-y-3">
        <p>Votre compte n&apos;est pas encore configuré. Contactez un administrateur.</p>
        <SignOutButton />
      </div>
    )
  }

  if (profile.role === 'admin') redirect('/admin/import')
  if (profile.role === 'manager') redirect('/equipe')
  redirect('/semaine')
}
