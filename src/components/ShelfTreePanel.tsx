import type { ShelfGroup } from '../lib/shelves'
import { InventoryItemList } from './InventoryItemList'

type ShelfTreePanelProps = {
  groups: ShelfGroup[]
  expanded: boolean
  onToggle: () => void
}

export function ShelfTreePanel({ groups, expanded, onToggle }: ShelfTreePanelProps) {
  return (
    <section className="panel inventory-pane">
      <div className="panel-head compact">
        <div>
          <p className="eyebrow">Inventory</p>
          <button type="button" className="ghost shelf-toggle" onClick={onToggle}>
            {expanded ? '折りたたむ' : '展開'}
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="inventory-shelves">
          {groups.map((group) => {
            const childCount = group.children.reduce(
              (total, child) => total + child.reagents.length,
              0,
            )
            const totalCount = group.directReagents.length + childCount

            return (
              <details key={group.parent} className="inventory-shelf inventory-shelf-parent">
                <summary>
                  <div>
                    <strong>{group.parent}</strong>
                    <span>{totalCount} items</span>
                  </div>
                </summary>
                <div className="inventory-shelf-children">
                  {group.directReagents.length ? (
                    <div className="inventory-shelf-direct">
                      <div className="inventory-shelf-direct-head">
                        <strong>親直下</strong>
                        <span>{group.directReagents.length} items</span>
                      </div>
                      <InventoryItemList items={group.directReagents} />
                    </div>
                  ) : null}

                  {group.children.map((child) => (
                    <details
                      key={`${group.parent} ${child.label}`}
                      className="inventory-shelf inventory-shelf-child"
                    >
                      <summary>
                        <div>
                          <strong>{child.label}</strong>
                          <span>{child.reagents.length} items</span>
                        </div>
                      </summary>
                      <InventoryItemList items={child.reagents} />
                    </details>
                  ))}
                </div>
              </details>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
