import type { Magasin, VmhEnseigne, VmhNational } from '@/lib/types'

function parTaille(
  taille: string,
  vmhHyper: number | null,
  vmhSuper: number | null,
  dvHmsm: number | null,
  dvHyper: number | null,
  dvSuper: number | null
): { vmh: number | null; dv: number | null } {
  if (taille === 'hyper') return { vmh: vmhHyper, dv: dvHyper }
  if (taille === 'super') return { vmh: vmhSuper, dv: dvSuper }
  // proxi/drive : le panel ne ventile pas le VMH pour ces formats.
  return { vmh: null, dv: dvHmsm }
}

// Priorise le VMH par enseigne (plus précis) sur le national quand
// disponible pour ce produit et ce format — certaines enseignes (Leclerc,
// Intermarché) n'ont pas cette donnée dans l'export panel, d'où le repli.
export function vmhPertinent(
  magasin: Magasin,
  vmhNational: VmhNational | null,
  vmhEnseigne: VmhEnseigne | null = null
): { vmh: number | null; dv: number | null; source: 'enseigne' | 'national' } | null {
  if (vmhEnseigne) {
    const parEnseigne = parTaille(magasin.taille, vmhEnseigne.vmh_hyper, vmhEnseigne.vmh_super, vmhEnseigne.dv_hmsm, vmhEnseigne.dv_hyper, vmhEnseigne.dv_super)
    if (parEnseigne.vmh !== null || parEnseigne.dv !== null) return { ...parEnseigne, source: 'enseigne' }
  }
  if (!vmhNational) return null
  return { ...parTaille(magasin.taille, vmhNational.vmh_hyper, vmhNational.vmh_super, vmhNational.dv_hmsm, vmhNational.dv_hyper, vmhNational.dv_super), source: 'national' }
}
