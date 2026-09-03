import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  type WebviewAnnotationGuestEvent,
  type WebviewAnnotationHostCommand,
  type WebviewAnnotationState,
  type WebviewAnnotationTarget
} from '@shared/types/webview'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import { type ReactNode, useLayoutEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { request, themeState, toastSuccess, toastError } = vi.hoisted(() => ({
  request: vi.fn().mockResolvedValue(undefined),
  themeState: { current: 'dark' },
  toastSuccess: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@renderer/services/toast', () => ({
  toast: { success: toastSuccess, error: toastError }
}))
vi.mock('@renderer/hooks/useTheme', () => ({ useTheme: () => ({ theme: themeState.current }) }))
vi.mock('@cherrystudio/ui', () => ({
  Badge: ({ children, ...props }: { children: ReactNode }) => <span {...props}>{children}</span>,
  Button: ({
    children,
    type = 'button',
    loading: _loading,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) => (
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

// The annotation editor reuses the composer editor kernel; fake the TipTap layer
// with a plain textarea so the host command flow stays testable in jsdom.
vi.mock('@renderer/components/composer/composerPreset', () => ({
  createComposerEditorPreset: (options: { placeholder?: string }) => options
}))
vi.mock('@renderer/components/composer/composerDraft', () => ({
  createComposerDraftContent: ({ text }: { text: string }) => text,
  serializeComposerDocument: (source: unknown) => ({
    text:
      typeof source === 'object' && source !== null && 'text' in source
        ? String((source as { text: unknown }).text)
        : '',
    tokens: []
  })
}))
vi.mock('@renderer/components/RichEditor/useRichTextEditorKernel', () => ({
  useRichTextEditorKernel: (options: unknown) => options
}))
vi.mock('@tiptap/react', () => ({
  EditorContent: ({ editor }: { editor: FakeKernelOptions }) => (
    <textarea
      aria-label={editor.editorProps.attributes['aria-label']}
      placeholder={editor.extensions.placeholder}
      defaultValue={editor.content}
      onChange={(event) => editor.onUpdate?.({ editor: { text: event.target.value } })}
      onKeyDown={(event) =>
        editor.editorProps.handleKeyDown?.(
          { state: { doc: { toJSON: () => ({ text: event.currentTarget.value }) } } },
          event
        )
      }
    />
  )
}))

interface FakeKernelOptions {
  content: string
  extensions: { placeholder?: string }
  editorProps: {
    attributes: Record<string, string>
    handleKeyDown?: (view: unknown, event: unknown) => boolean
  }
  onUpdate?: (payload: { editor: { text: string } }) => void
}

import { WebviewAnnotationControls, type WebviewAnnotationSavedPayload } from '../WebviewAnnotationControls'

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

function dispatchGuestEvent(webview: WebviewTag, guestEvent: WebviewAnnotationGuestEvent) {
  const event = Object.assign(new Event('ipc-message'), {
    channel: WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
    args: [guestEvent]
  })
  webview.dispatchEvent(event)
}

function dispatchGuestState(webview: WebviewTag, state: WebviewAnnotationState) {
  dispatchGuestEvent(webview, { type: 'state_changed', state })
}

interface LayoutAckHarnessProps {
  webviewRef: { current: WebviewTag | null }
  isWebviewReady: boolean
  isHostActive: boolean
  target: WebviewAnnotationTarget
  onAnnotationSaved: (payload: WebviewAnnotationSavedPayload) => void
  layoutAck?: { webview: WebviewTag; state: WebviewAnnotationState }
  renderControls?: boolean
}

function LayoutAckHarness({
  webviewRef,
  isWebviewReady,
  isHostActive,
  target,
  onAnnotationSaved,
  layoutAck,
  renderControls = true
}: LayoutAckHarnessProps) {
  useLayoutEffect(() => {
    if (layoutAck) dispatchGuestState(layoutAck.webview, layoutAck.state)
  }, [layoutAck])

  return renderControls ? (
    <WebviewAnnotationControls
      webviewRef={webviewRef}
      isWebviewReady={isWebviewReady}
      isHostActive={isHostActive}
      target={target}
      onAnnotationSaved={onAnnotationSaved}
    />
  ) : null
}

function commitCommands(webview: WebviewTag) {
  return vi
    .mocked(webview.send)
    .mock.calls.map((call) => call[1] as WebviewAnnotationHostCommand)
    .filter(
      (command): command is Extract<WebviewAnnotationHostCommand, { type: 'commit_pending' }> =>
        command.type === 'commit_pending'
    )
}

function requestStateCommands(webview: WebviewTag) {
  return vi
    .mocked(webview.send)
    .mock.calls.map((call) => call[1] as WebviewAnnotationHostCommand)
    .filter((command) => command.type === 'request_state')
}

function replaceAnnotationRequests() {
  return request.mock.calls.filter(([route]) => route === 'webview.replace_annotations')
}

function openCreateEditor(webview: WebviewTag) {
  act(() =>
    dispatchGuestEvent(webview, {
      type: 'selection_pending',
      selection: { element: annotation.element, anchor: { x: 10, y: 20, width: 100, height: 40 } }
    })
  )
  return screen.getByPlaceholderText('描述需要修改的内容或你注意到的问题…')
}

function saveCreateEditor(webview: WebviewTag, comment: string) {
  const textarea = openCreateEditor(webview)
  fireEvent.change(textarea, { target: { value: comment } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  return { command: commitCommands(webview).at(-1)!, textarea }
}

const target = { id: 'mini-app:demo', label: 'Demo' }

describe('WebviewAnnotationControls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    themeState.current = 'dark'
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

  it('keeps inactive annotations and blocks delayed in-page state until the reset snapshot', async () => {
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
      webview.dispatchEvent(new Event('did-navigate-in-page'))
    })
    const replaceRequestsAfterNavigation = replaceAnnotationRequests().length
    act(() => dispatchGuestState(webview, { enabled: true, annotations: [annotation] }))

    await waitFor(() => expect(screen.queryByText('1')).not.toBeInTheDocument())
    expect(replaceAnnotationRequests()).toHaveLength(replaceRequestsAfterNavigation)

    await act(async () => {
      await Promise.resolve()
    })
    act(() => dispatchGuestState(webview, { enabled: false, annotations: [] }))
    const newPageAnnotation = { ...annotation, comment: 'New in-page state' }
    act(() => dispatchGuestState(webview, { enabled: true, annotations: [newPageAnnotation] }))

    expect(screen.getByText('1')).toBeInTheDocument()
    expect(request).toHaveBeenLastCalledWith('webview.replace_annotations', {
      webviewId: 42,
      target,
      annotations: [newPageAnnotation]
    })
  })

  it('blocks delayed old-page state until a full-navigation document handshake', async () => {
    const webview = createWebview()
    const onAnnotationSaved = vi.fn()
    render(
      <WebviewAnnotationControls
        webviewRef={{ current: webview }}
        isWebviewReady
        isHostActive
        target={target}
        onAnnotationSaved={onAnnotationSaved}
      />
    )
    const pending = saveCreateEditor(webview, 'Old page pending annotation').command
    const oldPageState = {
      enabled: true,
      annotations: [{ ...annotation, id: pending.id, comment: 'Delayed old-page state' }]
    }

    act(() => {
      webview.dispatchEvent(new Event('did-start-loading'))
      webview.dispatchEvent(new Event('did-navigate-in-page'))
    })
    const replaceRequestsAfterNavigation = replaceAnnotationRequests().length
    act(() => dispatchGuestState(webview, oldPageState))

    expect(onAnnotationSaved).not.toHaveBeenCalled()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(replaceAnnotationRequests()).toHaveLength(replaceRequestsAfterNavigation)

    await act(async () => {
      await Promise.resolve()
    })
    act(() => dispatchGuestState(webview, { enabled: false, annotations: [] }))
    act(() => dispatchGuestState(webview, oldPageState))
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(replaceAnnotationRequests()).toHaveLength(replaceRequestsAfterNavigation)

    act(() => webview.dispatchEvent(new Event('dom-ready')))
    const replaceRequestsAfterDomReady = replaceAnnotationRequests().length
    act(() => dispatchGuestState(webview, { enabled: false, annotations: [] }))
    act(() => dispatchGuestState(webview, oldPageState))
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(replaceAnnotationRequests()).toHaveLength(replaceRequestsAfterDomReady)

    await act(async () => {
      await Promise.resolve()
    })
    act(() => dispatchGuestState(webview, { enabled: false, annotations: [] }))

    const replaceRequestsBeforeNewState = replaceAnnotationRequests().length
    const newPageAnnotation = { ...annotation, comment: 'Trusted new-page state' }
    act(() => dispatchGuestState(webview, { enabled: true, annotations: [newPageAnnotation] }))

    expect(onAnnotationSaved).not.toHaveBeenCalled()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(replaceAnnotationRequests()).toHaveLength(replaceRequestsBeforeNewState + 1)
    expect(request).toHaveBeenLastCalledWith('webview.replace_annotations', {
      webviewId: 42,
      target,
      annotations: [newPageAnnotation]
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

  it('reports a created annotation exactly once only after its authoritative guest snapshot arrives', async () => {
    const webview = createWebview()
    let rejectCommit: ((reason?: unknown) => void) | undefined
    const commitPromise = new Promise<void>((_resolve, reject) => {
      rejectCommit = reject
    })
    vi.mocked(webview.send).mockImplementation((_channel, command: WebviewAnnotationHostCommand) =>
      command.type === 'commit_pending' ? commitPromise : Promise.resolve()
    )
    const onAnnotationSaved = vi.fn()
    render(
      <WebviewAnnotationControls
        webviewRef={{ current: webview }}
        isWebviewReady
        isHostActive
        target={target}
        onAnnotationSaved={onAnnotationSaved}
      />
    )

    const { command } = saveCreateEditor(webview, '整理这块重叠区域')
    expect(command).toMatchObject({ comment: '整理这块重叠区域' })
    expect(onAnnotationSaved).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('描述需要修改的内容或你注意到的问题…')).toBeInTheDocument()

    act(() => dispatchGuestState(webview, { enabled: true, annotations: [annotation] }))
    expect(onAnnotationSaved).not.toHaveBeenCalled()
    expect(screen.getByPlaceholderText('描述需要修改的内容或你注意到的问题…')).toBeInTheDocument()

    vi.mocked(webview.getURL).mockReturnValue('https://example.com/changed-after-save')
    const guestAnnotation = {
      ...annotation,
      id: command.id,
      comment: 'Guest canonical comment',
      createdAt: 99
    }
    act(() => dispatchGuestState(webview, { enabled: true, annotations: [guestAnnotation] }))
    act(() => dispatchGuestState(webview, { enabled: true, annotations: [guestAnnotation] }))

    expect(onAnnotationSaved).toHaveBeenCalledWith({
      annotation: guestAnnotation,
      page: { url: 'https://example.com/page?secret=yes#part', title: 'Demo page' }
    })
    expect(onAnnotationSaved).toHaveBeenCalledTimes(1)
    expect(screen.queryByPlaceholderText('描述需要修改的内容或你注意到的问题…')).not.toBeInTheDocument()

    await act(async () => {
      rejectCommit?.(new Error('Late send rejection'))
      await Promise.resolve()
    })
    expect(onAnnotationSaved).toHaveBeenCalledTimes(1)
    expect(screen.queryByPlaceholderText('描述需要修改的内容或你注意到的问题…')).not.toBeInTheDocument()
  })

  it('gates repeated saves and keeps the editor retryable when sending the commit rejects', async () => {
    let rejectCommit: ((reason?: unknown) => void) | undefined
    const commitPromise = new Promise<void>((_resolve, reject) => {
      rejectCommit = reject
    })
    const webview = createWebview()
    vi.mocked(webview.send).mockImplementation((_channel, command: WebviewAnnotationHostCommand) =>
      command.type === 'commit_pending' ? commitPromise : Promise.resolve()
    )
    const onAnnotationSaved = vi.fn()
    render(
      <WebviewAnnotationControls
        webviewRef={{ current: webview }}
        isWebviewReady
        isHostActive
        target={target}
        onAnnotationSaved={onAnnotationSaved}
      />
    )

    const { command: firstCommand, textarea } = saveCreateEditor(webview, 'Retry this annotation')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(commitCommands(webview)).toHaveLength(1)

    act(() => rejectCommit?.(new Error('Guest detached')))
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).not.toBeDisabled())
    expect(onAnnotationSaved).not.toHaveBeenCalled()

    vi.mocked(webview.send).mockResolvedValue(undefined)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    const commands = commitCommands(webview)
    expect(commands).toHaveLength(2)
    expect(commands[1].id).toBe(firstCommand.id)
    expect(onAnnotationSaved).not.toHaveBeenCalled()

    const guestAnnotation = { ...annotation, id: firstCommand.id, comment: 'Guest committed before rejection' }
    act(() => dispatchGuestState(webview, { enabled: true, annotations: [guestAnnotation] }))
    expect(onAnnotationSaved).toHaveBeenCalledWith({
      annotation: guestAnnotation,
      page: { url: 'https://example.com/page?secret=yes#part', title: 'Demo page' }
    })
    expect(onAnnotationSaved).toHaveBeenCalledTimes(1)
  })

  it('reuses the correlation id and requests authoritative state after an acknowledged retry', async () => {
    vi.useFakeTimers()
    try {
      const webview = createWebview()
      let rejectFirstAttempt: ((reason?: unknown) => void) | undefined
      const firstAttempt = new Promise<void>((_resolve, reject) => {
        rejectFirstAttempt = reject
      })
      let commitAttempt = 0
      let guestAnnotation: typeof annotation | undefined
      vi.mocked(webview.send).mockImplementation((_channel, command: WebviewAnnotationHostCommand) => {
        if (command.type !== 'commit_pending') return Promise.resolve()
        commitAttempt++
        if (commitAttempt === 1) {
          guestAnnotation = { ...annotation, id: command.id, comment: 'Committed on the first attempt' }
        }
        return commitAttempt === 1 ? firstAttempt : Promise.resolve()
      })
      const onAnnotationSaved = vi.fn()
      render(
        <WebviewAnnotationControls
          webviewRef={{ current: webview }}
          isWebviewReady
          isHostActive
          target={target}
          onAnnotationSaved={onAnnotationSaved}
        />
      )

      const initialStateRequests = requestStateCommands(webview).length
      const firstCommand = saveCreateEditor(webview, 'Wait for the guest').command
      expect(guestAnnotation?.id).toBe(firstCommand.id)
      expect(requestStateCommands(webview)).toHaveLength(initialStateRequests)
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

      act(() => vi.advanceTimersByTime(5_000))

      expect(requestStateCommands(webview)).toHaveLength(initialStateRequests)
      expect(screen.getByRole('button', { name: '保存' })).not.toBeDisabled()
      expect(onAnnotationSaved).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: '保存' }))
      const commands = commitCommands(webview)
      expect(commands).toHaveLength(2)
      expect(commands[1].id).toBe(firstCommand.id)
      expect(requestStateCommands(webview)).toHaveLength(initialStateRequests)

      await act(async () => {
        await Promise.resolve()
      })
      expect(requestStateCommands(webview)).toHaveLength(initialStateRequests + 1)
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

      await act(async () => {
        rejectFirstAttempt?.(new Error('Late rejection from the timed-out attempt'))
        await Promise.resolve()
      })
      expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()

      act(() => dispatchGuestState(webview, { enabled: true, annotations: [guestAnnotation!] }))
      act(() => dispatchGuestState(webview, { enabled: true, annotations: [guestAnnotation!] }))
      expect(onAnnotationSaved).toHaveBeenCalledWith({
        annotation: guestAnnotation,
        page: { url: 'https://example.com/page?secret=yes#part', title: 'Demo page' }
      })
      expect(onAnnotationSaved).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('invalidates pending creates on cancel, navigation, target changes, and host detach', async () => {
    const webview = createWebview()
    const onAnnotationSaved = vi.fn()
    const view = render(
      <WebviewAnnotationControls
        webviewRef={{ current: webview }}
        isWebviewReady
        isHostActive
        target={target}
        onAnnotationSaved={onAnnotationSaved}
      />
    )

    const cancelled = saveCreateEditor(webview, 'Cancel this').command
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    act(() => dispatchGuestState(webview, { enabled: true, annotations: [{ ...annotation, id: cancelled.id }] }))

    const navigated = saveCreateEditor(webview, 'Navigate away').command
    act(() => webview.dispatchEvent(new Event('did-start-loading')))
    act(() => dispatchGuestState(webview, { enabled: true, annotations: [{ ...annotation, id: navigated.id }] }))
    act(() => webview.dispatchEvent(new Event('dom-ready')))
    await act(async () => {
      await Promise.resolve()
    })
    act(() => dispatchGuestState(webview, { enabled: false, annotations: [] }))

    const targetChanged = saveCreateEditor(webview, 'Switch target').command
    const nextTarget = { id: 'mini-app:other', label: 'Other' }
    view.rerender(
      <WebviewAnnotationControls
        webviewRef={{ current: webview }}
        isWebviewReady
        isHostActive
        target={nextTarget}
        onAnnotationSaved={onAnnotationSaved}
      />
    )
    act(() => dispatchGuestState(webview, { enabled: true, annotations: [{ ...annotation, id: targetChanged.id }] }))

    const detached = saveCreateEditor(webview, 'Detach host').command
    view.rerender(
      <WebviewAnnotationControls
        webviewRef={{ current: webview }}
        isWebviewReady
        isHostActive={false}
        target={nextTarget}
        onAnnotationSaved={onAnnotationSaved}
      />
    )
    act(() => dispatchGuestState(webview, { enabled: true, annotations: [{ ...annotation, id: detached.id }] }))

    expect(onAnnotationSaved).not.toHaveBeenCalled()
  })

  it('rejects a matching guest snapshot during the target-change commit before passive cleanup', () => {
    const webview = createWebview()
    const webviewRef = { current: webview }
    const onAnnotationSaved = vi.fn()
    const view = render(
      <LayoutAckHarness
        webviewRef={webviewRef}
        isWebviewReady
        isHostActive
        target={target}
        onAnnotationSaved={onAnnotationSaved}
      />
    )
    const pending = saveCreateEditor(webview, 'Old target annotation').command
    const replaceRequestsBeforeTargetChange = replaceAnnotationRequests().length

    view.rerender(
      <LayoutAckHarness
        webviewRef={webviewRef}
        isWebviewReady
        isHostActive
        target={{ id: 'mini-app:new-target', label: 'New target' }}
        onAnnotationSaved={onAnnotationSaved}
        layoutAck={{ webview, state: { enabled: true, annotations: [{ ...annotation, id: pending.id }] } }}
      />
    )

    expect(onAnnotationSaved).not.toHaveBeenCalled()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(replaceAnnotationRequests()).toHaveLength(replaceRequestsBeforeTargetChange)
  })

  it('rejects a matching guest snapshot during host deactivation before passive cleanup', () => {
    const webview = createWebview()
    const webviewRef = { current: webview }
    const onAnnotationSaved = vi.fn()
    const view = render(
      <LayoutAckHarness
        webviewRef={webviewRef}
        isWebviewReady
        isHostActive
        target={target}
        onAnnotationSaved={onAnnotationSaved}
      />
    )
    const pending = saveCreateEditor(webview, 'Inactive host annotation').command
    const replaceRequestsBeforeDeactivation = replaceAnnotationRequests().length

    view.rerender(
      <LayoutAckHarness
        webviewRef={webviewRef}
        isWebviewReady
        isHostActive={false}
        target={target}
        onAnnotationSaved={onAnnotationSaved}
        layoutAck={{ webview, state: { enabled: true, annotations: [{ ...annotation, id: pending.id }] } }}
      />
    )

    expect(onAnnotationSaved).not.toHaveBeenCalled()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(replaceAnnotationRequests()).toHaveLength(replaceRequestsBeforeDeactivation + 1)
  })

  it('rejects a matching snapshot from the detached webview before passive cleanup', () => {
    const webview = createWebview()
    const webviewRef: { current: WebviewTag | null } = { current: webview }
    const onAnnotationSaved = vi.fn()
    const view = render(
      <LayoutAckHarness
        webviewRef={webviewRef}
        isWebviewReady
        isHostActive
        target={target}
        onAnnotationSaved={onAnnotationSaved}
      />
    )
    const pending = saveCreateEditor(webview, 'Detached guest annotation').command
    const replaceRequestsBeforeDetach = replaceAnnotationRequests().length

    webviewRef.current = createWebview()
    view.rerender(
      <LayoutAckHarness
        webviewRef={webviewRef}
        isWebviewReady={false}
        isHostActive
        target={target}
        onAnnotationSaved={onAnnotationSaved}
        layoutAck={{ webview, state: { enabled: true, annotations: [{ ...annotation, id: pending.id }] } }}
      />
    )

    expect(onAnnotationSaved).not.toHaveBeenCalled()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
    expect(replaceAnnotationRequests()).toHaveLength(replaceRequestsBeforeDetach)
  })

  it('rejects a matching snapshot during unmount commit before passive listener cleanup', () => {
    const webview = createWebview()
    const webviewRef = { current: webview }
    const onAnnotationSaved = vi.fn()
    const view = render(
      <LayoutAckHarness
        webviewRef={webviewRef}
        isWebviewReady
        isHostActive
        target={target}
        onAnnotationSaved={onAnnotationSaved}
      />
    )
    const pending = saveCreateEditor(webview, 'Unmount this annotation').command
    const replaceRequestsBeforeUnmount = replaceAnnotationRequests().length

    view.rerender(
      <LayoutAckHarness
        webviewRef={webviewRef}
        isWebviewReady
        isHostActive
        target={target}
        onAnnotationSaved={onAnnotationSaved}
        layoutAck={{ webview, state: { enabled: true, annotations: [{ ...annotation, id: pending.id }] } }}
        renderControls={false}
      />
    )

    expect(onAnnotationSaved).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText('描述需要修改的内容或你注意到的问题…')).not.toBeInTheDocument()
    expect(replaceAnnotationRequests()).toHaveLength(replaceRequestsBeforeUnmount)
  })

  it('keeps an in-flight create save across a theme update', () => {
    const webview = createWebview()
    const onAnnotationSaved = vi.fn()
    const view = render(
      <WebviewAnnotationControls
        webviewRef={{ current: webview }}
        isWebviewReady
        isHostActive
        target={target}
        onAnnotationSaved={onAnnotationSaved}
      />
    )
    const pending = saveCreateEditor(webview, 'Survive theme update').command

    themeState.current = 'light'
    view.rerender(
      <WebviewAnnotationControls
        webviewRef={{ current: webview }}
        isWebviewReady
        isHostActive
        target={target}
        onAnnotationSaved={onAnnotationSaved}
      />
    )
    const guestAnnotation = { ...annotation, id: pending.id }
    act(() => dispatchGuestState(webview, { enabled: true, annotations: [guestAnnotation] }))

    expect(onAnnotationSaved).toHaveBeenCalledWith({
      annotation: guestAnnotation,
      page: { url: 'https://example.com/page?secret=yes#part', title: 'Demo page' }
    })
  })

  it('keeps an in-flight create save when only the target label changes', () => {
    const webview = createWebview()
    const onAnnotationSaved = vi.fn()
    const view = render(
      <WebviewAnnotationControls
        webviewRef={{ current: webview }}
        isWebviewReady
        isHostActive
        target={target}
        onAnnotationSaved={onAnnotationSaved}
      />
    )
    const pending = saveCreateEditor(webview, 'Survive label update').command

    view.rerender(
      <WebviewAnnotationControls
        webviewRef={{ current: webview }}
        isWebviewReady
        isHostActive
        target={{ ...target, label: 'Renamed demo' }}
        onAnnotationSaved={onAnnotationSaved}
      />
    )
    const guestAnnotation = { ...annotation, id: pending.id }
    act(() => dispatchGuestState(webview, { enabled: true, annotations: [guestAnnotation] }))

    expect(onAnnotationSaved).toHaveBeenCalledWith({
      annotation: guestAnnotation,
      page: { url: 'https://example.com/page?secret=yes#part', title: 'Demo page' }
    })
  })

  it('edits and deletes an existing annotation through the host editor', async () => {
    const webview = createWebview()
    render(<WebviewAnnotationControls webviewRef={{ current: webview }} isWebviewReady isHostActive target={target} />)
    act(() => dispatchGuestState(webview, { enabled: true, annotations: [annotation] }))
    act(() =>
      dispatchGuestEvent(webview, {
        type: 'annotation_activated',
        id: annotation.id,
        anchor: { x: 5, y: 5, width: 60, height: 30 }
      })
    )

    const textarea = await screen.findByPlaceholderText('描述需要修改的内容或你注意到的问题…')
    expect(textarea).toHaveValue('Fix this button')
    fireEvent.change(textarea, { target: { value: 'Updated note' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(webview.send).toHaveBeenCalledWith(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, {
      type: 'update_annotation',
      id: annotation.id,
      comment: 'Updated note'
    })

    act(() =>
      dispatchGuestEvent(webview, {
        type: 'annotation_activated',
        id: annotation.id,
        anchor: { x: 5, y: 5, width: 60, height: 30 }
      })
    )
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    expect(webview.send).toHaveBeenCalledWith(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, {
      type: 'delete_annotation',
      id: annotation.id
    })
  })

  it('cancels a pending selection when the editor is dismissed', async () => {
    const webview = createWebview()
    render(<WebviewAnnotationControls webviewRef={{ current: webview }} isWebviewReady isHostActive target={target} />)
    act(() =>
      dispatchGuestEvent(webview, {
        type: 'selection_pending',
        selection: { element: annotation.element, anchor: { x: 0, y: 0, width: 10, height: 10 } }
      })
    )

    const textarea = await screen.findByPlaceholderText('描述需要修改的内容或你注意到的问题…')
    fireEvent.keyDown(textarea, { key: 'Escape' })
    expect(webview.send).toHaveBeenCalledWith(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, { type: 'cancel_pending' })
    expect(screen.queryByPlaceholderText('描述需要修改的内容或你注意到的问题…')).not.toBeInTheDocument()
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
