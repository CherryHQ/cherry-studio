import type * as CherryStudioUi from '@cherrystudio/ui'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Global renderer setup stubs @cherrystudio/ui with only a handful of components; the selector
// needs the real Checkbox/Popover primitives, so we restore the actual module here.
vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

import { DEFAULT_SELECTOR_CONTENT_HEIGHT } from '@renderer/components/Selector/shell/SelectorShell'

import {
  ResourceSelectorShell,
  type ResourceSelectorShellItem,
  type ResourceSelectorShellLabels
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
  pin: 'Pin',
  unpin: 'Unpin',
  edit: 'Edit',
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
  vi.restoreAllMocks()
})

function openPopover() {
  fireEvent.click(screen.getByRole('button', { name: /open/i }))
}

function getRow(name: string) {
  return screen.getByRole('option', { name: new RegExp(name) })
}

function clickRowByName(name: string) {
  fireEvent.click(screen.getByText(name))
}

function mockSelectorAvailableHeight(availableHeight: number, chromeHeight: number) {
  const originalGetComputedStyle = window.getComputedStyle.bind(window)

  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    const style = originalGetComputedStyle(element)
    const isContent = element instanceof HTMLElement && element.getAttribute('data-selector-shell-content') === 'true'
    const isPopperWrapper = element instanceof HTMLElement && element.hasAttribute('data-radix-popper-content-wrapper')

    if (!isContent && !isPopperWrapper) {
      return style
    }

    Object.defineProperties(style, {
      maxHeight: { configurable: true, value: `${availableHeight}px` },
      paddingTop: { configurable: true, value: '0px' },
      paddingBottom: { configurable: true, value: '0px' }
    })
    vi.spyOn(style, 'getPropertyValue').mockImplementation((property: string) =>
      property === '--radix-popover-content-available-height' || property === '--radix-popper-available-height'
        ? `${availableHeight}px`
        : CSSStyleDeclaration.prototype.getPropertyValue.call(style, property)
    )

    return style
  })

  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const isChrome = this.hasAttribute('data-selector-shell-chrome')
    return {
      x: 0,
      y: 0,
      width: 320,
      height: isChrome ? chromeHeight : 0,
      top: 0,
      right: 320,
      bottom: isChrome ? chromeHeight : 0,
      left: 0,
      toJSON: () => {}
    }
  })
}

describe('ResourceSelectorShell', () => {
  describe('layout', () => {
    it('clamps the list max height to the available popover space', async () => {
      mockSelectorAvailableHeight(160, 52)

      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onCreateNew={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
        />
      )
      openPopover()

      await waitFor(() =>
        expect(screen.getByRole('listbox')).toHaveStyle({
          height: '56px'
        })
      )
    })

    it('allows the list height to collapse when chrome uses the available space', async () => {
      mockSelectorAvailableHeight(80, 52)

      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onCreateNew={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
        />
      )
      openPopover()

      await waitFor(() =>
        expect(screen.getByRole('listbox')).toHaveStyle({
          height: '0px'
        })
      )
    })

    it('fills the unified popover content height when available space is unconstrained', async () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          labels={LABELS}
          loading
          value={null}
          onChange={vi.fn()}
        />
      )
      openPopover()

      await waitFor(() =>
        expect(screen.getByRole('listbox')).toHaveStyle({ height: `${DEFAULT_SELECTOR_CONTENT_HEIGHT}px` })
      )
    })

    it('sets the default popover target height when available space is unconstrained', () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
        />
      )
      openPopover()

      expect(document.querySelector('[data-selector-shell-content]')).toHaveStyle({
        height: `${DEFAULT_SELECTOR_CONTENT_HEIGHT}px`
      })
    })

    it('renders empty results with the shared empty state', () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={[]}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          emptyState={{ preset: 'no-agent' }}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
        />
      )
      openPopover()

      expect(screen.getByText('Nothing')).toBeInTheDocument()
      expect(screen.getByRole('listbox').querySelector('.lucide-package')).toBeInTheDocument()
    })

    it('lazy keeps content mounted after the first open', async () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
          mountStrategy="lazy-keep"
        />
      )

      expect(document.querySelector('[data-selector-shell-content]')).toBeNull()

      openPopover()
      const content = document.querySelector('[data-selector-shell-content]')
      expect(content).toBeInTheDocument()
      expect(content).not.toHaveAttribute('hidden')

      openPopover()
      await waitFor(() => expect(content).toHaveAttribute('hidden'))
      expect(document.querySelector('[data-selector-shell-content]')).toBe(content)
    })

    it('uses unified list height after lazy-kept content is measured', () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
          mountStrategy="lazy-keep"
        />
      )

      openPopover()

      expect(screen.getByRole('listbox')).toHaveStyle({
        height: `${DEFAULT_SELECTOR_CONTENT_HEIGHT}px`
      })
    })

    it('aligns the selected row to the start when a lazy-kept selector opens', async () => {
      const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})

      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          labels={LABELS}
          value="3"
          onChange={vi.fn()}
          mountStrategy="lazy-keep"
        />
      )

      openPopover()

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }))
    })

    it('keeps keyboard navigation scrolling to the nearest visible row', async () => {
      const scrollIntoView = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {})

      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          labels={LABELS}
          value="1"
          onChange={vi.fn()}
          mountStrategy="lazy-keep"
        />
      )

      openPopover()
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' }))
      scrollIntoView.mockClear()

      fireEvent.keyDown(screen.getByPlaceholderText('Search'), { key: 'ArrowDown' })

      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' }))
    })
  })

  describe('value adapter', () => {
    it('single + id: onChange fires the plain id on row click', () => {
      const onChange = vi.fn()
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
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
    it('runs onOpen only once while the popover remains open across rerenders', () => {
      const onOpen = vi.fn()
      const { rerender } = render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onOpen={onOpen}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
        />
      )

      openPopover()
      expect(onOpen).toHaveBeenCalledTimes(1)

      rerender(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={['1']}
          onTogglePin={vi.fn()}
          onOpen={onOpen}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
        />
      )
      expect(onOpen).toHaveBeenCalledTimes(1)
    })

    it('renders pinned header and orders pinned items by pinnedIds', () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={['3', '1']}
          onTogglePin={vi.fn()}
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

    it('uses neutral color from the model selector row action when pinned', () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={['1']}
          onTogglePin={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
        />
      )
      openPopover()

      expect(screen.getByRole('button', { name: 'Unpin' })).toHaveAttribute('data-slot', 'button')
      expect(screen.getByRole('button', { name: 'Unpin' })).toHaveClass('text-foreground!')
      expect(screen.getByRole('button', { name: 'Unpin' })).not.toHaveClass('text-primary!')
    })

    it('uses neutral color on the unpin action when the pinned resource row is selected', () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={['1']}
          onTogglePin={vi.fn()}
          labels={LABELS}
          value="1"
          onChange={vi.fn()}
        />
      )
      openPopover()

      expect(screen.getByRole('button', { name: 'Unpin' })).toHaveClass('text-foreground!')
      expect(screen.getByRole('button', { name: 'Unpin' })).not.toHaveClass('text-primary!')
    })

    it('uses neutral color on the pin action when the resource row is selected', () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          labels={LABELS}
          value="1"
          onChange={vi.fn()}
        />
      )
      openPopover()

      expect(screen.getAllByRole('button', { name: 'Pin' })[0]).toHaveClass('text-foreground!')
      expect(screen.getAllByRole('button', { name: 'Pin' })[0]).not.toHaveClass('text-primary!')
    })

    it('pin action is available on unpinned rows and does not select the row', () => {
      const onTogglePin = vi.fn()
      const onChange = vi.fn()
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={onTogglePin}
          labels={LABELS}
          value={null}
          onChange={onChange}
        />
      )
      openPopover()
      fireEvent.click(screen.getAllByRole('button', { name: 'Pin' })[0])
      expect(onTogglePin).toHaveBeenCalledWith('1')
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('edit button', () => {
    it('places edit and pin together in the row action area', () => {
      const taggedItems: Item[] = [{ ...ITEMS[0], tags: ['Cherry', 'DEV'] }, ...ITEMS.slice(1)]

      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={taggedItems}
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

      const alphaOption = getRow('Alpha')
      const row = alphaOption.closest('[data-model-selector-row]') as HTMLElement
      const nameArea = row.querySelector('[data-resource-selector-name="1"]') as HTMLElement
      const tagArea = row.querySelector('[data-resource-selector-tags="1"]')
      const editButton = within(row).getByRole('button', { name: 'Edit' })

      expect(row).toHaveClass('pr-0.5')
      expect(nameArea).toHaveTextContent('Alpha')
      expect(within(nameArea).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
      expect(editButton).toHaveClass('size-4', 'hover:bg-transparent')
      expect(within(alphaOption).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
      expect(within(alphaOption).queryByRole('button', { name: 'Pin' })).not.toBeInTheDocument()
      expect(within(row).getByRole('button', { name: 'Pin' })).toHaveClass('size-4', 'hover:bg-transparent')
      expect(tagArea).toHaveClass('max-w-[48%]')
      expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(ITEMS.length)
    })

    it('closes and recreates the popover before running the edit action on requestAnimationFrame', async () => {
      const animationFrameCallbacks: FrameRequestCallback[] = []
      let popoverAtCallback: HTMLElement | null = null
      const onChange = vi.fn()
      const onEditItem = vi.fn((item: Item) => {
        popoverAtCallback = screen.queryByPlaceholderText('Search')
        expect(item.id).toBe('1')
      })

      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onEditItem={onEditItem}
          labels={LABELS}
          value={null}
          onChange={onChange}
        />
      )
      openPopover()

      const requestAnimationFrameSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
        animationFrameCallbacks.push(callback)
        return animationFrameCallbacks.length
      })

      fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
      expect(onEditItem).not.toHaveBeenCalled()

      await waitFor(() => expect(animationFrameCallbacks.length).toBeGreaterThan(0))
      act(() => {
        for (const callback of animationFrameCallbacks.splice(0)) {
          callback(0)
        }
      })

      expect(onEditItem).toHaveBeenCalledTimes(1)
      expect(onChange).not.toHaveBeenCalled()
      expect(popoverAtCallback).toBeNull()
      requestAnimationFrameSpy.mockRestore()
    })

    it('uses the model selector row styling', () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          labels={LABELS}
          value="1"
          onChange={vi.fn()}
        />
      )
      openPopover()

      const alphaOption = getRow('Alpha')
      const row = alphaOption.closest('[data-model-selector-row]')
      expect(row).toHaveClass('group', 'relative', 'rounded-[10px]', 'px-2', 'py-1.5', 'bg-accent/70')
      expect(row).not.toHaveClass('bg-primary/10')
    })

    it('does not select the active row when pressing Enter on a row action', async () => {
      const onTogglePin = vi.fn()
      const onChange = vi.fn()
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={onTogglePin}
          labels={LABELS}
          value={null}
          onChange={onChange}
        />
      )
      openPopover()

      const pinButton = screen.getAllByRole('button', { name: 'Pin' })[0]
      pinButton.focus()
      fireEvent.keyDown(pinButton, { key: 'Enter' })

      await waitFor(() => expect(onChange).not.toHaveBeenCalled())
      expect(onTogglePin).not.toHaveBeenCalled()
    })

    it('closes the popover before running the create action callback', async () => {
      let popoverAtCallback: HTMLElement | null = null
      const onCreateNew = vi.fn(() => {
        popoverAtCallback = screen.queryByPlaceholderText('Search')
      })

      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onCreateNew={onCreateNew}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
        />
      )
      openPopover()

      fireEvent.click(screen.getByRole('button', { name: 'Create new' }))

      await waitFor(() => expect(onCreateNew).toHaveBeenCalledTimes(1))
      expect(popoverAtCallback).toBeNull()
    })

    it('renders the create action without a trailing icon', () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          onCreateNew={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
        />
      )
      openPopover()

      expect(screen.getByRole('button', { name: 'Create new' }).querySelector('.lucide-chevron-right')).toBeNull()
    })
  })

  describe('disabled rows', () => {
    it('ignores click on aria-disabled rows', () => {
      const onChange = vi.fn()
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
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

  describe('search', () => {
    it('exposes active descendant state from the focused search input', () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
        />
      )
      openPopover()

      const searchInput = screen.getByPlaceholderText('Search')
      const listbox = screen.getByRole('listbox')
      const alphaOption = getRow('Alpha')

      expect(searchInput).toHaveAttribute('aria-controls', listbox.id)
      expect(searchInput).toHaveAttribute('aria-activedescendant', alphaOption.id)
      expect(listbox).not.toHaveAttribute('aria-activedescendant')
    })

    it('keeps caller item order instead of applying client-side sort', () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={[ITEMS[1], ITEMS[0], ITEMS[2]]} // Beta, Alpha, Gamma
          pinnedIds={[]}
          onTogglePin={vi.fn()}
          labels={LABELS}
          value={null}
          onChange={vi.fn()}
        />
      )
      openPopover()
      const options = screen.getAllByRole('option')
      expect(options[0]).toHaveTextContent('Beta')
      expect(options[1]).toHaveTextContent('Alpha')
      expect(options[2]).toHaveTextContent('Gamma')
    })

    it('filters by name (case-insensitive) and by description', () => {
      render(
        <ResourceSelectorShell
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          pinnedIds={[]}
          onTogglePin={vi.fn()}
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
