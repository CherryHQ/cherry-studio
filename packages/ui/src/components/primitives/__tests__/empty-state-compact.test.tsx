// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { KeyRound } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EmptyNote, EmptyPlaceholder, EmptyStateRow } from '../empty-state-compact'

afterEach(() => {
  cleanup()
})

describe('compact empty templates', () => {
  it('keeps the row text readable while its icon stays out of the accessibility tree', () => {
    const { container } = render(<EmptyStateRow icon={KeyRound}>No API key</EmptyStateRow>)

    expect(screen.getByText('No API key')).toBeVisible()
    for (const svg of container.querySelectorAll('svg')) {
      expect(svg).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('renders the placeholder title, description and a working action beside a hidden mark', () => {
    const onCreate = vi.fn()
    const { container } = render(
      <EmptyPlaceholder
        title="File not found."
        description="Read-only workspace"
        action={
          <button type="button" onClick={onCreate}>
            Create file
          </button>
        }
      />
    )

    expect(screen.getByText('File not found.')).toBeInTheDocument()
    expect(screen.getByText('Read-only workspace')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Create file' }))
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(container.querySelector('[data-slot="empty-state-mark"]')).toHaveAttribute('aria-hidden', 'true')
  })

  it('shows a note with arbitrary content and a decorative icon', () => {
    const { container } = render(
      <EmptyNote>
        No logs yet <a href="#logs">Open logs</a>
      </EmptyNote>
    )

    expect(screen.getByRole('link', { name: 'Open logs' })).toBeInTheDocument()
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })
})
