// lib/engine/similarity.test.ts
import { describe, expect, it } from 'vitest'
import { magasinsSimilaires } from './similarity'
import type { Magasin } from '@/lib/types'

function magasin(overrides: Partial<Magasin>): Magasin {
  return {
    id: 'm', code: 'c', nom: 'n', enseigne: 'Carrefour', taille: 'super',
    adresse: null, secteur_id: 's', contact_nom: null, contact_telephone: null, contact_email: null,
    ...overrides,
  }
}

describe('magasinsSimilaires', () => {
  const cible = magasin({ id: '1', enseigne: 'Carrefour', taille: 'super' })
  const tous = [
    cible,
    magasin({ id: '2', enseigne: 'Carrefour', taille: 'super' }),
    magasin({ id: '3', enseigne: 'Carrefour', taille: 'hyper' }),
    magasin({ id: '4', enseigne: 'Leclerc', taille: 'super' }),
  ]

  it('exclut le magasin cible lui-même', () => {
    const result = magasinsSimilaires(cible, tous, 'les_deux')
    expect(result.find(m => m.id === '1')).toBeUndefined()
  })

  it('filtre par enseigne seule', () => {
    const result = magasinsSimilaires(cible, tous, 'enseigne')
    expect(result.map(m => m.id).sort()).toEqual(['2', '3'])
  })

  it('filtre par taille seule', () => {
    const result = magasinsSimilaires(cible, tous, 'taille')
    expect(result.map(m => m.id).sort()).toEqual(['2', '4'])
  })

  it('filtre par enseigne et taille', () => {
    const result = magasinsSimilaires(cible, tous, 'les_deux')
    expect(result.map(m => m.id)).toEqual(['2'])
  })
})
