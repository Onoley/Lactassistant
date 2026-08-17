'use client'
import { useState } from 'react'
import { creerProduit } from '@/lib/produits/actions'

export function ProduitForm() {
  const [code, setCode] = useState('')
  const [nom, setNom] = useState('')
  const [categorie, setCategorie] = useState('')
  const [marque, setMarque] = useState('')
  const [gamme, setGamme] = useState('')
  const [parfum, setParfum] = useState('')
  const [format, setFormat] = useState('')
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    try {
      await creerProduit(code, nom, categorie || null, marque || null, gamme || null, parfum || null, format || null)
      setCode(''); setNom(''); setCategorie(''); setMarque(''); setGamme(''); setParfum(''); setFormat('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de la création')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-end flex-wrap">
      <input required value={code} onChange={e => setCode(e.target.value)} placeholder="EAN" className="border rounded px-2 py-1 w-32" />
      <input required value={nom} onChange={e => setNom(e.target.value)} placeholder="Nom" className="border rounded px-2 py-1 w-48" />
      <input value={categorie} onChange={e => setCategorie(e.target.value)} placeholder="Catégorie" className="border rounded px-2 py-1 w-32" />
      <input value={marque} onChange={e => setMarque(e.target.value)} placeholder="Marque" className="border rounded px-2 py-1 w-32" />
      <input value={gamme} onChange={e => setGamme(e.target.value)} placeholder="Gamme" className="border rounded px-2 py-1 w-32" />
      <input value={parfum} onChange={e => setParfum(e.target.value)} placeholder="Parfum" className="border rounded px-2 py-1 w-32" />
      <input value={format} onChange={e => setFormat(e.target.value)} placeholder="Format" className="border rounded px-2 py-1 w-24" />
      <button type="submit" className="bg-blue-600 text-white px-3 py-1 rounded">Ajouter</button>
      {error && <div className="w-full text-red-600 text-sm">{error}</div>}
    </form>
  )
}
