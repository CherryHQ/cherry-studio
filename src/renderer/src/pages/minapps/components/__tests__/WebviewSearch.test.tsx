import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WebviewTag } from 'electron'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import WebviewSearch from '../WebviewSearch'

const translations: Record<string, string> = {
  'common.close': 'Close',
  'common.error': 'Error',
  'common.no_results': 'No results',
  'common.search': 'Search'
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => translations[key] ?? key
  })
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
  const toastMock = {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    addToast: vi.fn()
  }

  beforeEach(() => {
    Object.assign(window, { toast: toastMock })
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
      expect(toastMock.error).toHaveBeenCalledWith('Error')
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
