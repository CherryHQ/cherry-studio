import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToolResultLink } from '../shared/ToolResultLink'

// Favicon probes are independent of tool-result content-type detection.
vi.mock('@renderer/components/icons/FallbackFavicon', () => ({ default: () => null }))

const openExternalUrl = vi.hoisted(() => vi.fn())
vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ openExternalUrl })
}))

function TestSWRConfig({ children }: PropsWithChildren) {
  return <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
}

describe('ToolResultLink', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('uses HEAD to preview an extensionless image and shares the request across duplicate links', async () => {
    const url = 'https://example.com/download?id=1'
    fetchMock.mockResolvedValue(new Response(null, { headers: { 'Content-Type': 'IMAGE/WEBP; charset=binary' } }))
    render(
      <>
        <ToolResultLink url={url} isImage={false} />
        <ToolResultLink url={url} isImage={false} />
      </>,
      { wrapper: TestSWRConfig }
    )

    const images = await screen.findAllByRole('img')
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAttribute('src', url)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ method: 'HEAD', credentials: 'omit', signal: expect.any(AbortSignal) })
    )
  })

  it('keeps an image-suffixed URL as a link when HEAD identifies HTML', async () => {
    const url = 'https://example.com/page.png'
    let respond!: (response: Response) => void
    fetchMock.mockReturnValue(
      new Promise((resolve) => {
        respond = resolve
      })
    )
    render(<ToolResultLink url={url} isImage />, { wrapper: TestSWRConfig })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()

    await act(async () => respond(new Response(null, { headers: { 'Content-Type': 'text/html' } })))
    expect(await screen.findByRole('link', { name: url })).toHaveAttribute('href', url)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it.each(['rejected', 'unsupported', 'missing-type'])('falls back to the pathname when HEAD is %s', async (result) => {
    if (result === 'rejected') fetchMock.mockRejectedValue(new TypeError('Network error'))
    else fetchMock.mockResolvedValue(new Response(null, { status: result === 'unsupported' ? 405 : 200 }))
    const url = 'https://example.com/image.png'
    render(<ToolResultLink url={url} isImage />, { wrapper: TestSWRConfig })
    expect(await screen.findByRole('img')).toHaveAttribute('src', url)
  })

  it('keeps an extensionless link usable if HEAD fails', async () => {
    const url = 'https://example.com/download?id=2'
    fetchMock.mockRejectedValue(new TypeError('Network error'))
    await act(async () => {
      render(<ToolResultLink url={url} isImage={false} />, { wrapper: TestSWRConfig })
    })
    expect(screen.getByRole('link', { name: url })).toHaveAttribute('href', url)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to an actionable link after a failed image and retries a new source', async () => {
    const user = userEvent.setup()
    const url = 'https://example.com/expired.png?signature=abc'
    const { rerender } = render(<ToolResultLink url={url} isImage mimeType="image/png" />)

    fireEvent.error(screen.getByRole('img'))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: url })
    expect(link).toHaveAttribute('href', url)
    await user.click(link)
    expect(openExternalUrl).toHaveBeenCalledWith(url)

    rerender(<ToolResultLink url="https://example.com/fresh.png" isImage mimeType="image/png" />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/fresh.png')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
