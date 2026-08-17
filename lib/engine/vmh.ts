import type { Magasin, VmhNational } from '@/lib/types'

export function vmhPertinent(
  magasin: Magasin,
  vmhNational: VmhNational | null
): { vmh: number | null; dv: number | null } | null {
  if (!vmhNational) return null
  if (magasin.taille === 'hyper') return { vmh: vmhNational.vmh_hyper, dv: vmhNational.dv_hyper }
  if (magasin.taille === 'super') return { vmh: vmhNational.vmh_super, dv: vmhNational.dv_super }
  // proxi/drive : le panel ne ventile pas le VMH pour ces formats.
  return { vmh: null, dv: vmhNational.dv_hmsm }
}
