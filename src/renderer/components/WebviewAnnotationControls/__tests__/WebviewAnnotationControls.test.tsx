import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  type WebviewAnnotationGuestEvent,
  type WebviewAnnotationHostCommand
} from '@shared/types/webviewAnnotation'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WebviewTag } from 'electron'
import type { ReactNode, RefObject } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { loggerError, request, toastSuccess, toastError, randomUUID, readPopoverAnchorRect } = vi.hoisted(() => ({
  loggerError: vi.fn(),
  request: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000010'),
  readPopoverAnchorRect: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@renderer/services/toast', () => ({ toast: { success: toastSuccess, error: toastError } }))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'dark' }) }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), error: loggerError }) }
}))
vi.mock('@cherrystudio/ui', () => ({
  Badge: ({ children, ...props }: { children: ReactNode }) => <span {...props}>{children}</span>,
  Button: ({ children, type = 'button', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverAnchor: ({
    children,
    virtualRef
  }: {
    children?: ReactNode
    virtualRef?: RefObject<{ getBoundingClientRect: () => DOMRect }>
  }) => {
    if (virtualRef?.current) readPopoverAnchorRect(virtualRef.current.getBoundingClientRect())
    return <>{children}</>
  },
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Textarea: {
    Input: ({
      onValueChange,
      ...props
    }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
      onValueChange?: (value: string) => void
    }) => <textarea {...props} onChange={(event) => onValueChange?.(event.target.value)} />
  },
  ConfirmDialog: ({ open, title, confirmText, onConfirm, onOpenChange }: any) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button
          type="button"
          onClick={async () => {
            const result = await onConfirm?.()
            if (result !== false) onOpenChange?.(false)
          }}>
          Confirm {confirmText}
        </button>
      </div>
    ) : null
}))

import { WebviewAnnotationControls } from '../WebviewAnnotationControls'

const sessionId = '00000000-0000-4000-8000-000000000001'
const target = { id: 'mini-app:demo', label: 'Demo' }
const annotation = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  comment: 'Fix this button',
  element: { selector: '#submit', tagName: 'button', text: 'Submit', ariaLabel: null, role: 'button' }
}
const annotationSnapshot = [annotation]

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

const guestEvent = (webview: TestWebview, event: WebviewAnnotationGuestEvent) =>
  webview.emitNative('ipc-message', {
    channel: WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
    args: [event]
  })

const stateChanged = (webview: TestWebview, enabled = false, count = 1) =>
  guestEvent(webview, { type: 'state_changed', sessionId, enabled, count })

const snapshotReady = (webview: TestWebview) =>
  guestEvent(webview, {
    type: 'snapshot_ready',
    sessionId,
    requestId: '00000000-0000-4000-8000-000000000010',
    annotations: annotationSnapshot
  })

const sentCommands = (webview: TestWebview) =>
  vi.mocked(webview.send).mock.calls.map((call) => call[1] as WebviewAnnotationHostCommand)

function renderControls(webview: WebviewTag, isHostActive = true) {
  const webviewRef: RefObject<WebviewTag | null> = { current: webview }
  return render(
    <WebviewAnnotationControls
      webviewRef={webviewRef}
      webviewRevision={0}
      isWebviewReady
      isHostActive={isHostActive}
      target={target}
    />
  )
}

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

  it('toggles annotation mode through its accessible pressed control', async () => {
    const user = userEvent.setup()
    const webview = createWebview()
    renderControls(webview)
    act(() => stateChanged(webview, false, 0))

    const toggle = screen.getByRole('button', { name: '标注页面' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)

    expect(sentCommands(webview)).toContainEqual({ type: 'set_enabled', sessionId, enabled: true })
    expect(screen.getByRole('button', { name: '退出标注' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('includes the annotation count in the toggle accessible name', () => {
    const webview = createWebview()
    renderControls(webview)
    act(() => stateChanged(webview, false, 2))

    expect(screen.getByRole('button', { name: /标注页面.*2 条标注/ })).toBeInTheDocument()
    expect(screen.queryByLabelText('2 条标注')).not.toBeInTheDocument()
  })

  it('collects annotation text in the trusted host UI and saves it to the guest', async () => {
    const user = userEvent.setup()
    const webview = createWebview()
    vi.spyOn(webview, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ x: 300, y: 180, width: 900, height: 700 })
    )
    renderControls(webview)
    act(() => stateChanged(webview, true, 0))

    act(() =>
      webview.emitNative('ipc-message', {
        channel: WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
        args: [
          {
            type: 'editor_requested',
            sessionId,
            requestId: '00000000-0000-4000-8000-000000000020',
            comment: '',
            canDelete: false,
            anchor: { x: 120, y: 240, width: 80, height: 32 }
          }
        ]
      })
    )

    const editor = screen.getByRole('textbox')
    expect(readPopoverAnchorRect).toHaveBeenLastCalledWith(
      expect.objectContaining({ x: 420, y: 420, width: 80, height: 32 })
    )
    await user.type(editor, 'Host-owned draft')
    await user.click(screen.getByRole('button', { name: '保存' }))

    expect(sentCommands(webview)).toContainEqual({
      type: 'save_editor',
      sessionId,
      requestId: '00000000-0000-4000-8000-000000000020',
      comment: 'Host-owned draft'
    })
  })

  it('disables copy while pending, writes the result, and reports success', async () => {
    const user = userEvent.setup()
    const webview = createWebview()
    renderControls(webview)
    act(() => stateChanged(webview, false, 2))

    const copy = screen.getByRole('button', { name: '复制标注 Markdown' })
    await user.click(copy)
    expect(copy).toBeDisabled()

    await act(async () => snapshotReady(webview))

    await waitFor(async () => expect(await navigator.clipboard.readText()).toBe('# Resolved annotations'))
    expect(toastSuccess).toHaveBeenCalledWith('已复制标注')
    expect(copy).toBeEnabled()
  })

  it('reports copy failures without changing the clipboard', async () => {
    const user = userEvent.setup()
    request.mockRejectedValue(new Error('AX failed'))
    const webview = createWebview()
    renderControls(webview)
    act(() => stateChanged(webview))

    await user.click(screen.getByRole('button', { name: '复制标注 Markdown' }))
    await act(async () => snapshotReady(webview))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('复制标注失败'))
    expect(loggerError).toHaveBeenCalledOnce()
    expect(await navigator.clipboard.readText()).toBe('')
  })

  it('clears the visible count after confirmation', async () => {
    const user = userEvent.setup()
    const webview = createWebview()
    renderControls(webview)
    act(() => stateChanged(webview, false, 2))

    await user.click(screen.getByRole('button', { name: '清空标注' }))
    const dialog = screen.getByRole('dialog', { name: '清空全部标注？' })
    await user.click(screen.getByRole('button', { name: 'Confirm 清空标注' }))

    expect(dialog).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '标注页面' })).toBeInTheDocument()
    expect(sentCommands(webview)).toContainEqual({ type: 'clear', sessionId })
  })

  it('keeps the clear confirmation open when command delivery rejects', async () => {
    const user = userEvent.setup()
    const webview = createWebview()
    renderControls(webview)
    act(() => stateChanged(webview, false, 2))
    await user.click(screen.getByRole('button', { name: '清空标注' }))
    vi.mocked(webview.send).mockRejectedValueOnce(new Error('guest unavailable'))

    await user.click(screen.getByRole('button', { name: 'Confirm 清空标注' }))

    expect(screen.getByRole('dialog', { name: '清空全部标注？' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /标注页面.*2 条标注/ })).toBeInTheDocument()
  })

  it('closes a delivered clear confirmation when navigation retires its session', async () => {
    const user = userEvent.setup()
    const webview = createWebview()
    renderControls(webview)
    act(() => stateChanged(webview, false, 2))
    await user.click(screen.getByRole('button', { name: '清空标注' }))
    let resolveClear!: () => void
    vi.mocked(webview.send).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveClear = resolve
        })
    )

    await user.click(screen.getByRole('button', { name: 'Confirm 清空标注' }))
    act(() => webview.emitNative('did-start-navigation', { isMainFrame: true, isInPlace: false }))
    await act(async () => {
      resolveClear()
    })

    expect(screen.queryByRole('dialog', { name: '清空全部标注？' })).not.toBeInTheDocument()
  })

  it('closes a clear confirmation when the target identity changes', async () => {
    const user = userEvent.setup()
    const webview = createWebview()
    const webviewRef: RefObject<WebviewTag | null> = { current: webview }
    const view = render(
      <WebviewAnnotationControls
        webviewRef={webviewRef}
        webviewRevision={0}
        isWebviewReady
        isHostActive
        target={target}
      />
    )
    act(() => stateChanged(webview, false, 2))
    await user.click(screen.getByRole('button', { name: '清空标注' }))
    expect(screen.getByRole('dialog', { name: '清空全部标注？' })).toBeInTheDocument()

    view.rerender(
      <WebviewAnnotationControls
        webviewRef={webviewRef}
        webviewRevision={0}
        isWebviewReady
        isHostActive
        target={{ id: 'mini-app:other', label: 'Other' }}
      />
    )

    expect(screen.queryByRole('dialog', { name: '清空全部标注？' })).not.toBeInTheDocument()

    view.rerender(
      <WebviewAnnotationControls
        webviewRef={webviewRef}
        webviewRevision={0}
        isWebviewReady
        isHostActive
        target={target}
      />
    )

    expect(screen.queryByRole('dialog', { name: '清空全部标注？' })).not.toBeInTheDocument()
  })

  it('retains the count but disables every action while the host is inactive', () => {
    const webview = createWebview()
    renderControls(webview, false)
    act(() => stateChanged(webview, true, 1))

    expect(screen.getByRole('button', { name: /标注页面.*1 条标注/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: '复制标注 Markdown' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '清空标注' })).toBeDisabled()
  })
})
