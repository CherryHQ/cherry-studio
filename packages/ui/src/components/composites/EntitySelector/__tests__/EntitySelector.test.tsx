// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { EntitySelector } from '../EntitySelector'
import type { EntitySelectorRowContext } from '../types'

type Item = { id: string; label: string; disabled?: boolean }

const ITEMS: Item[] = [
  { id: '1', label: 'Alpha' },
  { id: '2', label: 'Beta' },
  { id: '3', label: 'Gamma' },
  { id: '4', label: 'Delta', disabled: true },
  { id: '5', label: 'Epsilon' }
]

function Row({ item, ctx }: { item: Item; ctx: EntitySelectorRowContext }) {
  return (
    <button
      type="button"
      data-testid={`row-${item.id}`}
      data-selected={ctx.isSelected || undefined}
      data-active={ctx.isActive || undefined}
      onClick={ctx.onSelect}
      onContextMenu={ctx.onContextMenu}
      disabled={item.disabled}>
      {item.label}
    </button>
  )
}

// JSDOM doesn't implement these — Radix Popover and our scrollIntoView need them.
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

describe('EntitySelector', () => {
  describe('single mode', () => {
    it('renders items and selects on click, firing onChange with the id and closing', () => {
      const onChange = vi.fn()
      const onOpenChange = vi.fn()
      render(
        <EntitySelector
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          mode="single"
          value={null}
          onChange={onChange}
          onOpenChange={onOpenChange}
          renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
        />
      )
      openPopover()
      expect(screen.getByTestId('row-1')).toBeInTheDocument()
      fireEvent.click(screen.getByTestId('row-2'))
      expect(onChange).toHaveBeenCalledWith('2')
      // onOpenChange fires with false after selection
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('marks the current value as selected', () => {
      render(
        <EntitySelector
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          mode="single"
          value="3"
          onChange={vi.fn()}
          renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
        />
      )
      openPopover()
      expect(screen.getByTestId('row-3')).toHaveAttribute('data-selected', 'true')
      expect(screen.getByTestId('row-1')).not.toHaveAttribute('data-selected')
    })

    it('ignores clicks on disabled items', () => {
      const onChange = vi.fn()
      render(
        <EntitySelector
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          mode="single"
          value={null}
          onChange={onChange}
          renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
        />
      )
      openPopover()
      // Row disabled via prop — button is disabled so click is a no-op
      fireEvent.click(screen.getByTestId('row-4'))
      expect(onChange).not.toHaveBeenCalled()
    })
  })

  describe('multi mode', () => {
    it('with toggle off, click replaces the array and closes', () => {
      const onChange = vi.fn()
      const onOpenChange = vi.fn()
      render(
        <EntitySelector
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          mode="multi"
          value={['1']}
          onChange={onChange}
          onOpenChange={onOpenChange}
          renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
        />
      )
      openPopover()
      fireEvent.click(screen.getByTestId('row-2'))
      expect(onChange).toHaveBeenCalledWith(['2'])
      expect(onOpenChange).toHaveBeenCalledWith(false)
    })

    it('with toggle on, click toggles membership and stays open', () => {
      const onChange = vi.fn()
      const onOpenChange = vi.fn()
      render(
        <EntitySelector
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          mode="multi"
          value={['1']}
          onChange={onChange}
          onOpenChange={onOpenChange}
          multiSelect={{ enabled: true, onEnabledChange: vi.fn(), label: 'Multi' }}
          renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
        />
      )
      openPopover()
      fireEvent.click(screen.getByTestId('row-2'))
      expect(onChange).toHaveBeenCalledWith(['1', '2'])
      // No close after a multi-toggle add
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
      // Toggle an already-selected off
      onChange.mockClear()
      fireEvent.click(screen.getByTestId('row-1'))
      expect(onChange).toHaveBeenCalledWith([])
    })
  })

  describe('search', () => {
    it('exposes a controlled search input', () => {
      const onSearchChange = vi.fn()
      render(
        <EntitySelector
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          mode="single"
          value={null}
          onChange={vi.fn()}
          search={{ value: 'bet', onChange: onSearchChange, placeholder: 'Search' }}
          renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
        />
      )
      openPopover()
      const input = screen.getByPlaceholderText('Search') as HTMLInputElement
      expect(input.value).toBe('bet')
      fireEvent.change(input, { target: { value: 'gam' } })
      expect(onSearchChange).toHaveBeenCalledWith('gam')
    })
  })

  describe('filter panel', () => {
    it('is internally managed — clicking the toggle reveals and hides the panel', () => {
      render(
        <EntitySelector
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          mode="single"
          value={null}
          onChange={vi.fn()}
          search={{ value: '', onChange: vi.fn() }}
          filterPanel={<div data-testid="filter-panel">filter</div>}
          renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
        />
      )
      openPopover()
      expect(screen.queryByTestId('filter-panel')).not.toBeInTheDocument()
      // The filter toggle is the only aria-pressed button in the header
      const toggle = screen.getByRole('button', { pressed: false })
      fireEvent.click(toggle)
      expect(screen.getByTestId('filter-panel')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { pressed: true }))
      expect(screen.queryByTestId('filter-panel')).not.toBeInTheDocument()
    })
  })

  describe('empty & loading', () => {
    it('renders emptyState when items is empty', () => {
      render(
        <EntitySelector
          trigger={<button type="button">Open</button>}
          items={[]}
          mode="single"
          value={null}
          onChange={vi.fn()}
          emptyState={<div data-testid="empty">No matches</div>}
          renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
        />
      )
      openPopover()
      expect(screen.getByTestId('empty')).toBeInTheDocument()
    })

    it('renders loadingState when loading is true', () => {
      render(
        <EntitySelector
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          mode="single"
          value={null}
          onChange={vi.fn()}
          loading
          loadingState={<div data-testid="loading">Loading</div>}
          renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
        />
      )
      openPopover()
      expect(screen.getByTestId('loading')).toBeInTheDocument()
      expect(screen.queryByTestId('row-1')).not.toBeInTheDocument()
    })

    it('renders nothing when empty without emptyState (no hardcoded fallback)', () => {
      render(
        <EntitySelector
          trigger={<button type="button">Open</button>}
          items={[]}
          mode="single"
          value={null}
          onChange={vi.fn()}
          renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
        />
      )
      openPopover()
      expect(screen.queryByText(/no items/i)).not.toBeInTheDocument()
    })
  })

  describe('keyboard navigation', () => {
    it('ArrowDown moves active and Enter selects, skipping disabled items', () => {
      const onChange = vi.fn()
      render(
        <EntitySelector
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          mode="single"
          value={null}
          onChange={onChange}
          renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
        />
      )
      openPopover()
      const listbox = screen.getByRole('listbox')
      // Initial active should be first enabled (id=1)
      expect(screen.getByTestId('row-1').parentElement).toHaveAttribute('data-active', 'true')
      // Move to 2, 3, then skip disabled 4 → 5
      fireEvent.keyDown(listbox, { key: 'ArrowDown' })
      fireEvent.keyDown(listbox, { key: 'ArrowDown' })
      fireEvent.keyDown(listbox, { key: 'ArrowDown' })
      // Active should be Epsilon (id=5), because Delta (id=4) is disabled
      expect(screen.getByTestId('row-5').parentElement).toHaveAttribute('data-active', 'true')
      fireEvent.keyDown(listbox, { key: 'Enter' })
      expect(onChange).toHaveBeenCalledWith('5')
    })

    it('ArrowUp wraps and End jumps to last enabled', () => {
      render(
        <EntitySelector
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          mode="single"
          value={null}
          onChange={vi.fn()}
          renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
        />
      )
      openPopover()
      const listbox = screen.getByRole('listbox')
      fireEvent.keyDown(listbox, { key: 'End' })
      expect(screen.getByTestId('row-5').parentElement).toHaveAttribute('data-active', 'true')
      fireEvent.keyDown(listbox, { key: 'ArrowDown' }) // wrap → 1
      expect(screen.getByTestId('row-1').parentElement).toHaveAttribute('data-active', 'true')
      fireEvent.keyDown(listbox, { key: 'ArrowUp' }) // wrap back → 5 (skipping disabled 4)
      expect(screen.getByTestId('row-5').parentElement).toHaveAttribute('data-active', 'true')
    })

    it('Escape closes the filter panel before closing the popover', () => {
      const onOpenChange = vi.fn()
      render(
        <EntitySelector
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          mode="single"
          value={null}
          onChange={vi.fn()}
          search={{ value: '', onChange: vi.fn() }}
          filterPanel={<div data-testid="filter-panel">filter</div>}
          onOpenChange={onOpenChange}
          renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
        />
      )
      openPopover()
      // Open filter panel
      fireEvent.click(screen.getByRole('button', { pressed: false }))
      expect(screen.getByTestId('filter-panel')).toBeInTheDocument()
      onOpenChange.mockClear()
      fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' })
      expect(screen.queryByTestId('filter-panel')).not.toBeInTheDocument()
      // Popover itself should not close on this first Escape
      expect(onOpenChange).not.toHaveBeenCalledWith(false)
    })
  })

  describe('right-click menu', () => {
    it('renders the factory output on contextmenu and closes via ctx.close', () => {
      const factory = vi.fn((item: Item, ctx: { close: () => void }) => (
        <button type="button" data-testid="ctx-close" onClick={ctx.close}>
          Pin {item.label}
        </button>
      ))
      render(
        <EntitySelector
          trigger={<button type="button">Open</button>}
          items={ITEMS}
          mode="single"
          value={null}
          onChange={vi.fn()}
          renderItemContextMenu={factory}
          renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
        />
      )
      openPopover()
      fireEvent.contextMenu(screen.getByTestId('row-2'))
      expect(screen.getByTestId('ctx-close')).toBeInTheDocument()
      expect(factory).toHaveBeenCalled()
      fireEvent.click(screen.getByTestId('ctx-close'))
      expect(screen.queryByTestId('ctx-close')).not.toBeInTheDocument()
    })
  })

  describe('controlled open', () => {
    it('external open prop wins over internal state', () => {
      function Controlled() {
        const [open, setOpen] = useState(false)
        return (
          <>
            <button type="button" data-testid="external" onClick={() => setOpen(true)}>
              external-open
            </button>
            <EntitySelector
              open={open}
              onOpenChange={setOpen}
              trigger={<button type="button">Open</button>}
              items={ITEMS}
              mode="single"
              value={null}
              onChange={vi.fn()}
              renderItem={(item, ctx) => <Row item={item} ctx={ctx} />}
            />
          </>
        )
      }
      render(<Controlled />)
      expect(screen.queryByTestId('row-1')).not.toBeInTheDocument()
      act(() => {
        fireEvent.click(screen.getByTestId('external'))
      })
      expect(screen.getByTestId('row-1')).toBeInTheDocument()
    })
  })
})
