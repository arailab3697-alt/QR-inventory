import { useMemo } from 'react'
import type { Reagent } from '../lib/inventory'
import { normalizeCode } from '../lib/code'
import { getShelfReagents, type ShelfGroup } from '../lib/shelves'
import {
  formatShelfSelection,
  parseShelfSelection,
  type ShelfSelection,
} from '../lib/shelfSelection'

export type SelectedShelfState = {
  selection: ShelfSelection | null
  label: string
  selectedReagents: Reagent[]
  scannedReagents: Reagent[]
  unscannedReagents: Reagent[]
  foreignReagents: Reagent[]
  counts: {
    scanned: number
    unscanned: number
    foreign: number
    total: number
  }
}

type UseSelectedShelfStateParams = {
  selectedShelf: string
  shelfGroups: ShelfGroup[]
  allReagents: Reagent[]
  scannedAt: Record<string, number>
}

export function useSelectedShelfState({
  selectedShelf,
  shelfGroups,
  allReagents,
  scannedAt,
}: UseSelectedShelfStateParams): SelectedShelfState {
  const selection = useMemo(() => parseShelfSelection(selectedShelf), [selectedShelf])

  const selectedReagents = useMemo(() => {
    return getShelfReagents(shelfGroups, selection)
  }, [shelfGroups, selection])

  const selectedIdSet = useMemo(
    () => new Set(selectedReagents.map((reagent) => normalizeCode(reagent.id))),
    [selectedReagents],
  )

  const scannedReagents = useMemo(
    () => selectedReagents.filter((reagent) => scannedAt[normalizeCode(reagent.id)]),
    [scannedAt, selectedReagents],
  )

  const unscannedReagents = useMemo(
    () => selectedReagents.filter((reagent) => !scannedAt[normalizeCode(reagent.id)]),
    [scannedAt, selectedReagents],
  )

  const foreignReagents = useMemo(() => {
    if (!selection) {
      return []
    }

    return allReagents.filter((reagent) => {
      const code = normalizeCode(reagent.id)
      return scannedAt[code] && !selectedIdSet.has(code)
    })
  }, [allReagents, scannedAt, selectedIdSet, selection])

  return {
    selection,
    label: formatShelfSelection(selection),
    selectedReagents,
    scannedReagents,
    unscannedReagents,
    foreignReagents,
    counts: {
      scanned: scannedReagents.length,
      unscanned: unscannedReagents.length,
      foreign: foreignReagents.length,
      total: selectedReagents.length,
    },
  }
}
