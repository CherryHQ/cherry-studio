import { toast } from '@renderer/services/toast'
import type { WebviewKeyEvent } from '@shared/types/webview'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WebviewTag } from 'electron'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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

const ipcMocks = vi.hoisted(() => ({
  latestHandler: null as null | ((payload: WebviewKeyEvent) => void),
  handlers: [] as Array<(payload: WebviewKeyEvent) => void>,
  useIpcOn: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({
  useIpcOn: ipcMocks.useIpcOn,
  ipcApi: { request: vi.fn() }
}))

const createWebviewMock = () => {
  const listeners = new Map<string, Set<(event: Event & { result?: Electron.FoundInPageResult }) => void>>()
  const findInPageMock = vi.fn()
  const stopFindInPageMock = vi.fn()
  const webview = {
    addEventListener: vi.fn(
      (type: string, listener: (event: Event & { result?: Electron.FoundInPageResult }) => void) => {
        if (!listeners.has(type)) {
          listeners.set(type, new Set())
        }
        listeners.get(type)!.add(listener)
      }
    ),
    removeEventListener: vi.fn(
      (type: string, listener: (event: Event & { result?: Electron.FoundInPageResult }) => void) => {
        listeners.get(type)?.delete(listener)
      }
    ),
    getWebContentsId: vi.fn(() => 1),
    findInPage: findInPageMock as unknown as WebviewTag['findInPage'],
    stopFindInPage: stopFindInPageMock as unknown as WebviewTag['stopFindInPage']
  } as unknown as WebviewTag

  const emit = (type: string, result?: Electron.FoundInPageResult) => {
    listeners.get(type)?.forEach((listener) => {
      const event = new CustomEvent(type) as Event & { result?: Electron.FoundInPageResult }
      event.result = result
      listener(event)
    })
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
  const useIpcOnMock = ipcMocks.useIpcOn
  const invokeLatestShortcut = (payload: WebviewKeyEvent) => {
    const handler = ipcMocks.latestHandler
    if (!handler) {
      throw new Error('Shortcut handler not registered')
    }
    act(() => {
      handler(payload)
    })
  }

  const broadcastShortcut = (payload: WebviewKeyEvent) => {
    act(() => {
      ipcMocks.handlers.forEach((handler) => handler(payload))
    })
  }

  const renderSplitView = () => {
    const owner = createWebviewMock()
    const other = createWebviewMock()
    ;(other.webview as any).getWebContentsId = vi.fn(() => 2)
    const ownerRef = { current: owner.webview } as React.RefObject<WebviewTag | null>
    const otherRef = { current: other.webview } as React.RefObject<WebviewTag | null>

    render(
      <>
        <WebviewSearch webviewRef={ownerRef} isWebviewReady appId="app-1" hostShortcutEnabled />
        <WebviewSearch webviewRef={otherRef} isWebviewReady appId="app-2" hostShortcutEnabled={false} />
      </>
    )

    return { other, owner }
  }

  const openBothOverlays = async () => {
    await openSearchOverlay()
    broadcastShortcut({ webviewId: 2, key: 'f', control: true, meta: false, shift: false, alt: false })
    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('Search')).toHaveLength(2)
    })
  }

  beforeEach(() => {
    ipcMocks.latestHandler = null
    ipcMocks.handlers = []
    ipcMocks.useIpcOn.mockImplementation((_event: string, handler: (payload: WebviewKeyEvent) => void) => {
      ipcMocks.latestHandler = handler
      ipcMocks.handlers.push(handler)
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('opens the search overlay with keyboard shortcut', async () => {
    const { webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady appId="app-1" />)

    expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument()

    await openSearchOverlay()

    expect(screen.getByPlaceholderText('Search')).toBeInTheDocument()
  })

  it('opens the search overlay when webview shortcut is forwarded', async () => {
    const { webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady appId="app-1" />)

    await waitFor(() => {
      expect(useIpcOnMock).toHaveBeenCalled()
    })

    invokeLatestShortcut({ webviewId: 1, key: 'f', control: true, meta: false, shift: false, alt: false })

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search')).toBeInTheDocument()
    })
  })

  it('ignores forwarded shortcut when getWebContentsId throws', async () => {
    const { webview } = createWebviewMock()
    const error = new Error('not ready')
    const getWebContentsIdMock = vi.fn(() => {
      throw error
    })
    ;(webview as any).getWebContentsId = getWebContentsIdMock
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady appId="app-1" />)

    await waitFor(() => {
      expect(useIpcOnMock).toHaveBeenCalled()
    })

    invokeLatestShortcut({ webviewId: 1, key: 'f', control: true, meta: false, shift: false, alt: false })

    expect(getWebContentsIdMock).toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument()

    // Once the webview recovers, the same forwarded shortcut opens the overlay.
    ;(webview as any).getWebContentsId = vi.fn(() => 1)
    invokeLatestShortcut({ webviewId: 1, key: 'f', control: true, meta: false, shift: false, alt: false })

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search')).toBeInTheDocument()
    })
  })

  it('does not call stopFindInPage when webview is not ready', async () => {
    const { stopFindInPageMock, webview } = createWebviewMock()
    const error = new Error('loading')
    const getWebContentsIdMock = vi.fn(() => {
      throw error
    })
    ;(webview as any).getWebContentsId = getWebContentsIdMock
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    const { rerender, unmount } = render(<WebviewSearch webviewRef={webviewRef} isWebviewReady appId="app-1" />)

    stopFindInPageMock.mockImplementation(() => {
      throw new Error('should not be called')
    })

    rerender(<WebviewSearch webviewRef={webviewRef} isWebviewReady={false} appId="app-1" />)
    expect(getWebContentsIdMock).toHaveBeenCalled()
    expect(stopFindInPageMock).not.toHaveBeenCalled()

    unmount()
    expect(stopFindInPageMock).not.toHaveBeenCalled()
  })

  it('closes the search overlay when escape is forwarded from the webview', async () => {
    const { webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady appId="app-1" />)

    await waitFor(() => {
      expect(useIpcOnMock).toHaveBeenCalled()
    })
    invokeLatestShortcut({ webviewId: 1, key: 'f', control: true, meta: false, shift: false, alt: false })
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(useIpcOnMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    invokeLatestShortcut({ webviewId: 1, key: 'escape', control: false, meta: false, shift: false, alt: false })
    await waitFor(() => {
      expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument()
    })
  })

  it('performs searches and navigates between results', async () => {
    const { emit, findInPageMock, webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>
    const user = userEvent.setup()

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady appId="app-1" />)
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

  it('navigates results when enter is forwarded from the webview', async () => {
    const { findInPageMock, webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>
    const user = userEvent.setup()

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady appId="app-1" />)

    await waitFor(() => {
      expect(useIpcOnMock).toHaveBeenCalled()
    })
    invokeLatestShortcut({ webviewId: 1, key: 'f', control: true, meta: false, shift: false, alt: false })
    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search')).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(useIpcOnMock.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    const input = screen.getByRole('textbox')
    await user.type(input, 'Cherry')

    await waitFor(() => {
      expect(findInPageMock).toHaveBeenCalledWith('Cherry', undefined)
    })
    findInPageMock.mockClear()

    invokeLatestShortcut({ webviewId: 1, key: 'enter', control: false, meta: false, shift: false, alt: false })
    await waitFor(() => {
      expect(findInPageMock).toHaveBeenCalledWith('Cherry', { forward: true, findNext: true })
    })

    findInPageMock.mockClear()
    invokeLatestShortcut({ webviewId: 1, key: 'enter', control: false, meta: false, shift: true, alt: false })
    await waitFor(() => {
      expect(findInPageMock).toHaveBeenCalledWith('Cherry', { forward: false, findNext: true })
    })
  })

  it('clears search state when appId changes', async () => {
    const { findInPageMock, stopFindInPageMock, webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>
    const user = userEvent.setup()

    const { rerender } = render(<WebviewSearch webviewRef={webviewRef} isWebviewReady appId="app-1" />)
    await openSearchOverlay()

    const input = screen.getByRole('textbox')
    await user.type(input, 'Cherry')
    await waitFor(() => {
      expect(findInPageMock).toHaveBeenCalled()
    })

    await act(async () => {
      rerender(<WebviewSearch webviewRef={webviewRef} isWebviewReady appId="app-2" />)
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

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady appId="app-1" />)
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

    const { unmount } = render(<WebviewSearch webviewRef={webviewRef} isWebviewReady appId="app-1" />)
    await openSearchOverlay()

    stopFindInPageMock.mockClear()
    unmount()

    expect(stopFindInPageMock).toHaveBeenCalledWith('clearSelection')
  })

  it('ignores the host Find shortcut when another pane owns it', async () => {
    const { webview } = createWebviewMock()
    const webviewRef = { current: webview } as React.RefObject<WebviewTag | null>

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady appId="app-1" hostShortcutEnabled={false} />)

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

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady appId="app-1" hostShortcutEnabled={false} />)

    await waitFor(() => {
      expect(useIpcOnMock).toHaveBeenCalled()
    })

    // The webview-scoped IPC path is addressed by webviewId, so it must keep
    // working for the pane that does not own the host shortcut.
    invokeLatestShortcut({ webviewId: 1, key: 'f', control: true, meta: false, shift: false, alt: false })

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
    await openBothOverlays()

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
    await openBothOverlays()

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
    broadcastShortcut({ webviewId: 2, key: 'f', control: true, meta: false, shift: false, alt: false })
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

    render(<WebviewSearch webviewRef={webviewRef} isWebviewReady={false} appId="app-1" />)

    await act(async () => {
      fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    })

    expect(screen.queryByPlaceholderText('Search')).not.toBeInTheDocument()
    expect(findInPageMock).not.toHaveBeenCalled()
  })
})
