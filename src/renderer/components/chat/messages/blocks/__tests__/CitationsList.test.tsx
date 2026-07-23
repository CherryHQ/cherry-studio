import type { Citation } from '@renderer/types/message'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type React from 'react'
import type { Cache } from 'swr'
import { SWRConfig, unstable_serialize } from 'swr'
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

let swrCache: Cache

// Isolate SWR's global cache per render so cached previews do not bleed across tests.
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => swrCache, dedupingInterval: 0 }}>{children}</SWRConfig>
)

describe('CitationsList', () => {
  beforeEach(() => {
    swrCache = new Map()
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
    expect(ipcRequest).toHaveBeenCalledWith('citation.fetch_preview', {
      url: 'https://example.com',
      requestId: expect.any(String)
    })
    expect([...swrCache.keys()].filter((key) => key.includes('citationPreview'))).toEqual([
      unstable_serialize(['citationPreview', 'https://example.com'])
    ])
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
    expect(screen.getByRole('link', { name: '@author' })).toBeInTheDocument()
    expect(fetchMocks.fetchXOEmbed).toHaveBeenCalledWith(xUrl)
    expect(fetchMocks.fetchXOEmbed).toHaveBeenCalledTimes(1)
    expect(ipcRequest).not.toHaveBeenCalled()
  })

  it('shares X oEmbed results across panels in the same SWR cache', async () => {
    fetchMocks.isXPostUrl.mockReturnValue(true)
    fetchMocks.fetchXOEmbed.mockResolvedValue({ author: 'author', text: 'post text' })
    const xUrl = 'https://x.com/author/status/123'
    const citation: Citation = { number: 1, url: xUrl, title: 'X post', type: 'websearch' }

    render(
      <>
        <CitationsPanelContent citations={[citation]} />
        <CitationsPanelContent citations={[citation]} />
      </>,
      { wrapper }
    )

    expect(await screen.findAllByText('@author: post text')).toHaveLength(2)
    expect(fetchMocks.fetchXOEmbed).toHaveBeenCalledTimes(1)
  })

  it('keeps the original X citation title when oEmbed returns no data', async () => {
    fetchMocks.isXPostUrl.mockReturnValue(true)
    fetchMocks.fetchXOEmbed.mockResolvedValue(null)
    const xUrl = 'https://x.com/author/status/123'
    const citations: Citation[] = [{ number: 1, url: xUrl, title: 'X post', type: 'websearch' }]

    render(<CitationsPanelContent citations={citations} />, { wrapper })

    await waitFor(() => expect(screen.queryByTestId('citation-preview-loading')).not.toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'X post' })).toBeInTheDocument()
    expect(fetchMocks.fetchXOEmbed).toHaveBeenCalledTimes(1)
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

  it('dedupes citation preview IPC requests for the same URL within one panel', async () => {
    const a: Citation = { number: 1, url: 'https://dup.com', title: 'A', type: 'websearch' }
    const b: Citation = { number: 2, url: 'https://dup.com', title: 'B', type: 'websearch' }

    render(<CitationsPanelContent citations={[a, b]} actions={{ openPath: vi.fn() }} />, { wrapper })

    expect(await screen.findAllByText('Fetched citation preview')).toHaveLength(2)
    expect(ipcRequest).toHaveBeenCalledTimes(1)
    expect(ipcRequest).toHaveBeenCalledWith('citation.fetch_preview', {
      url: 'https://dup.com',
      requestId: expect.any(String)
    })
  })

  it('cancels the panel preview request group when the panel unmounts', async () => {
    const citations: Citation[] = [{ number: 1, url: 'https://example.com', title: 'Example', type: 'websearch' }]
    const { unmount } = render(<CitationsPanelContent citations={citations} />, { wrapper })

    await waitFor(() => expect(ipcRequest).toHaveBeenCalledWith('citation.fetch_preview', expect.any(Object)))
    const fetchInput = ipcRequest.mock.calls.find(([route]) => route === 'citation.fetch_preview')?.[1] as {
      requestId: string
    }

    unmount()

    expect(ipcRequest).toHaveBeenCalledWith('citation.cancel_previews', { requestId: fetchInput.requestId })
  })

  it('keeps identical URLs in separate panels isolated from each other', async () => {
    const citation: Citation = { number: 1, url: 'https://isolated.com', title: 'Isolated', type: 'websearch' }

    render(
      <>
        <CitationsPanelContent citations={[citation]} />
        <CitationsPanelContent citations={[citation]} />
      </>,
      { wrapper }
    )

    expect(await screen.findAllByText('Fetched citation preview')).toHaveLength(2)
    const fetchCalls = ipcRequest.mock.calls.filter(([route]) => route === 'citation.fetch_preview')
    expect(fetchCalls).toHaveLength(2)
    expect(fetchCalls[0]?.[1].requestId).not.toBe(fetchCalls[1]?.[1].requestId)
  })

  it('cancels only the unmounted panel while the other identical panel remains usable', async () => {
    const citation: Citation = { number: 1, url: 'https://isolated.com', title: 'Isolated', type: 'websearch' }
    const Panels = ({ showFirst }: { showFirst: boolean }) => (
      <>
        {showFirst && <CitationsPanelContent citations={[citation]} />}
        <CitationsPanelContent citations={[citation]} />
      </>
    )
    const { rerender } = render(<Panels showFirst />, { wrapper })

    expect(await screen.findAllByText('Fetched citation preview')).toHaveLength(2)
    const fetchCalls = ipcRequest.mock.calls.filter(([route]) => route === 'citation.fetch_preview')
    const firstRequestId = fetchCalls[0]?.[1].requestId
    const secondRequestId = fetchCalls[1]?.[1].requestId

    rerender(<Panels showFirst={false} />)

    await waitFor(() =>
      expect(ipcRequest).toHaveBeenCalledWith('citation.cancel_previews', { requestId: firstRequestId })
    )
    expect(ipcRequest).not.toHaveBeenCalledWith('citation.cancel_previews', { requestId: secondRequestId })
    expect(screen.getByText('Fetched citation preview')).toBeInTheDocument()
  })

  it('reuses a successful citation preview when a panel remounts', async () => {
    const citation: Citation = { number: 1, url: 'https://remount.com', title: 'Remount', type: 'websearch' }
    const Panel = ({ visible }: { visible: boolean }) =>
      visible ? <CitationsPanelContent citations={[citation]} /> : null
    const { rerender } = render(<Panel visible />, { wrapper })

    expect(await screen.findByText('Fetched citation preview')).toBeInTheDocument()
    const firstFetch = ipcRequest.mock.calls.find(([route]) => route === 'citation.fetch_preview')
    const firstRequestId = firstFetch?.[1].requestId

    rerender(<Panel visible={false} />)
    await waitFor(() =>
      expect(ipcRequest).toHaveBeenCalledWith('citation.cancel_previews', { requestId: firstRequestId })
    )
    rerender(<Panel visible />)

    expect(await screen.findByText('Fetched citation preview')).toBeInTheDocument()
    expect(ipcRequest.mock.calls.filter(([route]) => route === 'citation.fetch_preview')).toHaveLength(1)
  })

  it('retries after remount when the previous preview result was empty', async () => {
    ipcRequest.mockImplementation((route) =>
      Promise.resolve(route === 'citation.fetch_preview' ? { content: '' } : undefined)
    )
    const citation: Citation = { number: 1, url: 'https://empty.com', title: 'Empty', type: 'websearch' }
    const Panel = ({ visible }: { visible: boolean }) =>
      visible ? <CitationsPanelContent citations={[citation]} /> : null
    const { rerender } = render(<Panel visible />, { wrapper })

    await waitFor(() => {
      const fetchCalls = ipcRequest.mock.calls.filter(([route]) => route === 'citation.fetch_preview')
      expect(fetchCalls).toHaveLength(1)
    })
    await waitFor(() => expect(screen.queryByTestId('citation-preview-loading')).not.toBeInTheDocument())

    rerender(<Panel visible={false} />)
    rerender(<Panel visible />)

    await waitFor(() =>
      expect(ipcRequest.mock.calls.filter(([route]) => route === 'citation.fetch_preview')).toHaveLength(2)
    )
  })
})
