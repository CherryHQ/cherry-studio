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
  fetchXOEmbed: vi.fn(),
  isXPostUrl: vi.fn()
}))

const { ipcRequest } = vi.hoisted(() => ({
  ipcRequest: vi.fn()
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
  Skeleton: () => <div data-testid="citation-preview-loading" />
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipcRequest }
}))

// Real SWR drives the citation preview / oEmbed reads; mock the X utilities so no network happens.
vi.mock('@renderer/utils/fetch', () => ({
  fetchXOEmbed: fetchMocks.fetchXOEmbed,
  isXPostUrl: fetchMocks.isXPostUrl,
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

// Isolate SWR's global cache per render so cached previews do not bleed across tests.
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

describe('CitationsList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fetchMocks.isXPostUrl.mockReturnValue(false)
    fetchMocks.fetchXOEmbed.mockResolvedValue(null)
    ipcRequest.mockResolvedValue({ content: 'Fetched citation preview' })
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
    await waitFor(() => expect(ipcRequest).toHaveBeenCalled())
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
    await waitFor(() => expect(ipcRequest).toHaveBeenCalled())
  })

  it('renders web citations without a url as non-links', () => {
    const citations: Citation[] = [
      { number: 1, url: '', title: 'No URL Source', content: 'Reference text', type: 'websearch' }
    ]

    render(<CitationsPanelContent citations={citations} actions={{ openPath: vi.fn() }} />, { wrapper })

    const title = screen.getByText('No URL Source')
    expect(title).toBeInTheDocument()
    expect(title.closest('a')).toBeNull()
    // Empty url -> null SWR key -> no request.
    expect(ipcRequest).not.toHaveBeenCalled()
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

  it('requests and renders a regular citation preview through IpcApi', async () => {
    const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }]

    render(<CitationsPanelContent citations={citations} actions={{ openPath: vi.fn() }} />, { wrapper })

    expect(await screen.findByText('Fetched citation preview')).toBeInTheDocument()
    expect(ipcRequest).toHaveBeenCalledTimes(1)
    expect(ipcRequest).toHaveBeenCalledWith('citation.fetch_preview', { url: 'https://example.com' })
    expect(fetchMocks.fetchXOEmbed).not.toHaveBeenCalled()
  })

  it('keeps the title and link without a snippet when IpcApi returns empty content', async () => {
    ipcRequest.mockResolvedValue({ content: '' })
    const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }]

    render(<CitationsPanelContent citations={citations} actions={{ openPath: vi.fn() }} />, { wrapper })

    await waitFor(() => expect(ipcRequest).toHaveBeenCalledTimes(1))
    expect(screen.queryByText('No content found')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Example' })).toBeInTheDocument()
    expect(screen.queryByText('copy')).not.toBeInTheDocument()
  })

  it('keeps the title and link without a placeholder when IpcApi rejects', async () => {
    ipcRequest.mockRejectedValue(new Error('IPC unavailable'))
    const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }]

    render(<CitationsPanelContent citations={citations} />, { wrapper })

    expect(screen.getAllByTestId('citation-preview-loading')).toHaveLength(2)
    await waitFor(() => expect(screen.queryByTestId('citation-preview-loading')).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'Example' })).toBeInTheDocument()
    expect(screen.queryByText('No content found')).not.toBeInTheDocument()
    expect(screen.queryByText('copy')).not.toBeInTheDocument()
    expect(mocks.notifyError).not.toHaveBeenCalled()
    expect(ipcRequest).toHaveBeenCalledTimes(1)
  })

  it('keeps X citations on the renderer oEmbed path', async () => {
    fetchMocks.isXPostUrl.mockReturnValue(true)
    fetchMocks.fetchXOEmbed.mockResolvedValue({ author: 'author', text: 'post text' })
    const xUrl = 'https://x.com/author/status/123'
    const citations: Citation[] = [{ number: 1, url: xUrl, title: 'X post', type: 'websearch' }]

    render(<CitationsPanelContent citations={citations} />, { wrapper })

    expect(await screen.findByText('@author: post text')).toBeInTheDocument()
    expect(fetchMocks.fetchXOEmbed).toHaveBeenCalledWith(xUrl)
    expect(ipcRequest).not.toHaveBeenCalled()
  })

  it('truncates X citation previews to 100 characters', async () => {
    fetchMocks.isXPostUrl.mockReturnValue(true)
    fetchMocks.fetchXOEmbed.mockResolvedValue({ author: 'author', text: 'x'.repeat(110) })
    const xUrl = 'https://x.com/author/status/123'
    const citations: Citation[] = [{ number: 1, url: xUrl, title: 'X post', type: 'websearch' }]

    render(<CitationsPanelContent citations={citations} />, { wrapper })

    expect(await screen.findByText(`@author: ${'x'.repeat(91)}...`)).toBeInTheDocument()
    expect(screen.queryByText(`@author: ${'x'.repeat(110)}`)).not.toBeInTheDocument()
  })

  it('copies the display-ready preview returned by main without truncating it', async () => {
    const displayReadyContent = `${'A'.repeat(100)}...`
    ipcRequest.mockResolvedValue({ content: displayReadyContent })
    const copyText = vi.fn().mockResolvedValue(undefined)
    mocks.messageListActions = { copyText, notifyError: mocks.notifyError }
    const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }]

    render(<CitationsPanelContent citations={citations} />, { wrapper })

    fireEvent.click(await screen.findByText('copy'))

    expect(copyText).toHaveBeenCalledTimes(1)
    expect(copyText).toHaveBeenCalledWith(displayReadyContent, { successMessage: 'common.copied' })
    expect(await screen.findByText('check')).toBeInTheDocument()
  })

  it('dedupes citation preview IPC requests for the same URL via the shared SWR cache', async () => {
    const a: Citation = { number: 1, url: 'https://dup.com', title: 'A', type: 'websearch' }
    const b: Citation = { number: 2, url: 'https://dup.com', title: 'B', type: 'websearch' }

    render(
      <>
        <CitationsPanelContent citations={[a]} actions={{ openPath: vi.fn() }} />
        <CitationsPanelContent citations={[b]} actions={{ openPath: vi.fn() }} />
      </>,
      { wrapper }
    )

    expect(await screen.findAllByText('Fetched citation preview')).toHaveLength(2)
    expect(ipcRequest).toHaveBeenCalledTimes(1)
    expect(ipcRequest).toHaveBeenCalledWith('citation.fetch_preview', { url: 'https://dup.com' })
  })
})
