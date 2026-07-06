import type { Reagent } from './inventory'
import { normalizeCode } from './code'
import type { ShelfSelection } from './shelfSelection'

export type ShelfLeaf = {
  label: string
  reagents: Reagent[]
}

export type ShelfGroup = {
  parent: string
  directReagents: Reagent[]
  children: ShelfLeaf[]
}

export function normalizeShelf(value: string) {
  const shelf = value.trim()
  return shelf || 'その他'
}

export function splitShelfHierarchy(value: string) {
  const shelf = normalizeShelf(value)
  const parts = shelf.split(/\s+/).filter(Boolean)

  if (parts.length <= 1) {
    return { parent: shelf, child: '' }
  }

  return {
    parent: parts[0],
    child: parts.slice(1).join(' '),
  }
}

function sortReagents(reagents: Reagent[]) {
  return [...reagents].sort((left, right) => left.name.localeCompare(right.name))
}

export function buildShelfGroups(reagents: Reagent[]) {
  const parentGroups = new Map<
    string,
    {
      directReagents: Reagent[]
      childGroups: Map<string, Reagent[]>
    }
  >()

  for (const reagent of reagents) {
    const { parent, child } = splitShelfHierarchy(reagent.shelf)
    const group = parentGroups.get(parent) ?? {
      directReagents: [],
      childGroups: new Map<string, Reagent[]>(),
    }

    if (child) {
      const list = group.childGroups.get(child) ?? []
      list.push(reagent)
      group.childGroups.set(child, list)
    } else {
      group.directReagents.push(reagent)
    }

    parentGroups.set(parent, group)
  }

  return Array.from(parentGroups.entries())
    .map(([parent, group]) => ({
      parent,
      directReagents: sortReagents(group.directReagents),
      children: Array.from(group.childGroups.entries())
        .map(([label, childReagents]) => ({
          label,
          reagents: sortReagents(childReagents),
        }))
        .sort((left, right) => left.label.localeCompare(right.label)),
    }))
    .sort((left, right) => {
      if (left.parent === 'その他') return 1
      if (right.parent === 'その他') return -1
      return left.parent.localeCompare(right.parent)
    })
}

export function flattenShelfGroups(groups: ShelfGroup[]) {
  return groups.flatMap((group) => [
    ...group.directReagents,
    ...group.children.flatMap((child) => child.reagents),
  ])
}

export function getShelfReagents(
  groups: ShelfGroup[],
  selection: ShelfSelection | null,
) {
  if (!selection) {
    return [] as Reagent[]
  }

  const group = groups.find((entry) => entry.parent === selection.parent)
  if (!group) {
    return [] as Reagent[]
  }

  if (!selection.child) {
    return flattenShelfGroups([group])
  }

  const child = group.children.find((entry) => entry.label === selection.child)
  return child ? [...child.reagents] : ([] as Reagent[])
}

export type ShelfInference = {
  selection: ShelfSelection | null
  label: string
  scannedCount: number
  totalCount: number
}

function getSelectionLabel(selection: ShelfSelection) {
  return selection.child ? `${selection.parent} / ${selection.child}` : selection.parent
}

export function inferBestShelfSelection(
  groups: ShelfGroup[],
  scannedAt: Record<string, number>,
): ShelfInference {
  const candidates: Array<{
    selection: ShelfSelection
    label: string
    reagents: Reagent[]
  }> = []

  for (const group of groups) {
    candidates.push({
      selection: { parent: group.parent, child: null },
      label: group.parent,
      reagents: flattenShelfGroups([group]),
    })

    for (const child of group.children) {
      candidates.push({
        selection: { parent: group.parent, child: child.label },
        label: `${group.parent} / ${child.label}`,
        reagents: child.reagents,
      })
    }
  }

  let best: ShelfInference & { rank: [number, number, string] } | null = null

  for (const candidate of candidates) {
    const scannedCount = candidate.reagents.filter(
      (reagent) => scannedAt[normalizeCode(reagent.id)],
    ).length
    const totalCount = candidate.reagents.length
    const rank: [number, number, string] = [
      scannedCount,
      -totalCount,
      getSelectionLabel(candidate.selection).toLowerCase(),
    ]

    if (!best) {
      best = { selection: candidate.selection, label: candidate.label, scannedCount, totalCount, rank }
      continue
    }

    const [bestScanned, bestNegativeTotal, bestLabel] = best.rank
    const [scanned, negativeTotal, label] = rank

    if (
      scanned > bestScanned ||
      (scanned === bestScanned && negativeTotal > bestNegativeTotal) ||
      (scanned === bestScanned &&
        negativeTotal === bestNegativeTotal &&
        label.localeCompare(bestLabel) < 0)
    ) {
      best = { selection: candidate.selection, label: candidate.label, scannedCount, totalCount, rank }
    }
  }

  if (!best || best.scannedCount === 0) {
    return {
      selection: null,
      label: '',
      scannedCount: 0,
      totalCount: 0,
    }
  }

  const { rank: _rank, ...result } = best
  return result
}
