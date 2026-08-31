import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  type WebviewAnnotationGuestEvent,
  type WebviewAnnotationHostCommand
} from '@shared/types/webviewAnnotation'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { request, toastSuccess, toastError } = vi.hoisted(() => ({
  request: vi.fn().mockResolvedValue(undefined),
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@renderer/services/toast', () => ({
  toast: { success: toastSuccess, error: toastError }
}))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: 'dark' }) }))
vi.mock('@cherrystudio/ui', () => ({
  Badge: ({ children, ...props }: { children: ReactNode }) => <span {...props}>{children}</span>,
  Button: ({ children, type = 'button', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  ConfirmDialog: ({
    open,
    title,
    confirmText,
    onConfirm
  }: {
    open: boolean
    title: string
    confirmText: string
    onConfirm: () => void
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <button type="button" onClick={onConfirm}>
          Confirm {confirmText}
        </button>
      </div>
    ) : null
}))

import { WebviewAnnotationControls } from '../WebviewAnnotationControls'

const annotation = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  comment: 'Fix this button',
  createdAt: 1,
  element: {
    selector: '#submit',
    tagName: 'button',
    text: 'Submit',
    ariaLabel: null,
    role: 'button'
  }
}

function createWebview() {
  const element = document.createElement('webview') as unknown as WebviewTag
  Object.assign(element, {
    send: vi.fn().mockResolvedValue(undefined),
    getWebContentsId: vi.fn(() => 42),
    getTitle: vi.fn(() => 'Demo page'),
    getURL: vi.fn(() => 'https://example.com/page?secret=yes#part')
  })
  return element
}

function dispatchGuestState(webview: WebviewTag, state: WebviewAnnotationGuestEvent['state']) {
  const event = Object.assign(new Event('ipc-message'), {
    channel: WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
    args: [{ type: 'state_changed', state } satisfies WebviewAnnotationGuestEvent]
  })
  webview.dispatchEvent(event)
}

const target = { id: 'mini-app:demo', label: 'Demo' }

describe('WebviewAnnotationControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    request.mockImplementation((route: string) =>
      Promise.resolve(
        route === 'webview.get_annotations_markdown'
          ? '## Demo\n\n> Fix this button\n\n- URL: `https://example.com/page`\n- Accessibility status: `available`'
          : undefined
      )
    )
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
  })

  it('compensates for a missed guest handshake and toggles selection mode', async () => {
    const webview = createWebview()
    render(<WebviewAnnotationControls webviewRef={{ current: webview }} isWebviewReady isHostActive target={target} />)

    await waitFor(() => {
      const commands = vi.mocked(webview.send).mock.calls.map((call) => call[1] as WebviewAnnotationHostCommand)
      expect(commands).toContainEqual(expect.objectContaining({ type: 'configure', theme: 'dark' }))
      expect(commands).toContainEqual({ type: 'request_state' })
    })

    fireEvent.click(screen.getByRole('button', { name: '标注页面' }))
    expect(webview.send).toHaveBeenCalledWith(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, {
      type: 'set_enabled',
      enabled: true
    })
    expect(screen.getByRole('button', { name: '退出标注' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps annotations while deactivating a host tab and resets them on navigation', async () => {
    const webview = createWebview()
    const { rerender } = render(
      <WebviewAnnotationControls webviewRef={{ current: webview }} isWebviewReady isHostActive target={target} />
    )
    act(() => dispatchGuestState(webview, { enabled: true, annotations: [annotation] }))
    expect(await screen.findByText('1')).toBeInTheDocument()

    rerender(
      <WebviewAnnotationControls
        webviewRef={{ current: webview }}
        isWebviewReady
        isHostActive={false}
        target={target}
      />
    )
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(webview.send).toHaveBeenCalledWith(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, {
      type: 'set_enabled',
      enabled: false
    })

    act(() => {
      webview.dispatchEvent(Object.assign(new Event('did-navigate-in-page'), { isMainFrame: false }))
    })
    expect(screen.getByText('1')).toBeInTheDocument()

    act(() => {
      webview.dispatchEvent(Object.assign(new Event('did-navigate-in-page'), { isMainFrame: true }))
    })
    await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument())
    expect(request).toHaveBeenCalledWith('webview.replace_annotations', {
      webviewId: 42,
      target,
      annotations: []
    })
  })

  it('synchronizes counts, copies Markdown, and clears after confirmation', async () => {
    const webview = createWebview()
    render(<WebviewAnnotationControls webviewRef={{ current: webview }} isWebviewReady isHostActive target={target} />)
    act(() => dispatchGuestState(webview, { enabled: false, annotations: [annotation] }))

    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('webview.replace_annotations', {
        webviewId: 42,
        target,
        annotations: [annotation]
      })
    )
    fireEvent.click(screen.getByRole('button', { name: '复制标注 Markdown' }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
    const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]
    expect(copied).toContain('Fix this button')
    expect(copied).toContain('https://example.com/page')
    expect(copied).toContain('Accessibility status')
    expect(request).toHaveBeenCalledWith('webview.get_annotations_markdown', { webviewId: 42 })
    expect(toastSuccess).toHaveBeenCalledWith('已复制标注')

    fireEvent.click(screen.getByRole('button', { name: '清空标注' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm 清空标注' }))
    expect(webview.send).toHaveBeenCalledWith(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, { type: 'clear' })
    await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument())
  })

  it('disables repeated copies while main resolves accessibility context', async () => {
    let resolveMarkdown: ((value: string) => void) | undefined
    request.mockImplementation((route: string) =>
      route === 'webview.get_annotations_markdown'
        ? new Promise<string>((resolve) => {
            resolveMarkdown = resolve
          })
        : Promise.resolve(undefined)
    )
    const webview = createWebview()
    render(<WebviewAnnotationControls webviewRef={{ current: webview }} isWebviewReady isHostActive target={target} />)
    act(() => dispatchGuestState(webview, { enabled: false, annotations: [annotation] }))

    const copyButton = await screen.findByRole('button', { name: '复制标注 Markdown' })
    fireEvent.click(copyButton)
    await waitFor(() => expect(copyButton).toBeDisabled())

    resolveMarkdown?.('# Resolved annotations')
    await waitFor(() => expect(copyButton).not.toBeDisabled())
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('# Resolved annotations')
  })

  it('shows the existing error feedback and avoids stale output when the current snapshot cannot be synchronized', async () => {
    request.mockImplementation((route: string) =>
      route === 'webview.replace_annotations'
        ? Promise.reject(new Error('Synchronization failed'))
        : Promise.resolve('')
    )
    const webview = createWebview()
    render(<WebviewAnnotationControls webviewRef={{ current: webview }} isWebviewReady isHostActive target={target} />)
    act(() => dispatchGuestState(webview, { enabled: false, annotations: [annotation] }))

    fireEvent.click(await screen.findByRole('button', { name: '复制标注 Markdown' }))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('复制标注失败'))
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    expect(request).not.toHaveBeenCalledWith('webview.get_annotations_markdown', expect.anything())
  })
})
