export type ShelfSelection = {
  parent: string
  child: string | null
}

export const INFERRED_SHELF_VALUE = '__infer__'

export function parseShelfSelection(value: string): ShelfSelection | null {
  if (value === INFERRED_SHELF_VALUE) {
    return null
  }

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
