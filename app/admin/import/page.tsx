'use client'
import { useState } from 'react'
import { importMagasins, importProduits, importPromos, type ImportSummary } from '@/lib/import/actions'

function ImportForm({
  label,
  action,
  children,
}: {
  label: string
  action: (formData: FormData) => Promise<ImportSummary>
  children?: React.ReactNode
}) {
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [pending, setPending] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function handleSubmit(formData: FormData) {
    setPending(true)
    setErreur(null)
    try {
      setSummary(await action(formData))
    } catch (err) {
      setErreur((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <form action={handleSubmit} className="space-y-2 border rounded p-4">
      <h2 className="font-semibold">{label}</h2>
      {children}
      <input type="file" name="file" accept=".csv,.xlsx" required />
      <button type="submit" disabled={pending} className="bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50">
        {pending ? 'Import en cours...' : 'Importer'}
      </button>
      {erreur && <p className="text-red-600 text-sm">{erreur}</p>}
      {summary && (
        <div>
          <p>{summary.imported} ligne(s) importée(s).</p>
          {summary.errors.length > 0 && (
            <ul className="text-red-600 text-sm">
              {summary.errors.map(e => <li key={e.row}>Ligne {e.row} : {e.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </form>
  )
}

export default function ImportPage() {
  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-bold">Import de données</h1>
      <ImportForm label="Magasins (parc d'un secteur)" action={importMagasins}>
        <input
          type="text"
          name="secteur"
          required
          placeholder="Secteur (existant ou nouveau)"
          className="border rounded px-2 py-1 block"
        />
      </ImportForm>
      <ImportForm label="Produits et priorités" action={importProduits} />
      <ImportForm label="Promos catalogue" action={importPromos} />
    </div>
  )
}
