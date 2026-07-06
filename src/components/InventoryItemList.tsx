import type { Reagent } from '../lib/inventory'

type InventoryItemListProps = {
  items: Reagent[]
  emptyLabel?: string
}

export function InventoryItemList({
  items,
  emptyLabel = 'No items found.',
}: InventoryItemListProps) {
  if (!items.length) {
    return <p className="status-copy">{emptyLabel}</p>
  }

  return (
    <ul className="inventory-grid">
      {items.map((item) => (
        <li key={item.id} className="inventory-item">
          <p className="item-name">{item.name}</p>
          <p className="item-meta">{item.id}</p>
        </li>
      ))}
    </ul>
  )
}
