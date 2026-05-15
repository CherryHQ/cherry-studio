import type { Citation } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CitationsList, { CitationsPanelContent } from '../CitationsList'

const mocks = vi.hoisted(() => ({
  openCitationsPanel: vi.fn()
}))

vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({
    openCitationsPanel: mocks.openCitationsPanel
  })
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, onClick, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Scrollbar: ({ children, className }: React.HTMLAttributes<HTMLDivElement>) => (
    <div data-testid="citations-scrollbar" className={className}>
      {children}
    </div>
  ),
  Skeleton: () => <div />
}))

vi.mock('@tanstack/react-query', () => ({
  QueryClient: vi.fn(),
  QueryClientProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useQuery: () => ({ data: '', isLoading: false })
}))

vi.mock('@renderer/components/Icons/FallbackFavicon', () => ({
  default: ({ alt }: { alt?: string }) => <span>{alt}</span>
}))

vi.mock('@renderer/components/SelectionContextMenu', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>
}))

vi.mock('lucide-react', () => ({
  Check: () => <span>check</span>,
  Copy: () => <span>copy</span>,
  FileSearch: () => <span>file</span>
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) => (key === 'message.citation' ? `${params?.count} citations` : key)
  })
}))

describe('CitationsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the page side panel with the current citations', () => {
    const citations: Citation[] = [
      { number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' },
      { number: 2, url: '/tmp/doc.md', title: 'doc.md', type: 'knowledge' }
    ]

    render(<CitationsList citations={citations} />)

    fireEvent.click(screen.getByRole('button', { name: /2 citations/i }))

    expect(mocks.openCitationsPanel).toHaveBeenCalledTimes(1)
    expect(mocks.openCitationsPanel).toHaveBeenCalledWith({ citations })
  })

  it('lets the panel content fill the side panel body', () => {
    const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }]

    render(<CitationsPanelContent citations={citations} openPath={vi.fn()} />)

    expect(screen.getByTestId('citations-scrollbar')).toHaveClass('min-h-0', 'flex-1')
  })
})
