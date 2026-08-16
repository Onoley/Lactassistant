export function numeroSemaineCourante(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const jourNum = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - jourNum + 3)
  const premierJeudi = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const semaine = 1 + Math.round(
    ((d.getTime() - premierJeudi.getTime()) / 86_400_000 - 3 + ((premierJeudi.getUTCDay() + 6) % 7)) / 7
  )
  return `${d.getUTCFullYear()}-W${String(semaine).padStart(2, '0')}`
}

export function dateDuJour(semaine: string, jourIndex: number): string {
  const [annee, num] = semaine.split('-W').map(Number)
  const janvier4 = new Date(Date.UTC(annee, 0, 4))
  const jourSemaineJanvier4 = (janvier4.getUTCDay() + 6) % 7
  const lundiSemaine1 = new Date(janvier4)
  lundiSemaine1.setUTCDate(janvier4.getUTCDate() - jourSemaineJanvier4)
  const lundiCible = new Date(lundiSemaine1)
  lundiCible.setUTCDate(lundiSemaine1.getUTCDate() + (num - 1) * 7 + jourIndex)
  return lundiCible.toISOString().slice(0, 10)
}
