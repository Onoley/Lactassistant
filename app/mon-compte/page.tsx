'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function MonComptePage() {
  const [motDePasse, setMotDePasse] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [message, setMessage] = useState('')
  const [erreur, setErreur] = useState('')
  const [pending, setPending] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErreur('')
    setMessage('')
    if (motDePasse.length < 6) {
      setErreur('Le mot de passe doit faire au moins 6 caractères')
      return
    }
    if (motDePasse !== confirmation) {
      setErreur('Les deux mots de passe ne correspondent pas')
      return
    }
    setPending(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password: motDePasse })
    setPending(false)
    if (error) setErreur(error.message)
    else {
      setMessage('Mot de passe mis à jour.')
      setMotDePasse('')
      setConfirmation('')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-6 max-w-sm space-y-3">
      <h1 className="text-xl font-bold">Mon compte</h1>
      <h2 className="font-semibold">Changer mon mot de passe</h2>
      <input
        type="password"
        required
        value={motDePasse}
        onChange={e => setMotDePasse(e.target.value)}
        placeholder="Nouveau mot de passe"
        className="border rounded px-3 py-2 w-full"
      />
      <input
        type="password"
        required
        value={confirmation}
        onChange={e => setConfirmation(e.target.value)}
        placeholder="Confirmer le mot de passe"
        className="border rounded px-3 py-2 w-full"
      />
      {erreur && <p className="text-red-600 text-sm">{erreur}</p>}
      {message && <p className="text-green-600 text-sm">{message}</p>}
      <button type="submit" disabled={pending} className="bg-blue-600 text-white px-4 py-2 rounded w-full disabled:opacity-50">
        {pending ? 'Enregistrement...' : 'Enregistrer'}
      </button>
    </form>
  )
}
