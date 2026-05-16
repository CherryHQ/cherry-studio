import type { Citation } from '@renderer/types'
import { fireEvent, render, screen } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CitationsList, { CitationsPanelContent } from '../CitationsList'

const mocks = vi.hoisted(() => ({
  openCitationsPanel: vi.fn(),
  copyText: vi.fn(),
  notifyError: vi.fn(),
  messageListActions: undefined as
    | {
        openCitationsPanel?: ReturnType<typeof vi.fn>
        copyText?: ReturnType<typeof vi.fn>
        notifyError?: ReturnType<typeof vi.fn>
      }
    | undefined
}))

vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => mocks.messageListActions
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
    mocks.messageListActions = {
      openCitationsPanel: mocks.openCitationsPanel,
      copyText: mocks.copyText,
      notifyError: mocks.notifyError
    }
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

    render(<CitationsPanelContent citations={citations} actions={{ openPath: vi.fn() }} />)

    expect(screen.getByTestId('citations-scrollbar')).toHaveClass('min-h-0', 'flex-1')
  })

  it('opens panel web citations through the supplied external URL action', () => {
    const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }]
    const openExternalUrl = vi.fn()

    render(<CitationsPanelContent citations={citations} actions={{ openPath: vi.fn(), openExternalUrl }} />)

    fireEvent.click(screen.getByRole('link', { name: 'Example' }))

    expect(openExternalUrl).toHaveBeenCalledTimes(1)
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com')
  })

  it('uses injected copy actions when rendered without a message list provider', async () => {
    mocks.messageListActions = undefined
    const copyText = vi.fn().mockResolvedValue(undefined)
    const notifyError = vi.fn()
    const citations: Citation[] = [
      {
        number: 1,
        url: '/tmp/doc.md',
        title: 'doc.md',
        type: 'knowledge',
        content: 'citation content'
      }
    ]

    render(<CitationsPanelContent citations={citations} actions={{ copyText, notifyError }} />)

    fireEvent.click(screen.getByText('copy'))

    expect(copyText).toHaveBeenCalledTimes(1)
    expect(copyText).toHaveBeenCalledWith('citation content', { successMessage: 'common.copied' })
    expect(await screen.findByText('check')).toBeInTheDocument()
  })
})
