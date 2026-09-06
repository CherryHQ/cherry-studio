import { toast } from '@renderer/services/toast'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WebviewTag } from 'electron'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import WebviewSearch from '../WebviewSearch'

const translations: Record<string, string> = {
  'common.close': 'Close',
  'common.error': 'Error',
  'common.no_results': 'No results',
  'common.search': 'Search',
  'common.next_match': 'Next match',
  'common.previous_match': 'Previous match'
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key
  })
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() }
}))

// A real element, because guest keys route by the replayed event's `target`.
const createWebviewMock = (webContentsId = 1) => {
  const findInPageMock = vi.fn()
  const stopFindInPageMock = vi.fn()
  const webview = document.createElement('webview') as unknown as WebviewTag
  Object.assign(webview, {
    getWebContentsId: vi.fn(() => webContentsId),
    findInPage: findInPageMock,
    stopFindInPage: stopFindInPageMock
  })

  const emit = (type: string, result?: Electron.FoundInPageResult) => {
    const event = new CustomEvent(type) as Event & { result?: Electron.FoundInPageResult }
    event.result = result
    webview.dispatchEvent(event)
  }

  return {
    emit,
    findInPageMock,
    stopFindInPageMock,
    webview
  }
}

const openSearchOverlay = async () => {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }))
  })
  await waitFor(() => {
    expect(screen.getByPlaceholderText('Search')).toBeInTheDocument()
  })
}

const originalRAF = window.requestAnimationFrame
const originalCAF = window.cancelAnimationFrame

const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
  callback(0)
  return 1
})
const cancelAnimationFrameMock = vi.fn()

beforeAll(() => {
  Object.defineProperty(window, 'requestAnimationFrame', {
    value: requestAnimationFrameMock,
    writable: true
  })
  Object.defineProperty(window, 'cancelAnimationFrame', {
    value: cancelAnimationFrameMock,
    writable: true
  })
})

afterAll(() => {
  Object.defineProperty(window, 'requestAnimationFrame', {
    value: originalRAF
  })
  Object.defineProperty(window, 'cancelAnimationFrame', {
    value: originalCAF
  })
})

describe('WebviewSearch', () => {
  // Mirrors WebviewContainer's replay: a guest key reaches the host window carrying
  // the `<webview>` it came from as target, which is what routes it to one pane.
  const pressGuestKey = (webview: WebviewTag, init: KeyboardEventInit) => {
    act(() => {
      const event = new KeyboardEvent('keydown', { ...init, cancelable: true })
      Object.defineProperty(event, 'target', { get: () => webview })
      window.dispatchEvent(event)
    })
  }

  const renderSplitView = () => {
    const owner = createWebviewMock(1)
    const other = createWebviewMock(2)
    const ownerRef = { current: owner.webview } as React.RefObject<WebviewTag | null>
    const otherRef = { current: other.webview } as React.RefObject<WebviewTag | null>

    render(
      <>
        <WebviewSearch webviewRef={ownerRef} isWebviewReady targetId="app-1" hostShortcutEnabled />
        <WebviewSearch webviewRef={otherRef} isWebviewReady targetId="app-2" hostShortcutEnabled={false} />
      </>
    )

    return { other, owner }
  }

  const openBothOverlays = async (other: WebviewTag) => {
    await openSearchOverlay()
    pressGuestKey(other, { key: 'f', ctrlKey: true })
    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('Search')).toHaveLength(2)
    })
  }

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('opens the search overlay with keyboard shortcut', async () => {
    const { webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady targetId="app-1" />)

    expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument()

    await openSearchOverlay()

    expect(screen.getByPlaceholderText('Search')).toBeInTheDocument()
  })

  it('opens the search overlay when the shortcut is replayed from its guest', async () => {
    const { webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady targetId="app-1" />)

    pressGuestKey(webview, { key: 'f', ctrlKey: true })

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search')).toBeInTheDocument()
    })
  })

  it('ignores a shortcut replayed from a different pane’s guest', async () => {
    const { webview } = createWebviewMock(1)
    const { webview: stranger } = createWebviewMock(2)
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady targetId="app-1" />)

    pressGuestKey(stranger, { key: 'f', ctrlKey: true })

    expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument()
  })

  it('does not call stopFindInPage when webview is not ready', async () => {
    const { stopFindInPageMock, webview } = createWebviewMock()
    const error = new Error('loading')
    const getWebContentsIdMock = vi.fn(() => {
      throw error
    })
    ;(webview as any).getWebContentsId = getWebContentsIdMock
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    const { rerender, unmount } = render(<WebviewSearch webviewRef={webviewRef} isWebviewReady targetId="app-1" />)

    stopFindInPageMock.mockImplementation(() => {
      throw new Error('should not be called')
    })

    rerender(<WebviewSearch webviewRef={webviewRef} isWebviewReady={false} targetId="app-1" />)
    expect(getWebContentsIdMock).toHaveBeenCalled()
    expect(stopFindInPageMock).not.toHaveBeenCalled()

    unmount()
    expect(stopFindInPageMock).not.toHaveBeenCalled()
  })

  it('closes the search overlay when escape is replayed from its guest', async () => {
    const { webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady targetId="app-1" />)

    pressGuestKey(webview, { key: 'f', ctrlKey: true })
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search')).toBeInTheDocument()
    })

    pressGuestKey(webview, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument()
    })
  })

  it('performs searches and navigates between results', async () => {
    const { emit, findInPageMock, webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>
    const user = userEvent.setup()

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady targetId="app-1" />)
    await openSearchOverlay()

    const input = screen.getByRole('textbox')
    await user.type(input, 'Cherry')

    await waitFor(() => {
      expect(findInPageMock).toHaveBeenCalledWith('Cherry', undefined)
    })

    await act(async () => {
      emit('found-in-page', {
        requestId: 1,
        matches: 3,
        activeMatchOrdinal: 1,
        selectionArea: undefined as unknown as Electron.Rectangle,
        finalUpdate: false
      } as Electron.FoundInPageResult)
    })

    const nextButton = screen.getByRole('button', { name: 'Next match' })
    await waitFor(() => {
      expect(nextButton).not.toBeDisabled()
    })
    await user.click(nextButton)
    await waitFor(() => {
      expect(findInPageMock).toHaveBeenLastCalledWith('Cherry', { forward: true, findNext: true })
    })

    const previousButton = screen.getByRole('button', { name: 'Previous match' })
    await user.click(previousButton)
    await waitFor(() => {
      expect(findInPageMock).toHaveBeenLastCalledWith('Cherry', { forward: false, findNext: true })
    })
  })

  it('navigates results when enter is replayed from its guest', async () => {
    const { findInPageMock, webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>
    const user = userEvent.setup()

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady targetId="app-1" />)

    pressGuestKey(webview, { key: 'f', ctrlKey: true })
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search')).toBeInTheDocument()
    })

    const input = screen.getByRole('textbox')
    await user.type(input, 'Cherry')

    await waitFor(() => {
      expect(findInPageMock).toHaveBeenCalledWith('Cherry', undefined)
    })
    findInPageMock.mockClear()

    pressGuestKey(webview, { key: 'Enter' })
    await waitFor(() => {
      expect(findInPageMock).toHaveBeenCalledWith('Cherry', { forward: true, findNext: true })
    })

    findInPageMock.mockClear()
    pressGuestKey(webview, { key: 'Enter', shiftKey: true })
    await waitFor(() => {
      expect(findInPageMock).toHaveBeenCalledWith('Cherry', { forward: false, findNext: true })
    })
  })

  it('clears search state when targetId changes', async () => {
    const { findInPageMock, stopFindInPageMock, webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>
    const user = userEvent.setup()

    const { rerender } = render(<WebviewSearch webviewRef={webviewRef} isWebviewReady targetId="app-1" />)
    await openSearchOverlay()

    const input = screen.getByRole('textbox')
    await user.type(input, 'Cherry')
    await waitFor(() => {
      expect(findInPageMock).toHaveBeenCalled()
    })

    await act(async () => {
      rerender(<WebviewSearch webviewRef={webviewRef} isWebviewReady targetId="app-2" />)
    })

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument()
    })
    expect(stopFindInPageMock).toHaveBeenCalledWith('clearSelection')
  })

  it('shows toast error when search fails', async () => {
    const { findInPageMock, webview } = createWebviewMock()
    findInPageMock.mockImplementation(() => {
      throw new Error('findInPage failed')
    })
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>
    const user = userEvent.setup()

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady targetId="app-1" />)
    await openSearchOverlay()

    const input = screen.getByRole('textbox')
    await user.type(input, 'Cherry')

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Error')
    })
  })

  it('stops search when component unmounts', async () => {
    const { stopFindInPageMock, webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    const { unmount } = render(<WebviewSearch webviewRef={webviewRef} isWebviewReady targetId="app-1" />)
    await openSearchOverlay()

    stopFindInPageMock.mockClear()
    unmount()

    expect(stopFindInPageMock).toHaveBeenCalledWith('clearSelection')
  })

  it('ignores the host Find shortcut when another pane owns it', async () => {
    const { webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady targetId="app-1" hostShortcutEnabled={false} />)

    await act(async () => {
      fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    })

    // In split view both panes mount a search overlay and the host listener is
    // global; without this gate one keypress opens every pane's overlay.
    expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument()
  })

  it('still answers its own webview shortcut and Escape while another pane owns the host key', async () => {
    const { webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady targetId="app-1" hostShortcutEnabled={false} />)

    // A guest key is addressed by the webview it came from, so it must keep
    // working for the pane that does not own the host shortcut.
    pressGuestKey(webview, { key: 'f', ctrlKey: true })

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search')).toBeInTheDocument()
    })

    // ...and the overlay it opened must remain closable from the keyboard.
    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument()
    })
  })

  it('routes Enter and Escape to the pane whose overlay holds focus', async () => {
    const user = userEvent.setup()
    const { other, owner } = renderSplitView()
    await openBothOverlays(other.webview)

    const [ownerInput, otherInput] = screen.getAllByPlaceholderText('Search')
    await user.type(otherInput, 'Cherry')
    await user.type(ownerInput, 'Cherry')
    await waitFor(() => {
      expect(other.findInPageMock).toHaveBeenCalled()
      expect(owner.findInPageMock).toHaveBeenCalled()
    })
    owner.findInPageMock.mockClear()
    other.findInPageMock.mockClear()
    owner.stopFindInPageMock.mockClear()
    other.stopFindInPageMock.mockClear()

    await act(async () => {
      ownerInput.focus()
      fireEvent.keyDown(window, { key: 'Enter' })
    })

    expect(owner.findInPageMock).toHaveBeenCalledWith('Cherry', { forward: true, findNext: true })
    expect(other.findInPageMock).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('Search')).toHaveLength(1)
    })
    expect(owner.stopFindInPageMock).toHaveBeenCalledWith('clearSelection')
    expect(other.stopFindInPageMock).not.toHaveBeenCalled()
  })

  it('falls back to pane ownership for Enter and Escape when no overlay holds focus', async () => {
    const user = userEvent.setup()
    const { other, owner } = renderSplitView()
    await openBothOverlays(other.webview)

    const [ownerInput, otherInput] = screen.getAllByPlaceholderText('Search')
    await user.type(otherInput, 'Cherry')
    await user.type(ownerInput, 'Cherry')
    await waitFor(() => {
      expect(other.findInPageMock).toHaveBeenCalled()
      expect(owner.findInPageMock).toHaveBeenCalled()
    })
    owner.findInPageMock.mockClear()
    other.findInPageMock.mockClear()
    owner.stopFindInPageMock.mockClear()
    other.stopFindInPageMock.mockClear()

    await act(async () => {
      ;(document.activeElement as HTMLElement | null)?.blur()
      fireEvent.keyDown(window, { key: 'Enter' })
    })

    expect(owner.findInPageMock).toHaveBeenCalledWith('Cherry', { forward: true, findNext: true })
    expect(other.findInPageMock).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('Search')).toHaveLength(1)
    })
    expect(owner.stopFindInPageMock).toHaveBeenCalledWith('clearSelection')
    expect(other.stopFindInPageMock).not.toHaveBeenCalled()
  })

  it('closes the last visible overlay with Escape even when another pane owns the host key', async () => {
    const { other, owner } = renderSplitView()

    // Only the non-owner pane's overlay is open, and nothing inside it holds
    // focus — the state left behind after closing the focused overlay.
    pressGuestKey(other.webview, { key: 'f', ctrlKey: true })
    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('Search')).toHaveLength(1)
    })
    other.stopFindInPageMock.mockClear()

    await act(async () => {
      ;(document.activeElement as HTMLElement | null)?.blur()
      fireEvent.keyDown(window, { key: 'Escape' })
    })

    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument()
    })
    expect(other.stopFindInPageMock).toHaveBeenCalledWith('clearSelection')
    expect(owner.stopFindInPageMock).not.toHaveBeenCalled()
  })

  it('ignores keyboard shortcut when webview is not ready', async () => {
    const { findInPageMock, webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady={false} targetId="app-1" />)

    await act(async () => {
      fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    })

    expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument()
    expect(findInPageMock).not.toHaveBeenCalled()
  })
})
