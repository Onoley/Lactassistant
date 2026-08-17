import { describe, expect, it } from 'vitest'
import { vmhPertinent } from './vmh'
import type { Magasin, VmhNational } from '@/lib/types'

function magasin(taille: string): Magasin {
  return { id: '1', code: '1', nom: 'Test', enseigne: 'Carrefour', taille, adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null, surface: null }
}

const vmh: VmhNational = {
  produit_id: 'p1', vmh_hyper: 9.2, vmh_super: 3.6, dv_hmsm: 41.5, dv_hyper: 59.7, dv_super: 21.3, prix_moyen: 1.6, periode_reference: null, updated_at: '',
}

describe('vmhPertinent', () => {
  it('renvoie null si aucune ligne vmh_national pour ce produit', () => {
    expect(vmhPertinent(magasin('hyper'), null)).toBeNull()
  })

  it('sélectionne les colonnes hyper pour un magasin hyper', () => {
    expect(vmhPertinent(magasin('hyper'), vmh)).toEqual({ vmh: 9.2, dv: 59.7 })
  })

  it('sélectionne les colonnes super pour un magasin super', () => {
    expect(vmhPertinent(magasin('super'), vmh)).toEqual({ vmh: 3.6, dv: 21.3 })
  })

  it('replie sur le DV HMSM combiné pour proxi/drive, sans VMH (non ventilé dans le panel)', () => {
    expect(vmhPertinent(magasin('proxi'), vmh)).toEqual({ vmh: null, dv: 41.5 })
    expect(vmhPertinent(magasin('drive'), vmh)).toEqual({ vmh: null, dv: 41.5 })
  })
})
