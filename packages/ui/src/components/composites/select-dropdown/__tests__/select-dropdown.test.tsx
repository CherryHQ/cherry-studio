// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { SelectDropdown } from '../index'

type Item = { id: string; label: string }

const items: Item[] = [
  { id: '1', label: 'Alpha' },
  { id: '2', label: 'Beta' },
  { id: '3', label: 'Gamma' }
]

const defaultProps = {
  items,
  selectedId: null as string | null,
  onSelect: vi.fn(),
  renderSelected: (item: Item) => <span>{item.label}</span>,
  renderItem: (item: Item) => <span>{item.label}</span>
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SelectDropdown', () => {
  describe('trigger', () => {
    it('renders placeholder when nothing is selected', () => {
      render(<SelectDropdown {...defaultProps} placeholder="Pick one" />)
      expect(screen.getByText('Pick one')).toBeInTheDocument()
    })

    it('renders selected item in trigger', () => {
      render(<SelectDropdown {...defaultProps} selectedId="2" />)
      expect(screen.getByText('Beta')).toBeInTheDocument()
    })

    it('renders default placeholder when none provided and no selection', () => {
      render(<SelectDropdown {...defaultProps} />)
      expect(screen.getByText('...')).toBeInTheDocument()
    })
  })

  describe('dropdown interaction', () => {
    it('opens popover and shows items on trigger click', () => {
      render(<SelectDropdown {...defaultProps} />)
      // Click the trigger button to open
      fireEvent.click(screen.getByRole('button'))
      // All items should be visible
      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('Beta')).toBeInTheDocument()
      expect(screen.getByText('Gamma')).toBeInTheDocument()
    })

    it('calls onSelect when an item is clicked', () => {
      const onSelect = vi.fn()
      render(<SelectDropdown {...defaultProps} onSelect={onSelect} />)
      fireEvent.click(screen.getByRole('button'))
      fireEvent.click(screen.getByText('Alpha'))
      expect(onSelect).toHaveBeenCalledWith('1')
    })

    it('handles wheel scrolling for non-virtualized lists rendered inside modal dialogs', () => {
      render(<SelectDropdown {...defaultProps} />)
      fireEvent.click(screen.getByRole('button'))

      const scroller = screen.getByText('Alpha').closest('button')?.parentElement?.parentElement as HTMLDivElement
      Object.defineProperties(scroller, {
        clientHeight: { configurable: true, value: 20 },
        scrollHeight: { configurable: true, value: 100 },
        scrollTop: { configurable: true, writable: true, value: 0 }
      })

      fireEvent.wheel(scroller, { deltaY: 2, deltaMode: 1 })

      expect(scroller.scrollTop).toBe(32)
    })
  })

  describe('empty state', () => {
    it('shows emptyText when items array is empty', () => {
      render(<SelectDropdown {...defaultProps} items={[]} emptyText="Nothing here" />)
      fireEvent.click(screen.getByRole('button'))
      expect(screen.getByText('Nothing here')).toBeInTheDocument()
    })
  })

  describe('remove callback', () => {
    it('renders remove button and calls onRemove', () => {
      const onRemove = vi.fn()
      render(<SelectDropdown {...defaultProps} onRemove={onRemove} removeLabel="Delete" />)
      fireEvent.click(screen.getByRole('button'))
      // Find remove buttons by aria-label
      const removeBtns = screen.getAllByLabelText('Delete')
      expect(removeBtns).toHaveLength(3)
      fireEvent.click(removeBtns[0])
      expect(onRemove).toHaveBeenCalledWith('1')
    })
  })

  describe('renderTriggerLeading', () => {
    it('renders leading content in trigger', () => {
      render(<SelectDropdown {...defaultProps} renderTriggerLeading={<span>Icon</span>} />)
      expect(screen.getByText('Icon')).toBeInTheDocument()
    })
  })
})
