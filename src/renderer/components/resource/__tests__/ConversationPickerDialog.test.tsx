import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof CherryStudioUi>()
  return actual
})

import {
  ConversationPickerDialog,
  type ConversationPickerItem,
  type ConversationPickerLabels
} from '../ConversationPickerDialog'

const ITEMS: ConversationPickerItem[] = [
  {
    id: 'assistant:alpha',
    name: 'Alpha Assistant',
    icon: (
      <span data-testid="alpha-icon" className="text-base leading-none">
        🙂
      </span>
    )
  },
  {
    id: 'catalog:product',
    name: 'Product Manager',
    searchText: 'roadmap prioritization',
    icon: <span className="text-base leading-none">🧑‍💼</span>
  },
  {
    id: 'agent:build',
    name: 'Build Agent',
    searchText: 'runs tasks',
    icon: <span className="text-base leading-none">🤖</span>
  }
]

const LABELS: ConversationPickerLabels = {
  title: 'Add Assistant',
  description: 'Choose a resource',
  searchPlaceholder: 'Search resources',
  emptyText: 'No resources',
  loadingText: 'Loading'
}

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

describe('ConversationPickerDialog', () => {
  it('renders items in order and selects an item', () => {
    const onSelect = vi.fn()

    render(<ConversationPickerDialog open onOpenChange={vi.fn()} items={ITEMS} labels={LABELS} onSelect={onSelect} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Alpha Assistant')).toBeInTheDocument()

    // The list scrolls inside the shared Scrollbar viewport (auto-hiding thumb), not the cmdk list.
    expect(screen.getByText('Alpha Assistant').closest('[data-scrolling]')).toBeInTheDocument()

    const leadingSlot = screen.getByTestId('alpha-icon').parentElement
    expect(leadingSlot).toHaveClass('size-6', 'rounded-lg', 'text-foreground/70')
    expect(leadingSlot).not.toHaveClass('rounded-full', 'bg-secondary')

    fireEvent.click(screen.getByText('Product Manager'))

    expect(onSelect).toHaveBeenCalledWith(ITEMS[1])
  })

  it('can hide the dialog close button', () => {
    render(
      <ConversationPickerDialog
        open
        onOpenChange={vi.fn()}
        items={ITEMS}
        labels={LABELS}
        showCloseButton={false}
        onSelect={vi.fn()}
      />
    )

    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  it('filters by name and search text', () => {
    render(<ConversationPickerDialog open onOpenChange={vi.fn()} items={ITEMS} labels={LABELS} onSelect={vi.fn()} />)

    fireEvent.change(screen.getByPlaceholderText('Search resources'), { target: { value: 'roadmap' } })

    expect(screen.getByText('Product Manager')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Assistant')).not.toBeInTheDocument()
    expect(screen.queryByText('Build Agent')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search resources'), { target: { value: 'alpha' } })

    expect(screen.getByText('Alpha Assistant')).toBeInTheDocument()
    expect(screen.queryByText('Product Manager')).not.toBeInTheDocument()
  })

  it('pins the create action at the top, triggers it, and hides it while searching', () => {
    const onCreateNew = vi.fn()

    render(
      <ConversationPickerDialog
        open
        onOpenChange={vi.fn()}
        items={ITEMS}
        labels={LABELS}
        createAction={{ label: 'New Assistant', icon: <span data-testid="create-icon">+</span>, onSelect: onCreateNew }}
        onSelect={vi.fn()}
      />
    )

    const createRow = screen.getByText('New Assistant')
    // Pinned above the first item.
    const firstItem = screen.getByText('Alpha Assistant')
    expect(createRow.compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(createRow)
    expect(onCreateNew).toHaveBeenCalledTimes(1)

    // Hidden while searching so the query's first match keeps the keyboard default.
    fireEvent.change(screen.getByPlaceholderText('Search resources'), { target: { value: 'roadmap' } })
    expect(screen.queryByText('New Assistant')).not.toBeInTheDocument()
    expect(screen.getByText('Product Manager')).toBeInTheDocument()
  })

  it('renders a toolbar slot above the list', () => {
    render(
      <ConversationPickerDialog
        open
        onOpenChange={vi.fn()}
        items={ITEMS}
        labels={LABELS}
        toolbar={<div data-testid="picker-toolbar">tabs</div>}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByTestId('picker-toolbar')).toBeInTheDocument()
  })

  it('pages the list and grows the window on scroll when pageSize is set', () => {
    const items: ConversationPickerItem[] = Array.from({ length: 12 }, (_, index) => ({
      id: `item-${index}`,
      name: `Item ${index}`,
      icon: <span className="text-base leading-none">•</span>
    }))

    render(
      <ConversationPickerDialog
        open
        onOpenChange={vi.fn()}
        items={items}
        labels={LABELS}
        pageSize={5}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByText('Item 4')).toBeInTheDocument()
    expect(screen.queryByText('Item 5')).not.toBeInTheDocument()

    // jsdom reports zero layout metrics, so a scroll event always crosses the bottom threshold.
    const scroller = screen.getByText('Item 0').closest('[data-scrolling]') as HTMLElement
    fireEvent.scroll(scroller)

    expect(screen.getByText('Item 9')).toBeInTheDocument()
    expect(screen.queryByText('Item 11')).not.toBeInTheDocument()

    fireEvent.scroll(scroller)

    expect(screen.getByText('Item 11')).toBeInTheDocument()
  })

  it('renders loading and empty states', () => {
    const { rerender } = render(
      <ConversationPickerDialog open onOpenChange={vi.fn()} items={[]} labels={LABELS} isLoading onSelect={vi.fn()} />
    )

    expect(screen.getByRole('status')).toHaveTextContent('Loading')

    rerender(<ConversationPickerDialog open onOpenChange={vi.fn()} items={[]} labels={LABELS} onSelect={vi.fn()} />)

    expect(screen.getByText('No resources')).toBeInTheDocument()
  })
})
