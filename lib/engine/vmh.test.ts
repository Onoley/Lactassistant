import { describe, expect, it } from 'vitest'
import { vmhPertinent } from './vmh'
import type { Magasin, VmhEnseigne, VmhNational } from '@/lib/types'

function magasin(taille: string): Magasin {
  return { id: '1', code: '1', nom: 'Test', enseigne: 'Carrefour', taille, adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null, surface: null }
}

const vmhNational: VmhNational = {
  produit_id: 'p1', vmh_hyper: 9.2, vmh_super: 3.6, dv_hmsm: 41.5, dv_hyper: 59.7, dv_super: 21.3, prix_moyen: 1.6, periode_reference: null, updated_at: '',
}

const vmhEnseigne: VmhEnseigne = {
  produit_id: 'p1', enseigne: 'Carrefour', vmh_hyper: 12.1, vmh_super: 5.4, dv_hmsm: 50.0, dv_hyper: 70.2, dv_super: 30.1, prix_moyen: 1.8, periode_reference: null, updated_at: '',
}

describe('vmhPertinent', () => {
  it('renvoie null si ni vmh_national ni vmh_enseigne pour ce produit', () => {
    expect(vmhPertinent(magasin('hyper'), null)).toBeNull()
  })

  it('sélectionne les colonnes hyper/super du national quand aucun vmh_enseigne', () => {
    expect(vmhPertinent(magasin('hyper'), vmhNational)).toEqual({ vmh: 9.2, dv: 59.7, source: 'national' })
    expect(vmhPertinent(magasin('super'), vmhNational)).toEqual({ vmh: 3.6, dv: 21.3, source: 'national' })
  })

  it('replie sur le DV HMSM combiné pour proxi/drive, sans VMH (non ventilé dans le panel)', () => {
    expect(vmhPertinent(magasin('proxi'), vmhNational)).toEqual({ vmh: null, dv: 41.5, source: 'national' })
    expect(vmhPertinent(magasin('drive'), vmhNational)).toEqual({ vmh: null, dv: 41.5, source: 'national' })
  })

  it('priorise le vmh_enseigne sur le national quand disponible', () => {
    expect(vmhPertinent(magasin('hyper'), vmhNational, vmhEnseigne)).toEqual({ vmh: 12.1, dv: 70.2, source: 'enseigne' })
    expect(vmhPertinent(magasin('super'), vmhNational, vmhEnseigne)).toEqual({ vmh: 5.4, dv: 30.1, source: 'enseigne' })
  })

  it('bascule sur le national si vmh_enseigne existe mais sans donnée pour ce format (ex. Leclerc/Intermarché)', () => {
    const enseigneSansVmh: VmhEnseigne = { ...vmhEnseigne, vmh_hyper: null, vmh_super: null, dv_hmsm: null, dv_hyper: null, dv_super: null }
    expect(vmhPertinent(magasin('hyper'), vmhNational, enseigneSansVmh)).toEqual({ vmh: 9.2, dv: 59.7, source: 'national' })
  })

  it('bascule sur le national si aucun vmh_enseigne pour cette enseigne', () => {
    expect(vmhPertinent(magasin('hyper'), vmhNational, null)).toEqual({ vmh: 9.2, dv: 59.7, source: 'national' })
  })
})
