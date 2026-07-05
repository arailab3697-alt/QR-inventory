import type { Inventory, Reagent } from './inventoryTypes'
import { dedupeReagentsById } from './inventoryDedup'

function normalizeReagent(entry: unknown): Reagent | null {
  if (!entry || typeof entry !== 'object') {
    return null
  }

  const candidate = entry as Record<string, unknown>
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
  const shelf = typeof candidate.shelf === 'string' ? candidate.shelf.trim() : ''

  if (!id) {
    return null
  }

  return { id, name, shelf }
}

export function normalizeInventory(input: unknown): Inventory {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid inventory payload.')
  }

  const source = input as Record<string, unknown>
  const rawReagents = source.reagents

  if (!Array.isArray(rawReagents)) {
    throw new Error('Inventory payload is missing reagents.')
  }

  const reagents = rawReagents
    .map(normalizeReagent)
    .filter((entry): entry is Reagent => entry !== null)

  return { reagents: dedupeReagentsById(reagents) }
}
