import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

  it('closes when clicking the overlay', () => {
    const onOpenChange = vi.fn()

    render(
      <ConversationPickerDialog open onOpenChange={onOpenChange} items={ITEMS} labels={LABELS} onSelect={vi.fn()} />
    )

    const overlay = document.querySelector('[data-slot="dialog-overlay"]')
    expect(overlay).toBeInTheDocument()

    fireEvent.click(overlay!)

    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('keeps search focus through reverse navigation and filters from immediate typing', async () => {
    const user = userEvent.setup()

    render(<ConversationPickerDialog open onOpenChange={vi.fn()} items={ITEMS} labels={LABELS} onSelect={vi.fn()} />)

    const searchInput = screen.getByPlaceholderText('Search resources')
    await waitFor(() => expect(searchInput).toHaveFocus())

    await user.tab({ shift: true })
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.tab()
    expect(searchInput).toHaveFocus()

    await user.keyboard('roadmap')

    expect(searchInput).toHaveValue('roadmap')
    expect(screen.getByText('Product Manager')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Assistant')).not.toBeInTheDocument()
    expect(screen.queryByText('Build Agent')).not.toBeInTheDocument()

    fireEvent.change(searchInput, { target: { value: 'alpha' } })

    expect(screen.getByText('Alpha Assistant')).toBeInTheDocument()
    expect(screen.queryByText('Product Manager')).not.toBeInTheDocument()
  })

  it('pins the create action at the top and keeps it while searching', () => {
    const onCreateNew = vi.fn()

    render(
      <ConversationPickerDialog
        open
        onOpenChange={vi.fn()}
        items={ITEMS}
        labels={LABELS}
        createAction={{
          row: (query) =>
            query
              ? { icon: <span data-testid="create-icon">💬</span>, title: query, tag: 'New' }
              : { icon: <span data-testid="create-icon">+</span>, title: 'New Assistant' },
          onSelect: onCreateNew
        }}
        onSelect={vi.fn()}
      />
    )

    const createRow = screen.getByText('New Assistant')
    // Pinned above the first item.
    const firstItem = screen.getByText('Alpha Assistant')
    expect(createRow.compareDocumentPosition(firstItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    fireEvent.click(createRow)
    expect(onCreateNew).toHaveBeenCalledWith('')

    // Still there while searching — now it previews the row it would create: the query as the title
    // plus a tag, rather than a sentence repeating what the search box already shows.
    fireEvent.change(screen.getByPlaceholderText('Search resources'), { target: { value: 'roadmap' } })
    const namedRow = screen.getByText('roadmap').closest('[cmdk-item]')
    expect(namedRow).toBeInTheDocument()
    expect(namedRow).toHaveTextContent('New')
    expect(screen.getByText('Product Manager')).toBeInTheDocument()

    fireEvent.click(screen.getByText('roadmap'))
    expect(onCreateNew).toHaveBeenLastCalledWith('roadmap')
  })

  it('offers the create action instead of the empty state when a query matches nothing', () => {
    const onCreateNew = vi.fn()

    const { rerender } = render(
      <ConversationPickerDialog
        open
        onOpenChange={vi.fn()}
        items={ITEMS}
        labels={LABELS}
        createAction={{ row: (query) => ({ title: `New "${query}"` }), onSelect: onCreateNew }}
        onSelect={vi.fn()}
      />
    )

    fireEvent.change(screen.getByPlaceholderText('Search resources'), { target: { value: 'brand new name' } })

    expect(screen.getByText('New "brand new name"')).toBeInTheDocument()
    expect(screen.queryByText('No resources')).not.toBeInTheDocument()

    // Without a create action there is nothing to offer, so the empty state stays.
    rerender(<ConversationPickerDialog open onOpenChange={vi.fn()} items={ITEMS} labels={LABELS} onSelect={vi.fn()} />)
    expect(screen.getByText('No resources')).toBeInTheDocument()
  })

  it('drops the create row once the query names an item that already exists', () => {
    render(
      <ConversationPickerDialog
        open
        onOpenChange={vi.fn()}
        items={ITEMS}
        labels={LABELS}
        createAction={{ row: (query) => ({ title: `New "${query}"` }), onSelect: vi.fn() }}
        onSelect={vi.fn()}
      />
    )

    const searchInput = screen.getByPlaceholderText('Search resources')

    // A partial name still offers to create — "Alpha" is not an assistant the user has.
    fireEvent.change(searchInput, { target: { value: 'Alpha' } })
    expect(screen.getByText('New "Alpha"')).toBeInTheDocument()

    // Typing the full name would put an identical-looking row directly above the real one.
    fireEvent.change(searchInput, { target: { value: '  alpha assistant  ' } })
    expect(screen.queryByText(/^New "/)).not.toBeInTheDocument()
    expect(screen.getByText('Alpha Assistant')).toBeInTheDocument()
  })

  it('withholds the Enter fallback while the item list is still loading', async () => {
    const user = userEvent.setup()
    const onCreateNew = vi.fn()
    const onSelect = vi.fn()

    const { rerender } = render(
      <ConversationPickerDialog
        open
        onOpenChange={vi.fn()}
        items={[]}
        labels={LABELS}
        isLoading
        createAction={{ row: (query) => ({ title: `New "${query}"` }), onSelect: onCreateNew }}
        onSelect={vi.fn()}
      />
    )

    const searchInput = screen.getByPlaceholderText('Search resources')
    await waitFor(() => expect(searchInput).toHaveFocus())

    // An empty result set mid-load means "matches unknown", not "nothing matched".
    await user.keyboard('roadmap')
    await user.keyboard('{Enter}')
    expect(onCreateNew).not.toHaveBeenCalled()

    // Once the items land, the usual rules resume — here the query matches, so Enter picks that match.
    rerender(
      <ConversationPickerDialog
        open
        onOpenChange={vi.fn()}
        items={ITEMS}
        labels={LABELS}
        createAction={{ row: (query) => ({ title: `New "${query}"` }), onSelect: onCreateNew }}
        onSelect={onSelect}
      />
    )
    await waitFor(() =>
      expect(screen.getByText('Product Manager').closest('[cmdk-item]')).toHaveAttribute('aria-selected', 'true')
    )

    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1])
    expect(onCreateNew).not.toHaveBeenCalled()
  })

  it('keeps Enter on the first match while searching and falls back to create when nothing matches', async () => {
    const user = userEvent.setup()
    const onCreateNew = vi.fn()
    const onSelect = vi.fn()

    render(
      <ConversationPickerDialog
        open
        onOpenChange={vi.fn()}
        items={ITEMS}
        labels={LABELS}
        createAction={{ row: (query) => ({ title: `New "${query}"` }), onSelect: onCreateNew }}
        onSelect={onSelect}
      />
    )

    const searchInput = screen.getByPlaceholderText('Search resources')
    await waitFor(() => expect(searchInput).toHaveFocus())

    // The create row is pinned above the results, but the query's first match keeps the highlight.
    await user.keyboard('roadmap')
    await waitFor(() =>
      expect(screen.getByText('Product Manager').closest('[cmdk-item]')).toHaveAttribute('aria-selected', 'true')
    )

    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(ITEMS[1])
    expect(onCreateNew).not.toHaveBeenCalled()

    // Nothing left to match → the create row inherits the highlight and Enter creates.
    fireEvent.change(searchInput, { target: { value: 'brand new name' } })
    await waitFor(() =>
      expect(screen.getByText('New "brand new name"').closest('[cmdk-item]')).toHaveAttribute('aria-selected', 'true')
    )

    await user.keyboard('{Enter}')
    expect(onCreateNew).toHaveBeenCalledWith('brand new name')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('lets the arrow keys reach the create row while a query still matches', async () => {
    const user = userEvent.setup()

    render(
      <ConversationPickerDialog
        open
        onOpenChange={vi.fn()}
        items={ITEMS}
        labels={LABELS}
        createAction={{ row: (query) => ({ title: `New "${query}"` }), onSelect: vi.fn() }}
        onSelect={vi.fn()}
      />
    )

    const searchInput = screen.getByPlaceholderText('Search resources')
    await waitFor(() => expect(searchInput).toHaveFocus())
    await user.keyboard('roadmap')
    await waitFor(() =>
      expect(screen.getByText('Product Manager').closest('[cmdk-item]')).toHaveAttribute('aria-selected', 'true')
    )

    // The highlight is only steered away from the create row when cmdk lands there by position —
    // the user walking onto it must stick.
    await user.keyboard('{ArrowUp}')
    await waitFor(() =>
      expect(screen.getByText('New "roadmap"').closest('[cmdk-item]')).toHaveAttribute('aria-selected', 'true')
    )
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
