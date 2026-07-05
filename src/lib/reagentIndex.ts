import { normalizeCode } from './code'
import type { Reagent } from './inventoryTypes'

export function buildReagentIndex(
  reagents: Reagent[],
  normalize = normalizeCode,
) {
  const byId = new Map<string, Reagent>()

  for (const reagent of reagents) {
    byId.set(normalize(reagent.id), reagent)
  }

  return byId
}
