import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  type WebviewAnnotationGuestEvent,
  type WebviewAnnotationHostCommand
} from '@shared/types/webviewAnnotation'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { request, toastSuccess, toastError, randomUUID } = vi.hoisted(() => ({
  request: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000010')
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@renderer/services/toast', () => ({ toast: { success: toastSuccess, error: toastError } }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'dark' }) }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), error: vi.fn() }) }
}))
vi.mock('@cherrystudio/ui', () => ({
  Badge: ({ children, ...props }: { children: ReactNode }) => <span {...props}>{children}</span>,
  Button: ({ children, type = 'button', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  ConfirmDialog: ({ open, title, confirmText, onConfirm }: any) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button type="button" onClick={onConfirm}>
          Confirm {confirmText}
        </button>
      </div>
    ) : null
}))

import { WebviewAnnotationControls } from '../WebviewAnnotationControls'

const sessionOne = '00000000-0000-4000-8000-000000000001'
const sessionTwo = '00000000-0000-4000-8000-000000000002'
const target = { id: 'mini-app:demo', label: 'Demo' }
const annotation = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  comment: 'Fix this button',
  element: { selector: '#submit', tagName: 'button', text: 'Submit', ariaLabel: null, role: 'button' }
}

interface TestWebview extends WebviewTag {
  emitNative: (type: string, event?: Record<string, unknown>) => void
}

function createWebview(webviewId = 42): TestWebview {
  const element = document.createElement('webview') as unknown as TestWebview
  const listeners = new Map<string, Set<EventListener>>()
  Object.assign(element, {
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      const registered = listeners.get(type) ?? new Set<EventListener>()
      registered.add(listener)
      listeners.set(type, registered)
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => listeners.get(type)?.delete(listener)),
    send: vi.fn().mockResolvedValue(undefined),
    getWebContentsId: vi.fn(() => webviewId),
    emitNative: (type: string, fields: Record<string, unknown> = {}) => {
      for (const listener of listeners.get(type) ?? []) {
        listener({ isTrusted: true, currentTarget: element, ...fields } as unknown as Event)
      }
    }
  })
  return element
}

const guestEvent = (webview: TestWebview, event: WebviewAnnotationGuestEvent, fields = {}) =>
  webview.emitNative('ipc-message', {
    channel: WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
    args: [event],
    ...fields
  })

const stateChanged = (webview: TestWebview, sessionId = sessionOne, enabled = false, count = 1) =>
  guestEvent(webview, { type: 'state_changed', sessionId, enabled, count })

const sentCommands = (webview: TestWebview) =>
  vi.mocked(webview.send).mock.calls.map((call) => call[1] as WebviewAnnotationHostCommand)

describe('WebviewAnnotationControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    request.mockResolvedValue('# Resolved annotations')
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: randomUUID })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
  })

  it('requests state on bind/dom-ready and configures the first live session', async () => {
    const webview = createWebview()
    render(<WebviewAnnotationControls webview={webview} isWebviewReady isHostActive target={target} />)

    expect(sentCommands(webview)).toContainEqual({ type: 'request_state' })
    act(() => stateChanged(webview))
    await waitFor(() =>
      expect(sentCommands(webview)).toContainEqual(
        expect.objectContaining({ type: 'configure', sessionId: sessionOne, theme: 'dark' })
      )
    )

    vi.mocked(webview.send).mockClear()
    act(() => webview.emitNative('dom-ready'))
    expect(sentCommands(webview)).toEqual([{ type: 'request_state' }])
  })

  it('accepts only trusted events from the bound webview and valid channel/schema', () => {
    const webview = createWebview()
    render(<WebviewAnnotationControls webview={webview} isWebviewReady isHostActive target={target} />)

    act(() => {
      guestEvent(
        webview,
        { type: 'state_changed', sessionId: sessionOne, enabled: false, count: 3 },
        { isTrusted: false }
      )
      guestEvent(
        webview,
        { type: 'state_changed', sessionId: sessionOne, enabled: false, count: 4 },
        { currentTarget: null }
      )
      webview.emitNative('ipc-message', {
        channel: 'wrong',
        args: [{ type: 'state_changed', sessionId: sessionOne, enabled: false, count: 5 }]
      })
      webview.emitNative('ipc-message', {
        channel: WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
        args: [{ type: 'state_changed', sessionId: 'invalid', enabled: false, count: 6 }]
      })
    })

    expect(screen.queryByText(/[3-6]/)).not.toBeInTheDocument()
    act(() => stateChanged(webview, sessionOne, false, 2))
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('deactivates an inactive host without discarding its committed count', () => {
    const webview = createWebview()
    const { rerender } = render(
      <WebviewAnnotationControls webview={webview} isWebviewReady isHostActive target={target} />
    )
    act(() => stateChanged(webview, sessionOne, true, 1))

    rerender(<WebviewAnnotationControls webview={webview} isWebviewReady isHostActive={false} target={target} />)

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(sentCommands(webview)).toContainEqual({ type: 'deactivate', sessionId: sessionOne })
  })

  it('retires a new-document session immediately but ignores subframes and same-document navigation', () => {
    const webview = createWebview()
    render(<WebviewAnnotationControls webview={webview} isWebviewReady isHostActive target={target} />)
    act(() => stateChanged(webview, sessionOne, true, 1))

    act(() => webview.emitNative('did-start-navigation', { isMainFrame: false, isInPlace: false }))
    expect(screen.getByText('1')).toBeInTheDocument()
    act(() => webview.emitNative('did-start-navigation', { isMainFrame: true, isInPlace: true }))
    expect(screen.getByText('1')).toBeInTheDocument()

    act(() => webview.emitNative('did-start-navigation', { isMainFrame: true, isInPlace: false }))
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(sentCommands(webview)).toEqual(
      expect.arrayContaining([
        { type: 'deactivate', sessionId: sessionOne },
        { type: 'clear', sessionId: sessionOne }
      ])
    )

    act(() => stateChanged(webview, sessionOne, false, 1))
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    act(() => stateChanged(webview, sessionTwo, false, 2))
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('clears the old target but only reconfigures presentation metadata changes', () => {
    const webview = createWebview()
    const { rerender } = render(
      <WebviewAnnotationControls webview={webview} isWebviewReady isHostActive target={target} />
    )
    act(() => stateChanged(webview, sessionOne, true, 1))
    vi.mocked(webview.send).mockClear()

    rerender(
      <WebviewAnnotationControls webview={webview} isWebviewReady isHostActive target={{ ...target, label: '演示' }} />
    )
    expect(sentCommands(webview)).toContainEqual(expect.objectContaining({ type: 'configure', sessionId: sessionOne }))
    expect(sentCommands(webview)).not.toContainEqual({ type: 'clear', sessionId: sessionOne })

    vi.mocked(webview.send).mockClear()
    rerender(
      <WebviewAnnotationControls
        webview={webview}
        isWebviewReady
        isHostActive
        target={{ id: 'mini-app:other', label: 'Other' }}
      />
    )
    expect(sentCommands(webview)).toContainEqual({ type: 'clear', sessionId: sessionOne })
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('requests one correlated snapshot and exports it before copying', async () => {
    const webview = createWebview()
    render(<WebviewAnnotationControls webview={webview} isWebviewReady isHostActive target={target} />)
    act(() => stateChanged(webview))

    fireEvent.click(screen.getByRole('button', { name: '复制标注 Markdown' }))
    fireEvent.click(screen.getByRole('button', { name: '复制标注 Markdown' }))
    await waitFor(() =>
      expect(sentCommands(webview)).toContainEqual({
        type: 'request_snapshot',
        sessionId: sessionOne,
        requestId: '00000000-0000-4000-8000-000000000010'
      })
    )
    expect(sentCommands(webview).filter((command) => command.type === 'request_snapshot')).toHaveLength(1)
    expect(screen.getByRole('button', { name: '复制标注 Markdown' })).toBeDisabled()

    act(() =>
      guestEvent(webview, {
        type: 'snapshot_ready',
        sessionId: sessionOne,
        requestId: '00000000-0000-4000-8000-000000000010',
        annotations: [annotation]
      })
    )

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('webview.export_annotations', {
        webviewId: 42,
        documentSessionId: sessionOne,
        target,
        annotations: [annotation]
      })
    )
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('# Resolved annotations')
    expect(toastSuccess).toHaveBeenCalledWith('已复制标注')
  })

  it('ignores mismatched snapshots and rejects an empty matching snapshot without calling main', async () => {
    const webview = createWebview()
    render(<WebviewAnnotationControls webview={webview} isWebviewReady isHostActive target={target} />)
    act(() => stateChanged(webview))
    fireEvent.click(screen.getByRole('button', { name: '复制标注 Markdown' }))

    act(() => {
      guestEvent(webview, {
        type: 'snapshot_ready',
        sessionId: sessionTwo,
        requestId: '00000000-0000-4000-8000-000000000010',
        annotations: [annotation]
      })
      guestEvent(webview, {
        type: 'snapshot_ready',
        sessionId: sessionOne,
        requestId: '00000000-0000-4000-8000-000000000099',
        annotations: [annotation]
      })
    })
    expect(request).not.toHaveBeenCalled()

    act(() =>
      guestEvent(webview, {
        type: 'snapshot_ready',
        sessionId: sessionOne,
        requestId: '00000000-0000-4000-8000-000000000010',
        annotations: []
      })
    )
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('复制标注失败'))
    expect(request).not.toHaveBeenCalled()
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('times out a request-scoped snapshot after two seconds', async () => {
    vi.useFakeTimers()
    try {
      const webview = createWebview()
      render(<WebviewAnnotationControls webview={webview} isWebviewReady isHostActive target={target} />)
      act(() => stateChanged(webview))
      fireEvent.click(screen.getByRole('button', { name: '复制标注 Markdown' }))

      await act(async () => vi.advanceTimersByTimeAsync(2_001))

      expect(toastError).toHaveBeenCalledWith('复制标注失败')
      expect(request).not.toHaveBeenCalled()
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not copy a late main result after navigation invalidates the operation', async () => {
    let resolveExport: ((markdown: string) => void) | undefined
    request.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveExport = resolve
        })
    )
    const webview = createWebview()
    render(<WebviewAnnotationControls webview={webview} isWebviewReady isHostActive target={target} />)
    act(() => stateChanged(webview))
    fireEvent.click(screen.getByRole('button', { name: '复制标注 Markdown' }))
    act(() =>
      guestEvent(webview, {
        type: 'snapshot_ready',
        sessionId: sessionOne,
        requestId: '00000000-0000-4000-8000-000000000010',
        annotations: [annotation]
      })
    )
    await waitFor(() => expect(request).toHaveBeenCalledOnce())

    act(() => webview.emitNative('did-start-navigation', { isMainFrame: true, isInPlace: false }))
    resolveExport?.('# stale')

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('复制标注失败'))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('rejects pending snapshots on crash and unregisters every listener on cleanup', async () => {
    const webview = createWebview()
    const { unmount } = render(
      <WebviewAnnotationControls webview={webview} isWebviewReady isHostActive target={target} />
    )
    act(() => stateChanged(webview))
    fireEvent.click(screen.getByRole('button', { name: '复制标注 Markdown' }))
    act(() => webview.emitNative('render-process-gone'))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('复制标注失败'))

    unmount()
    expect(webview.removeEventListener).toHaveBeenCalledTimes(4)
  })
})
