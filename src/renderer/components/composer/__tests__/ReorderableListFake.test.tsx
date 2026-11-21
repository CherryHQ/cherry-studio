import { render, screen } from '@testing-library/react'
import type { ComponentType, ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ReorderableList as FakeReorderableList } from '@cherrystudio/ui'
import { ReorderableList as RealReorderableList } from '@cherrystudio/ui/components/composites/reorderable-list'

// The real component renders through dnd-kit's Sortable; stand it in with a
// minimal ordered renderer so these cases execute the real subset/index logic.
vi.mock('@cherrystudio/ui/components/composites/sortable', () => ({
  Sortable: ({ items, itemKey, renderItem }: any) => (
    <div data-testid="sortable">
      {items.map((item: any) => (
        <div key={String(itemKey(item))}>{renderItem(item, { dragging: false })}</div>
      ))}
    </div>
  )
}))

interface ContractItem {
  id: string
}

interface ContractListProps {
  items: ContractItem[]
  visibleItems?: ContractItem[]
  getId: (item: ContractItem) => string
  onReorder: (nextItems: ContractItem[]) => void
  renderItem: (item: ContractItem, index: number, state: { dragging: boolean }) => ReactNode
}

// Rendering contract both implementations must honor (same `visibleItems =
// items` default, same visible-index renderItem args). Drag wiring (onReorder,
// dnd-kit) is intentionally out of scope and stays with the real component's tests.
const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]

function renderContractList(List: ComponentType<ContractListProps>, visibleItems?: ContractItem[]) {
  render(
    <List
      items={items}
      visibleItems={visibleItems}
      getId={(item) => item.id}
      onReorder={vi.fn()}
      renderItem={(item, index, state) => (
        <div>
          {item.id}:{index}:{state.dragging ? 'dragging' : 'idle'}
        </div>
      )}
    />
  )
}

describe.each([
  ['test fake', FakeReorderableList],
  ['real component', RealReorderableList]
] as const)('ReorderableList %s', (_name, List) => {
  it('renders only the visible items with their visible index', () => {
    renderContractList(List as ComponentType<ContractListProps>, [items[0], items[2], items[4]])

    expect(screen.getByText('a:0:idle')).toBeInTheDocument()
    expect(screen.getByText('c:1:idle')).toBeInTheDocument()
    expect(screen.getByText('e:2:idle')).toBeInTheDocument()
    expect(screen.queryByText(/b:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/d:/)).not.toBeInTheDocument()
  })

  it('renders every item when visibleItems is omitted', () => {
    renderContractList(List as ComponentType<ContractListProps>)

    items.forEach((item, index) => {
      expect(screen.getByText(`${item.id}:${index}:idle`)).toBeInTheDocument()
    })
  })
})
