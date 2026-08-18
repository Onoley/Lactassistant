'use client'
import { useState } from 'react'
import {
  importMagasins,
  importProduits,
  importPromos,
  importVmh,
  importVmhEnseigne,
  previewImportPlanDeVente,
  confirmerImportPlanDeVente,
  type ImportSummary,
  type PreviewPlanDeVente,
  type DiffEnseigne,
} from '@/lib/import/actions'
import { ENSEIGNES } from '@/lib/types'

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

function ImportPlanDeVenteForm() {
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewPlanDeVente | null>(null)
  const [resultat, setResultat] = useState<{ resume: DiffEnseigne[] } | null>(null)
  const [pending, setPending] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)

  async function handlePreview() {
    if (!file) return
    setPending(true)
    setErreur(null)
    try {
      const fd = new FormData()
      fd.set('file', file)
      setPreview(await previewImportPlanDeVente(fd))
    } catch (err) {
      setErreur((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  async function handleConfirmer() {
    if (!file) return
    setPending(true)
    setErreur(null)
    try {
      const fd = new FormData()
      fd.set('file', file)
      setResultat(await confirmerImportPlanDeVente(fd))
      setPreview(null)
    } catch (err) {
      setErreur((err as Error).message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="space-y-2 border rounded p-4">
      <h2 className="font-semibold">Plan de vente LNUF (par enseigne)</h2>
      <input type="file" accept=".xlsx" onChange={e => { setFile(e.target.files?.[0] ?? null); setPreview(null); setResultat(null) }} />
      <button onClick={handlePreview} disabled={!file || pending} className="bg-gray-600 text-white px-3 py-1 rounded disabled:opacity-50">
        {pending ? 'Analyse...' : 'Prévisualiser'}
      </button>
      {erreur && <p className="text-red-600 text-sm">{erreur}</p>}
      {preview && (
        <div className="text-sm space-y-1">
          {preview.onglets_manquants.length > 0 && (
            <p className="text-red-600">Onglets manquants : {preview.onglets_manquants.join(', ')} — import refusé.</p>
          )}
          {preview.parEnseigne.map(d => (
            <p key={d.enseigne}>
              {d.enseigne} — {d.references} références détectées · {d.ajouts} ajouts · {d.misesAJour} mises à jour · {d.retraits} retraits
              {d.eanInconnus.length > 0 && ` · ${d.eanInconnus.length} EAN inconnu(s)`}
              {d.doublons.length > 0 && ` · ${d.doublons.length} doublon(s)`}
            </p>
          ))}
          {preview.onglets_manquants.length === 0 && (
            <button onClick={handleConfirmer} disabled={pending} className="bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50">
              {pending ? 'Import en cours...' : 'Confirmer et appliquer'}
            </button>
          )}
        </div>
      )}
      {resultat && <p className="text-green-700 text-sm">Import appliqué : {resultat.resume.map(d => `${d.enseigne} (${d.references})`).join(', ')}</p>}
    </div>
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
      <ImportForm label="Promos (plan promotionnel d'une enseigne)" action={importPromos}>
        <select name="enseigne" required defaultValue="" className="border rounded px-2 py-1 block">
          <option value="" disabled>Enseigne...</option>
          {ENSEIGNES.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
      </ImportForm>
      <ImportForm label="VMH national (export panel)" action={importVmh} />
      <ImportForm label="VMH par enseigne (Carrefour, Carrefour Market, Auchan, U)" action={importVmhEnseigne} />
      <ImportPlanDeVenteForm />
    </div>
  )
}
