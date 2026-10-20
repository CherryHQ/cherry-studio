import { act, fireEvent, render, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ToolResultLink } from '../shared/ToolResultLink'

const openExternalUrl = vi.hoisted(() => vi.fn())
vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ openExternalUrl })
}))

function TestSWRConfig({ children }: PropsWithChildren) {
  return <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
}

const imageSource = 'data:image/png;base64,aW1hZ2U='

describe('ToolResultLink', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected renderer fetch'))
    vi.mocked(window.api.ipcApi.request).mockReset().mockResolvedValue({ ok: true, data: imageSource })
  })
  afterEach(() => vi.restoreAllMocks())

  it('renders only downloaded image data, sharing the safe request across duplicate URLs', async () => {
    const url = 'https://example.com/download?id=1'
    render(
      <>
        <ToolResultLink url={url} isImage={false} />
        <ToolResultLink url={url} isImage={false} />
      </>,
      { wrapper: TestSWRConfig }
    )
    const images = await screen.findAllByRole('img')
    expect(images).toHaveLength(2)
    expect(images[0]).toHaveAttribute('src', imageSource)
    expect(window.api.ipcApi.request).toHaveBeenCalledTimes(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not load image URLs or favicons while pending or when the safe preview is rejected', async () => {
    const pending = Promise.withResolvers<{ ok: true; data: null }>()
    vi.mocked(window.api.ipcApi.request).mockReturnValue(pending.promise)
    const url = 'http://127.0.0.1/action.png'
    render(<ToolResultLink url={url} isImage mimeType="image/png" />, { wrapper: TestSWRConfig })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    await act(async () => pending.resolve({ ok: true, data: null }))
    expect(screen.getByRole('link', { name: url })).toHaveAttribute('href', url)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps failed images actionable and retries a new source', async () => {
    const user = userEvent.setup()
    const url = 'https://example.com/expired.png'
    const { rerender } = render(<ToolResultLink url={url} isImage />, { wrapper: TestSWRConfig })
    fireEvent.error(await screen.findByRole('img'))
    await user.click(screen.getByRole('link', { name: url }))
    expect(openExternalUrl).toHaveBeenCalledWith(url)
    rerender(<ToolResultLink url="https://example.com/fresh.png" isImage />)
    expect(await screen.findByRole('img')).toHaveAttribute('src', imageSource)
    expect(fetch).not.toHaveBeenCalled()
  })
})
