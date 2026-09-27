import { act, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import Hyperlink from '../Hyperlink'
import Link from '../Link'

const { parseMetadata, metadataHook, openExternalUrl } = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
  parseMetadata: vi.fn(),
  metadataHook: vi.fn()
}))

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/hooks/useMetaDataParser', () => ({
  useMetaDataParser: metadataHook
}))
vi.mock('../../MessageListProvider', () => ({
  useOptionalMessageListActions: () => ({ openExternalUrl })
}))

describe('Hyperlink context menu', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    metadataHook.mockReturnValue({ metadata: { title: 'Website preview' }, isLoading: false, parseMetadata })
  })
  afterEach(() => vi.useRealTimers())

  it('opens a website preview through its conversation while preserving modified clicks', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    const href = 'https://example.com/a%20b'
    render(<Link href={href}>Website</Link>)
    await user.hover(screen.getByRole('link', { name: 'Website' }))
    const preview = await screen.findByRole('link', { name: /Website preview/ })
    for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
      const event = createEvent.click(preview, { [modifier]: true })
      fireEvent(preview, event)
      expect(event.defaultPrevented).toBe(false)
    }
    fireEvent(preview, new MouseEvent('auxclick', { button: 1, bubbles: true }))
    expect(openExternalUrl).not.toHaveBeenCalled()
    await user.click(preview)
    expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith(href)
  })

  it('renders empty-href content without a preview', async () => {
    render(
      <Hyperlink href="">
        <span>Content</span>
      </Hyperlink>
    )
    fireEvent.pointerEnter(screen.getByText('Content'), { pointerType: 'mouse' })
    await act(() => vi.advanceTimersByTimeAsync(600))
    expect(screen.getByText('Content')).toBeVisible()
    expect(metadataHook).not.toHaveBeenCalled()
  })

  it.each([
    ['https://example.com/a%20b', 'https://example.com/a b'],
    ['https://example.com/%broken', 'https://example.com/%broken']
  ])(
    'loads metadata only after hovering, preserving URL decoding and malformed escapes: %s',
    async (href, expected) => {
      metadataHook.mockReturnValue({ metadata: {}, isLoading: true, parseMetadata })
      render(
        <Hyperlink href={href}>
          <a href={href}>Website</a>
        </Hyperlink>
      )
      expect(parseMetadata).not.toHaveBeenCalled()
      fireEvent.pointerEnter(screen.getByRole('link'), { pointerType: 'mouse' })
      await act(() => vi.advanceTimersByTimeAsync(499))
      expect(parseMetadata).not.toHaveBeenCalled()
      await act(() => vi.advanceTimersByTimeAsync(1))
      expect(metadataHook).toHaveBeenCalledWith(expected, expect.any(Array))
      expect(parseMetadata).toHaveBeenCalledOnce()
    }
  )

  it('restores keyboard preview after tabbing away without reopening on menu focus restoration', async () => {
    vi.useRealTimers()
    const user = userEvent.setup()
    render(
      <>
        <Hyperlink href="https://example.com">
          <a href="https://example.com">Website</a>
        </Hyperlink>
        <button type="button">Next</button>
      </>
    )
    const link = screen.getByRole('link', { name: 'Website' })
    await user.tab()
    await waitFor(() => expect(screen.getByText('Website preview')).toBeVisible())
    fireEvent.contextMenu(link)
    // Model the menu taking focus and returning it on Escape.
    act(() => link.blur())
    act(() => link.focus())
    await act(() => new Promise((resolve) => setTimeout(resolve, 600)))
    expect(screen.queryByText('Website preview')).not.toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(link).toHaveFocus()
    await waitFor(() => expect(screen.getByText('Website preview')).toBeVisible())
  })

  it.each([100, 600])('suppresses pending and visible previews after right-click at %i ms', async (delay) => {
    const contextMenu = vi.fn()
    render(
      <div onContextMenu={contextMenu}>
        <Hyperlink href="https://example.com">
          <a href="https://example.com">Website</a>
        </Hyperlink>
      </div>
    )
    const link = screen.getByRole('link', { name: 'Website' })
    fireEvent.pointerEnter(link, { pointerType: 'mouse' })
    await act(() => vi.advanceTimersByTimeAsync(delay))
    if (delay > 500) expect(screen.getByText('Website preview')).toBeVisible()
    fireEvent(link, new MouseEvent('pointerdown', { button: 2, bubbles: true }))
    expect(screen.queryByText('Website preview')).not.toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.queryByText('Website preview')).not.toBeInTheDocument()
    fireEvent.contextMenu(link)
    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(screen.queryByText('Website preview')).not.toBeInTheDocument()
    expect(contextMenu).toHaveBeenCalledOnce()

    fireEvent.focus(link)
    await act(() => vi.advanceTimersByTimeAsync(600))
    expect(screen.queryByText('Website preview')).not.toBeInTheDocument()

    fireEvent.pointerLeave(link, { pointerType: 'mouse' })
    fireEvent.pointerEnter(link, { pointerType: 'mouse' })
    await act(() => vi.advanceTimersByTimeAsync(600))
    expect(screen.getByText('Website preview')).toBeVisible()
  })
})
