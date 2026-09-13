import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ReorderableList } from '@cherrystudio/ui'

// Parity coverage for the global ReorderableList fake (tests/renderer.setup.ts):
// it mirrors the real component's rendering contract
// (packages/ui/src/components/composites/reorderable-list/index.tsx — same
// `visibleItems = items` default, same visible-index renderItem args), so these
// cases mirror the real component's own test. Drag wiring (onReorder, dnd-kit)
// is intentionally not faked and stays covered by the real component's tests.
describe('ReorderableList test fake', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]
  const renderList = (props: { visibleItems?: typeof items }) =>
    render(
      <ReorderableList
        items={items}
        visibleItems={props.visibleItems}
        getId={(item) => item.id}
        onReorder={vi.fn()}
        renderItem={(item, index, state) => (
          <div>
            {item.id}:{index}:{state.dragging ? 'dragging' : 'idle'}
          </div>
        )}
      />
    )

  it('renders only the visible items with their visible index, like the real component', () => {
    renderList({ visibleItems: [items[0], items[2], items[4]] })

    expect(screen.getByText('a:0:idle')).toBeInTheDocument()
    expect(screen.getByText('c:1:idle')).toBeInTheDocument()
    expect(screen.getByText('e:2:idle')).toBeInTheDocument()
    expect(screen.queryByText(/b:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/d:/)).not.toBeInTheDocument()
  })

  it('renders every item when visibleItems is omitted', () => {
    renderList({})

    items.forEach((item, index) => {
      expect(screen.getByText(`${item.id}:${index}:idle`)).toBeInTheDocument()
    })
  })
})
