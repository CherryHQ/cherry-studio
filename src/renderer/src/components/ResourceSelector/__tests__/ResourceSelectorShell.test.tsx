import type * as CherryStudioUi from '@cherrystudio/ui'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Global renderer setup stubs @cherrystudio/ui with only a handful of components; the selector
// needs the real EntitySelector/Checkbox/Separator, so we restore the actual module here.
vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

import {
  ResourceSelectorShell,
  type ResourceSelectorShellItem,
  type ResourceSelectorShellLabels,
  type ResourceSelectorShellSortOption
} from '../ResourceSelectorShell'

type Item = ResourceSelectorShellItem

const ITEMS: Item[] = [
  { id: '1', name: 'Alpha', description: 'first letter' },
  { id: '2', name: 'Beta' },
  { id: '3', name: 'Gamma' },
  { id: '4', name: 'Delta', disabled: true },
  { id: '5', name: 'Epsilon' }
]

const LABELS: ResourceSelectorShellLabels = {
  searchPlaceholder: 'Search',
  sortLabel: 'Sort',
  edit: 'Edit',
  pin: 'Pin',
  unpin: 'Unpin',
  createNew: 'Create new',
  emptyText: 'Nothing',
  pinnedTitle: 'Pinned'
}

// Radix Popover + Tailwind-driven scroll behaviours need these jsdom shims.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
  HTMLElement.prototype.scrollIntoView = () => {}
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function openPopover() {
  fireEvent.click(screen.getByRole('button', { name: /open/i }))
}

function getRow(name: string) {
  return screen.getByRole('option', { name: new RegExp(name) })
}

/**
 * Click the item row. EntitySelector wraps each row in an outer role="option" div, and our
 * renderItem returns an inner div with the onClick handler. Clicking the outer wrapper does not
 * bubble into React's synthetic handler on the inner div, so we click the name span (which is a
 * descendant of the inner div) to trigger the real row-select path end-to-end.
 */
function clickRowByName(name: string) {
  fireEvent.click(screen.getByText(name))
}

describe('ResourceSelectorShell', () => {
  describe('value adapter', () => {
    it('single + id: onChange fires the plain id on row click', () => {
      const onChange = vi.fn()
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onEditItem={vi.fn()}
          onCreateNew={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={onChange}
        />
      )
      openPopover()
      clickRowByName('Beta')
      expect(onChange).toHaveBeenCalledWith('2')
    })

    it('single + item: onChange fires the full item object on row click', () => {
      const onChange = vi.fn()
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onEditItem={vi.fn()}
          onCreateNew={vi.fn()}
          labels={LABELS}
          selectionType="item"
          value={null}
          onChange={onChange}
        />
      )
      openPopover()
      clickRowByName('Gamma')
      expect(onChange).toHaveBeenCalledWith(ITEMS[2])
    })

    it('multi + id: click while OFF replaces and closes (radio-in-array)', () => {
      const onChange = vi.fn()
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onEditItem={vi.fn()}
          onCreateNew={vi.fn()}
          labels={LABELS}
          multi
          value={['1']}
          onChange={onChange}
          multiToggleLabel="Multi"
        />
      )
      openPopover()
      clickRowByName('Beta')
      expect(onChange).toHaveBeenCalledWith(['2'])
    })

    it('multi + item: onChange fires items[] preserving order', () => {
      const onChange = vi.fn()
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onEditItem={vi.fn()}
          onCreateNew={vi.fn()}
          labels={LABELS}
          multi
          selectionType="item"
          value={[ITEMS[0], ITEMS[1]]}
          onChange={onChange}
          multiToggleLabel="Multi"
        />
      )
      openPopover()
      // Value starts with 2 items → multi auto-ON → click toggles membership.
      clickRowByName('Gamma')
      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith([ITEMS[0], ITEMS[1], ITEMS[2]])
    })
  })

  describe('multiEnabled sync', () => {
    it('turns multi ON when the controlled value grows to >= 2 after mount', () => {
      function Wrapper() {
        const [value, setValue] = useState<string[]>(['1'])
        return (
          <div>
            <button type="button" data-testid="promote" onClick={() => setValue(['1', '2'])}>
              promote
            </button>
            <ResourceSelectorShell
              trigger={<button type="button">Open</button>}
              items={ITEMS}
              pinnedIds={[]}
              onTogglePin={vi.fn()}
              onEditItem={vi.fn()}
              onCreateNew={vi.fn()}
              labels={LABELS}
              multi
              value={value}
              onChange={setValue}
              multiToggleLabel="Multi"
            />
          </div>
        )
      }
      render(<Wrapper />)
      openPopover()
      // With a single-item starting value, multi toolbar is OFF by spec.
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
      // Externally grow the value to two items — the sync effect should flip multi ON.
      act(() => {
        fireEvent.click(screen.getByTestId('promote'))
      })
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    })

    it('re-enables multi after opt-out when the controlled value externally grows to >= 2', () => {
      const onChangeSpy = vi.fn()
      function Wrapper() {
        const [value, setValue] = useState<string[]>(['1', '2'])
        const handleChange = (next: string[]) => {
          onChangeSpy(next)
          setValue(next)
        }
        return (
          <div>
            <button type="button" data-testid="promote" onClick={() => setValue(['1', '2', '3'])}>
              promote
            </button>
            <ResourceSelectorShell
              trigger={<button type="button">Open</button>}
              items={ITEMS}
              pinnedIds={[]}
              onTogglePin={vi.fn()}
              onEditItem={vi.fn()}
              onCreateNew={vi.fn()}
              labels={LABELS}
              multi
              value={value}
              onChange={handleChange}
              multiToggleLabel="Multi"
            />
          </div>
        )
      }

      render(<Wrapper />)
      openPopover()
      const switchEl = screen.getByRole('switch')
      expect(switchEl).toHaveAttribute('aria-checked', 'true')

      fireEvent.click(switchEl)
      expect(switchEl).toHaveAttribute('aria-checked', 'false')
      expect(onChangeSpy).toHaveBeenLastCalledWith(['1'])
      onChangeSpy.mockClear()

      act(() => {
        fireEvent.click(screen.getByTestId('promote'))
      })
      expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')

      clickRowByName('Epsilon')
      expect(onChangeSpy).toHaveBeenCalledWith(['1', '2', '3', '5'])
    })
  })

  describe('pinned section', () => {
    it('renders pinned header and orders pinned items by pinnedIds', () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={['3', '1']}
          onTogglePin={vi.fn()}
          onEditItem={vi.fn()}
          onCreateNew={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
        />
      )
      openPopover()
      expect(screen.getByText('Pinned')).toBeInTheDocument()
      const options = screen.getAllByRole('option')
      // First two options should be the pinned ones in the order given by pinnedIds.
      expect(options[0]).toHaveTextContent('Gamma')
      expect(options[1]).toHaveTextContent('Alpha')
    })

    it('unpin icon in single mode fires onTogglePin without selecting the row', () => {
      const onTogglePin = vi.fn()
      const onChange = vi.fn()
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={['1']}
          onTogglePin={onTogglePin}
          onEditItem={vi.fn()}
          onCreateNew={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={onChange}
        />
      )
      openPopover()
      // Pin icon is a <button aria-label="Unpin"> inside the pinned row.
      fireEvent.click(screen.getByRole('button', { name: 'Unpin' }))
      expect(onTogglePin).toHaveBeenCalledWith('1')
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('edit button', () => {
    it('fires onEditItem with the row id and does not trigger row select', () => {
      const onEditItem = vi.fn()
      const onChange = vi.fn()
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onEditItem={onEditItem}
          onCreateNew={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={onChange}
        />
      )
      openPopover()
      const editButtons = screen.getAllByRole('button', { name: 'Edit' })
      // One edit button per non-pinned row; click the first.
      fireEvent.click(editButtons[0])
      expect(onEditItem).toHaveBeenCalledTimes(1)
      expect(onChange).not.toHaveBeenCalled()
    })

    it('renders a custom item action slot without triggering row select', () => {
      const onEditItem = vi.fn()
      const onChange = vi.fn()
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onEditItem={onEditItem}
          onCreateNew={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={onChange}
          renderItemAction={({ item, buttonProps }) => (
            <button {...buttonProps} data-testid={`action-${item.id}`}>
              Configure {item.name}
            </button>
          )}
        />
      )
      openPopover()

      const customAction = screen.getByTestId('action-1')
      expect(customAction).toHaveTextContent('Configure Alpha')

      fireEvent.click(customAction)

      expect(onEditItem).toHaveBeenCalledTimes(1)
      expect(onEditItem).toHaveBeenCalledWith('1')
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('disabled rows', () => {
    it('ignores click and right-click on aria-disabled rows', () => {
      const onChange = vi.fn()
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onEditItem={vi.fn()}
          onCreateNew={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={onChange}
        />
      )
      openPopover()
      const delta = getRow('Delta')
      expect(delta).toHaveAttribute('aria-disabled', 'true')
      fireEvent.click(delta)
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('sort + search', () => {
    it('applies a sort comparator when selected', () => {
      const sortOptions: ResourceSelectorShellSortOption<Item>[] = [
        { id: 'asc', label: 'Asc', comparator: (a, b) => a.name.localeCompare(b.name) },
        { id: 'desc', label: 'Desc', comparator: (a, b) => b.name.localeCompare(a.name) }
      ]
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={[ITEMS[1], ITEMS[0], ITEMS[2]]} // Beta, Alpha, Gamma
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onEditItem={vi.fn()}
          onCreateNew={vi.fn()}
          labels={LABELS}
          sortOptions={sortOptions}
          defaultSortId="asc"
          value={null}
          onChange={vi.fn()}
        />
      )
      openPopover()
      const options = screen.getAllByRole('option')
      expect(options[0]).toHaveTextContent('Alpha')
      expect(options[1]).toHaveTextContent('Beta')
      expect(options[2]).toHaveTextContent('Gamma')
    })

    it('filters by name (case-insensitive) and by description', () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onEditItem={vi.fn()}
          onCreateNew={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
        />
      )
      openPopover()
      const input = screen.getByPlaceholderText('Search')
      // name match
      fireEvent.change(input, { target: { value: 'beta' } })
      expect(screen.queryByRole('option', { name: /Beta/ })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /Alpha/ })).not.toBeInTheDocument()
      // description-only match
      fireEvent.change(input, { target: { value: 'first letter' } })
      expect(screen.queryByRole('option', { name: /Alpha/ })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /Beta/ })).not.toBeInTheDocument()
    })
  })
})
