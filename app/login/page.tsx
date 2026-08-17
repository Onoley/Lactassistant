'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [envoye, setEnvoye] = useState(false)
  const [erreur, setErreur] = useState('')
  const [enCours, setEnCours] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErreur('')
    setEnCours(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password: motDePasse })
    setEnCours(false)
    if (error) setErreur(error.message)
    else {
      router.push('/')
      router.refresh()
    }
  }

  async function handleMagicLink() {
    setErreur('')
    setEnCours(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: false },
    })
    setEnCours(false)
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
      <input
        type="password"
        value={motDePasse}
        onChange={e => setMotDePasse(e.target.value)}
        placeholder="Mot de passe"
        className="border rounded px-3 py-2 w-full"
      />
      {erreur && <p className="text-red-600 text-sm">{erreur}</p>}
      <button type="submit" disabled={enCours} className="bg-blue-600 text-white px-4 py-2 rounded w-full disabled:opacity-50">
        Se connecter
      </button>
      <button
        type="button"
        disabled={enCours || !email}
        onClick={handleMagicLink}
        className="text-blue-600 text-sm underline w-full text-center"
      >
        Recevoir un lien de connexion par email à la place
      </button>
    </form>
  )
}
