export function nomComplet(produit: { nom: string; format?: string | null }): string {
  return produit.format ? `${produit.nom} — ${produit.format}` : produit.nom
}
