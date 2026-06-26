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
    ),
    trailingLabel: 'Added'
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
    expect(screen.getByText('Added')).toBeInTheDocument()

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

  it('caps the preview before search while keeping the full list searchable', () => {
    const items: ConversationPickerItem[] = [
      ITEMS[0],
      ...Array.from({ length: 55 }, (_, index) => ({
        id: `catalog:${index}`,
        name: index === 54 ? 'Hidden Specialist' : `Catalog Preset ${index + 1}`,
        searchText: index === 54 ? 'deep-hidden-prompt' : undefined,
        icon: <span className="text-base leading-none">🤖</span>
      }))
    ]

    render(
      <ConversationPickerDialog
        open
        onOpenChange={vi.fn()}
        items={items}
        labels={LABELS}
        previewLimit={50}
        onSelect={vi.fn()}
      />
    )

    expect(screen.queryByText('Hidden Specialist')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Search resources'), { target: { value: 'deep-hidden-prompt' } })

    expect(screen.getByText('Hidden Specialist')).toBeInTheDocument()
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
