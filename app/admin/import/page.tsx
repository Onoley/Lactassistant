'use client'
import { useState } from 'react'
import { importMagasins, importProduits, importPromos, type ImportSummary } from '@/lib/import/actions'

function ImportForm({ label, action }: { label: string; action: (formData: FormData) => Promise<ImportSummary> }) {
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [pending, setPending] = useState(false)

  async function handleSubmit(formData: FormData) {
    setPending(true)
    try {
      setSummary(await action(formData))
    } finally {
      setPending(false)
    }
  }

  return (
    <form action={handleSubmit} className="space-y-2 border rounded p-4">
      <h2 className="font-semibold">{label}</h2>
      <input type="file" name="file" accept=".csv,.xlsx" required />
      <button type="submit" disabled={pending} className="bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50">
        {pending ? 'Import en cours...' : 'Importer'}
      </button>
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
      <ImportForm label="Magasins" action={importMagasins} />
      <ImportForm label="Produits et priorités" action={importProduits} />
      <ImportForm label="Promos catalogue" action={importPromos} />
    </div>
  )
}
