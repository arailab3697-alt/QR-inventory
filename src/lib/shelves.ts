import type { Reagent } from './inventory'
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
