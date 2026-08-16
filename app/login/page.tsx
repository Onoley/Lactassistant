'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [envoye, setEnvoye] = useState(false)
  const [erreur, setErreur] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: false },
    })
    if (error) setErreur(error.message)
    else setEnvoye(true)
  }

  if (envoye) return <p className="p-6">Un lien de connexion a été envoyé à {email}.</p>

  return (
    <form onSubmit={handleSubmit} className="p-6 max-w-sm mx-auto space-y-3">
      <h1 className="text-xl font-bold">Connexion</h1>
      <input
        type="email"
        required
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="vous@lactalis.fr"
        className="border rounded px-3 py-2 w-full"
      />
      {erreur && <p className="text-red-600 text-sm">{erreur}</p>}
      <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded w-full">
        Recevoir le lien de connexion
      </button>
    </form>
  )
}
