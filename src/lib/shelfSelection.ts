export type ShelfSelection = {
  parent: string
  child: string | null
}

export function parseShelfSelection(value: string): ShelfSelection | null {
  const [rawParent, ...childParts] = value.split('/')
  const parent = rawParent.trim()
  if (!parent) {
    return null
  }

  const child = childParts.join('/').trim()
  return {
    parent,
    child: child || null,
  }
}

export function formatShelfSelection(selection: ShelfSelection | null) {
  if (!selection) {
    return ''
  }

  return selection.child ? `${selection.parent} / ${selection.child}` : selection.parent
}
