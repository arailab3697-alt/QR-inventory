import type { Reagent } from '../lib/inventory'
import { InventoryItemList } from './InventoryItemList'

type ShelfItemsSectionProps = {
  title: string
  count: number
  total: number
  items: Reagent[]
  emptyLabel?: string
}

export function ShelfItemsSection({
  title,
  count,
  total,
  items,
  emptyLabel,
}: ShelfItemsSectionProps) {
  return (
    <div className="targets-tile" style={{ marginTop: '0.5rem' }}>
      <h3 className="eyebrow">
        {title} ({count}/{total})
      </h3>
      <InventoryItemList items={items} emptyLabel={emptyLabel} />
    </div>
  )
}
