import type { Citation } from '@renderer/types/message'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import { SWRConfig } from 'swr'
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

const fetchMocks = vi.hoisted(() => ({
  fetchWebContent: vi.fn(),
  fetchXOEmbed: vi.fn(),
  isXPostUrl: vi.fn()
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

// Real SWR drives the web-content / oEmbed reads now (react-query is gone); mock the
// fetch utilities so no network happens and we can drive degrade / dedup behavior.
vi.mock('@renderer/utils/fetch', () => ({
  fetchWebContent: fetchMocks.fetchWebContent,
  fetchXOEmbed: fetchMocks.fetchXOEmbed,
  isXPostUrl: fetchMocks.isXPostUrl,
  noContent: 'No content found',
  xOembedKey: (url: string) => `xOembed/${url}`
}))

vi.mock('@renderer/components/icons/FallbackFavicon', () => ({
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

// Isolate SWR's global cache per render so cached web-content does not bleed across tests.
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

describe('CitationsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMocks.isXPostUrl.mockReturnValue(false)
    fetchMocks.fetchXOEmbed.mockResolvedValue(null)
    fetchMocks.fetchWebContent.mockResolvedValue({
      title: 'Example',
      url: 'https://example.com',
      content: 'web preview content'
    })
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

  it('lets the panel content fill the side panel body', async () => {
    const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }]

    render(<CitationsPanelContent citations={citations} actions={{ openPath: vi.fn() }} />, { wrapper })

    expect(screen.getByTestId('citations-scrollbar')).toHaveClass('min-h-0', 'flex-1')
    await waitFor(() => expect(fetchMocks.fetchWebContent).toHaveBeenCalled())
  })

  it('opens panel web citations through the supplied external URL action', async () => {
    const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }]
    const openExternalUrl = vi.fn()

    render(<CitationsPanelContent citations={citations} actions={{ openPath: vi.fn(), openExternalUrl }} />, {
      wrapper
    })

    fireEvent.click(screen.getByRole('link', { name: 'Example' }))

    expect(openExternalUrl).toHaveBeenCalledTimes(1)
    expect(openExternalUrl).toHaveBeenCalledWith('https://example.com')
    await waitFor(() => expect(fetchMocks.fetchWebContent).toHaveBeenCalled())
  })

  it('renders web citations without a url as non-links', () => {
    const citations: Citation[] = [
      { number: 1, url: '', title: 'No URL Source', content: 'Reference text', type: 'websearch' }
    ]

    render(<CitationsPanelContent citations={citations} actions={{ openPath: vi.fn() }} />, { wrapper })

    const title = screen.getByText('No URL Source')
    expect(title).toBeInTheDocument()
    expect(title.closest('a')).toBeNull()
    // Empty url → null SWR key → no fetch.
    expect(fetchMocks.fetchWebContent).not.toHaveBeenCalled()
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

    render(<CitationsPanelContent citations={citations} actions={{ copyText, notifyError }} />, { wrapper })

    fireEvent.click(screen.getByText('copy'))

    expect(copyText).toHaveBeenCalledTimes(1)
    expect(copyText).toHaveBeenCalledWith('citation content', { successMessage: 'common.copied' })
    expect(await screen.findByText('check')).toBeInTheDocument()
  })

  it('renders the fetched web-content preview snippet', async () => {
    const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }]

    render(<CitationsPanelContent citations={citations} actions={{ openPath: vi.fn() }} />, { wrapper })

    expect(await screen.findByText('web preview content')).toBeInTheDocument()
  })

  it('hides the preview snippet when web-content fetch degrades to noContent', async () => {
    fetchMocks.fetchWebContent.mockResolvedValue({
      title: 'Example',
      url: 'https://example.com',
      content: 'No content found'
    })
    const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }]

    render(<CitationsPanelContent citations={citations} actions={{ openPath: vi.fn() }} />, { wrapper })

    await waitFor(() => expect(fetchMocks.fetchWebContent).toHaveBeenCalled())
    // Graceful degrade: only the title/link remain, no "No content found" placeholder snippet.
    expect(screen.queryByText('No content found')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Example' })).toBeInTheDocument()
  })

  it('copies the truncated preview snippet, not the full content', async () => {
    fetchMocks.fetchWebContent.mockResolvedValue({
      title: 'Example',
      url: 'https://example.com',
      content: 'A'.repeat(250)
    })
    const copyText = vi.fn().mockResolvedValue(undefined)
    mocks.messageListActions = { copyText, notifyError: mocks.notifyError }
    const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }]

    render(<CitationsPanelContent citations={citations} />, { wrapper })

    fireEvent.click(await screen.findByText('copy'))

    expect(copyText).toHaveBeenCalledTimes(1)
    const copied = copyText.mock.calls[0][0] as string
    expect(copied.length).toBeLessThanOrEqual(103) // 100 chars + '...'
    expect(await screen.findByText('check')).toBeInTheDocument()
  })

  it('dedupes web-content fetches for the same URL via the shared SWR cache', async () => {
    // Two consumers of the same URL share one fetch — the mechanism the citation
    // tooltip relies on to reuse the panel's already-fetched oEmbed result.
    const a: Citation = { number: 1, url: 'https://dup.com', title: 'A', type: 'websearch' }
    const b: Citation = { number: 2, url: 'https://dup.com', title: 'B', type: 'websearch' }

    render(
      <>
        <CitationsPanelContent citations={[a]} actions={{ openPath: vi.fn() }} />
        <CitationsPanelContent citations={[b]} actions={{ openPath: vi.fn() }} />
      </>,
      { wrapper }
    )

    await waitFor(() => expect(screen.getByRole('link', { name: 'B' })).toBeInTheDocument())
    expect(fetchMocks.fetchWebContent).toHaveBeenCalledTimes(1)
  })
})
