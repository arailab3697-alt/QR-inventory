import type { Reagent } from './inventoryTypes'

export function dedupeReagentsById(reagents: Reagent[]) {
  const seen = new Set<string>()

  return reagents.filter((entry) => {
    const key = entry.id.toLowerCase()
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
