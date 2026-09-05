import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  type WebviewAnnotationGuestEvent,
  type WebviewAnnotationHostCommand,
  type WebviewAnnotationLocale,
  type WebviewAnnotationTarget
} from '@shared/types/webviewAnnotation'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import type { RefObject } from 'react'
import { Activity, startTransition, Suspense, useLayoutEffect, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { request, randomUUID } = vi.hoisted(() => ({
  request: vi.fn(),
  randomUUID: vi.fn(() => '00000000-0000-4000-8000-000000000010')
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request } }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn() }) }
}))

import { useWebviewAnnotationSession } from '../useWebviewAnnotationSession'

const sessionOne = '00000000-0000-4000-8000-000000000001'
const sessionTwo = '00000000-0000-4000-8000-000000000002'
const target: WebviewAnnotationTarget = { id: 'mini-app:demo', label: 'Demo' }
const locale: WebviewAnnotationLocale = {
  edit: 'Edit'
}
const annotation = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  comment: 'Fix this button',
  element: { selector: '#submit', tagName: 'button', text: 'Submit', ariaLabel: null, role: 'button' }
}

interface TestWebview extends WebviewTag {
  emitNative: (type: string, event?: Record<string, unknown>) => void
}

interface HookProps {
  webviewRef: RefObject<WebviewTag | null>
  webviewRevision: number
  isHostActive: boolean
  target: WebviewAnnotationTarget
  locale: WebviewAnnotationLocale
  theme: 'light' | 'dark'
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
        listener({ isTrusted: false, currentTarget: element, ...fields } as unknown as Event)
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

const snapshotReady = (
  webview: TestWebview,
  sessionId = sessionOne,
  requestId = '00000000-0000-4000-8000-000000000010',
  annotations = [annotation]
) => guestEvent(webview, { type: 'snapshot_ready', sessionId, requestId, annotations })

const sentCommands = (webview: TestWebview) =>
  vi.mocked(webview.send).mock.calls.map((call) => call[1] as WebviewAnnotationHostCommand)

const createWebviewRef = (webview: WebviewTag | null): RefObject<WebviewTag | null> => ({ current: webview })

const initialProps = (webviewRef: RefObject<WebviewTag | null>, overrides: Partial<HookProps> = {}): HookProps => ({
  webviewRef,
  webviewRevision: 0,
  isHostActive: true,
  target,
  locale,
  theme: 'dark',
  ...overrides
})

function SessionHarness({ webviewRef, onCommit }: { webviewRef: RefObject<WebviewTag | null>; onCommit: () => void }) {
  useWebviewAnnotationSession(initialProps(webviewRef))
  useLayoutEffect(onCommit, [onCommit])
  return null
}

function SuspendedSibling({ suspend }: { suspend: Promise<never> }) {
  const [blocked, setBlocked] = useState(false)
  useLayoutEffect(() => {
    startSuspendingSibling = () => setBlocked(true)
  }, [])
  if (blocked) throw suspend
  return null
}

function SessionStateHarness({ webviewRef }: { webviewRef: RefObject<WebviewTag | null> }) {
  const session = useWebviewAnnotationSession(initialProps(webviewRef))
  return <output aria-label="Annotation state">{`${session.ready}:${session.enabled}:${session.count}`}</output>
}

let startSuspendingSibling: (() => void) | undefined

describe('useWebviewAnnotationSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    startSuspendingSibling = undefined
    request.mockResolvedValue('# Resolved annotations')
    Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: randomUUID })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) }
    })
  })

  it('binds the guest during a visible Activity commit before native events can fire', () => {
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    let boundDuringCommit = false

    render(
      <Activity mode="visible">
        <SessionHarness
          webviewRef={webviewRef}
          onCommit={() => {
            boundDuringCommit =
              ['ipc-message', 'did-start-navigation', 'render-process-gone', 'dom-ready'].every((type) =>
                vi.mocked(webview.addEventListener).mock.calls.some(([registeredType]) => registeredType === type)
              ) && sentCommands(webview).some((command) => command.type === 'request_state')
          }}
        />
      </Activity>
    )

    expect(boundDuringCommit).toBe(true)
  })

  it('accepts an Electron guest event emitted by the bound webview', () => {
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webviewRef)))

    act(() => stateChanged(webview, sessionOne, true, 3))

    expect(result.current).toMatchObject({ ready: true, enabled: true, count: 3 })
  })

  it('owns the editor draft and sends a correlated save back to the guest', () => {
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webviewRef)))
    act(() => stateChanged(webview, sessionOne, true, 0))

    act(() =>
      guestEvent(webview, {
        type: 'editor_requested',
        sessionId: sessionOne,
        requestId: '00000000-0000-4000-8000-000000000020',
        comment: '',
        canDelete: false,
        anchor: { x: 120, y: 240, width: 80, height: 32 }
      })
    )

    expect(result.current.editor).toMatchObject({
      draft: '',
      canDelete: false,
      error: null,
      anchor: { x: 120, y: 240, width: 80, height: 32 }
    })
    act(() => result.current.setEditorDraft('Host-owned draft'))
    expect(result.current.editor?.draft).toBe('Host-owned draft')
    act(() =>
      guestEvent(webview, {
        type: 'editor_anchor_changed',
        sessionId: sessionOne,
        requestId: '00000000-0000-4000-8000-000000000020',
        anchor: { x: 140, y: 260, width: 80, height: 32 }
      })
    )
    expect(result.current.editor).toMatchObject({
      draft: 'Host-owned draft',
      anchor: { x: 140, y: 260, width: 80, height: 32 }
    })
    act(() =>
      guestEvent(webview, {
        type: 'editor_anchor_changed',
        sessionId: sessionOne,
        requestId: '00000000-0000-4000-8000-000000000099',
        anchor: { x: 0, y: 0, width: 1, height: 1 }
      })
    )
    expect(result.current.editor?.anchor).toEqual({ x: 140, y: 260, width: 80, height: 32 })
    act(() => void result.current.saveEditor())
    expect(sentCommands(webview)).toContainEqual({
      type: 'save_editor',
      sessionId: sessionOne,
      requestId: '00000000-0000-4000-8000-000000000020',
      comment: 'Host-owned draft'
    })
  })

  it('keeps annotation mode disabled when delivering the toggle rejects', async () => {
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webviewRef)))
    act(() => stateChanged(webview, sessionOne, false, 0))
    vi.mocked(webview.send).mockRejectedValueOnce(new Error('guest unavailable'))

    await act(async () => {
      await result.current.toggle()
    })

    expect(result.current.enabled).toBe(false)
  })

  it('keeps the count and editor when delivering clear rejects', async () => {
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webviewRef)))
    act(() => {
      stateChanged(webview, sessionOne, true, 2)
      guestEvent(webview, {
        type: 'editor_requested',
        sessionId: sessionOne,
        requestId: '00000000-0000-4000-8000-000000000020',
        comment: 'Retry this draft',
        canDelete: true,
        anchor: { x: 120, y: 240, width: 80, height: 32 }
      })
    })
    vi.mocked(webview.send).mockRejectedValueOnce(new Error('guest unavailable'))

    await act(async () => {
      await result.current.clear()
    })

    expect(result.current.count).toBe(2)
    expect(result.current.editor?.draft).toBe('Retry this draft')
  })

  it('reports a delivered clear after navigation without clearing the replacement session', async () => {
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webviewRef)))
    act(() => stateChanged(webview, sessionOne, true, 2))
    let resolveClear!: () => void
    vi.mocked(webview.send).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveClear = resolve
        })
    )

    let clearResult!: Promise<boolean>
    act(() => {
      clearResult = result.current.clear()
    })
    act(() => webview.emitNative('did-start-navigation', { isMainFrame: true, isInPlace: false }))
    act(() => {
      stateChanged(webview, sessionTwo, true, 3)
      guestEvent(webview, {
        type: 'editor_requested',
        sessionId: sessionTwo,
        requestId: '00000000-0000-4000-8000-000000000021',
        comment: 'Replacement session draft',
        canDelete: true,
        anchor: { x: 120, y: 240, width: 80, height: 32 }
      })
    })

    await act(async () => {
      resolveClear()
      await expect(clearResult).resolves.toBe(true)
    })

    expect(result.current).toMatchObject({ ready: true, enabled: true, count: 3 })
    expect(result.current.editor?.draft).toBe('Replacement session draft')
  })

  it('keeps the editor open when delivering cancel rejects', async () => {
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webviewRef)))
    act(() => {
      stateChanged(webview, sessionOne, true, 1)
      guestEvent(webview, {
        type: 'editor_requested',
        sessionId: sessionOne,
        requestId: '00000000-0000-4000-8000-000000000020',
        comment: 'Retry this draft',
        canDelete: true,
        anchor: { x: 120, y: 240, width: 80, height: 32 }
      })
    })
    vi.mocked(webview.send).mockRejectedValueOnce(new Error('guest unavailable'))

    await act(async () => {
      await result.current.cancelEditor()
    })

    expect(result.current.editor?.draft).toBe('Retry this draft')
  })

  it('commits guest state ahead of unrelated suspended Activity work', () => {
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    const suspend = new Promise<never>(() => {})
    const view = render(
      <Suspense fallback={<span>Pending</span>}>
        <Activity mode="visible">
          <SuspendedSibling suspend={suspend} />
          <SessionStateHarness webviewRef={webviewRef} />
        </Activity>
      </Suspense>
    )

    expect(view.getByRole('status', { name: 'Annotation state' })).toHaveTextContent('false:false:0')
    act(() => {
      startTransition(() => {
        startSuspendingSibling?.()
        stateChanged(webview, sessionOne, true, 3)
      })
    })

    expect(sentCommands(webview)).toContainEqual(expect.objectContaining({ type: 'configure', sessionId: sessionOne }))
    expect(view.getByRole('status', { name: 'Annotation state' })).toHaveTextContent('true:true:3')
  })

  it('rebinds to a concrete replacement and ignores the detached webview', () => {
    const first = createWebview(41)
    const second = createWebview(42)
    const webviewRef = createWebviewRef(first)
    const { result, rerender } = renderHook((props: HookProps) => useWebviewAnnotationSession(props), {
      initialProps: initialProps(webviewRef)
    })

    expect(result.current.ready).toBe(false)
    expect(sentCommands(first)).toContainEqual({ type: 'request_state' })
    act(() => stateChanged(first, sessionOne, true, 1))
    expect(result.current).toMatchObject({ ready: true, enabled: true, count: 1 })
    expect(sentCommands(first)).toContainEqual(
      expect.objectContaining({ type: 'configure', sessionId: sessionOne, locale, theme: 'dark' })
    )

    webviewRef.current = second
    rerender(initialProps(webviewRef, { webviewRevision: 1 }))
    expect(result.current).toMatchObject({ ready: false, enabled: false, count: 0 })
    act(() => stateChanged(first, sessionOne, true, 5))
    expect(result.current.count).toBe(0)

    act(() => stateChanged(second, sessionTwo, false, 2))
    expect(result.current).toMatchObject({ ready: true, enabled: false, count: 2 })
  })

  it('retires only a new main-frame document and accepts only its next session', () => {
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webviewRef)))
    act(() => stateChanged(webview, sessionOne, true, 1))

    act(() => webview.emitNative('did-start-navigation', { isMainFrame: false, isInPlace: false }))
    expect(result.current).toMatchObject({ ready: true, enabled: true, count: 1 })
    act(() => webview.emitNative('did-start-navigation', { isMainFrame: true, isInPlace: true }))
    expect(result.current).toMatchObject({ ready: true, enabled: true, count: 1 })

    act(() => webview.emitNative('did-start-navigation', { isMainFrame: true, isInPlace: false }))
    expect(result.current).toMatchObject({ ready: false, enabled: false, count: 0 })
    expect(sentCommands(webview)).toEqual(
      expect.arrayContaining([
        { type: 'deactivate', sessionId: sessionOne },
        { type: 'clear', sessionId: sessionOne }
      ])
    )
    act(() => stateChanged(webview, sessionOne, false, 3))
    expect(result.current.ready).toBe(false)
    act(() => stateChanged(webview, sessionTwo, false, 2))
    expect(result.current).toMatchObject({ ready: true, count: 2 })
  })

  it('clears and invalidates copy only when the target identity changes', async () => {
    let resolveExport: ((markdown: string) => void) | undefined
    request.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveExport = resolve
        })
    )
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    const { result, rerender } = renderHook((props: HookProps) => useWebviewAnnotationSession(props), {
      initialProps: initialProps(webviewRef)
    })
    act(() => stateChanged(webview, sessionOne, true, 1))
    vi.mocked(webview.send).mockClear()

    rerender(initialProps(webviewRef, { target: { ...target, label: '演示' }, theme: 'light' }))
    expect(sentCommands(webview)).toContainEqual(
      expect.objectContaining({ type: 'configure', sessionId: sessionOne, theme: 'light' })
    )
    expect(sentCommands(webview)).not.toContainEqual({ type: 'clear', sessionId: sessionOne })

    let copyResult: Promise<void>
    act(() => {
      copyResult = result.current.copy()
    })
    act(() => snapshotReady(webview))
    await waitFor(() => expect(request).toHaveBeenCalledOnce())

    vi.mocked(webview.send).mockClear()
    rerender(initialProps(webviewRef, { target: { id: 'mini-app:other', label: 'Other' }, theme: 'light' }))
    expect(sentCommands(webview)).toContainEqual({ type: 'clear', sessionId: sessionOne })
    expect(result.current).toMatchObject({ enabled: false, count: 0 })

    const copyRejection = expect(copyResult!).rejects.toThrow('stale')
    await act(async () => {
      resolveExport?.('# stale')
      await copyRejection
    })
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('deactivates an inactive host while retaining its committed count', () => {
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    const { result, rerender } = renderHook((props: HookProps) => useWebviewAnnotationSession(props), {
      initialProps: initialProps(webviewRef)
    })
    act(() => stateChanged(webview, sessionOne, true, 2))

    rerender(initialProps(webviewRef, { isHostActive: false }))

    expect(result.current).toMatchObject({ ready: true, enabled: false, count: 2 })
    expect(sentCommands(webview)).toContainEqual({ type: 'deactivate', sessionId: sessionOne })
  })

  it('ignores foreign, malformed, and mismatched snapshot events', async () => {
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webviewRef)))

    act(() => {
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
    expect(result.current).toMatchObject({ ready: false, count: 0 })

    act(() => stateChanged(webview))
    let copyResult: Promise<void>
    act(() => {
      copyResult = result.current.copy()
    })
    act(() => {
      snapshotReady(webview, sessionTwo)
      snapshotReady(webview, sessionOne, '00000000-0000-4000-8000-000000000099')
    })
    expect(request).not.toHaveBeenCalled()

    const copyRejection = expect(copyResult!).rejects.toThrow('stale')
    await act(async () => {
      snapshotReady(webview, sessionOne, undefined, [])
      await copyRejection
    })
    expect(request).not.toHaveBeenCalled()
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('rejects a snapshot request after two seconds', async () => {
    vi.useFakeTimers()
    try {
      const webview = createWebview()
      const webviewRef = createWebviewRef(webview)
      const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webviewRef)))
      act(() => stateChanged(webview))
      let copyResult: Promise<void>
      act(() => {
        copyResult = result.current.copy()
      })

      const copyRejection = expect(copyResult!).rejects.toThrow('Timed out')
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_001)
        await copyRejection
      })
      expect(request).not.toHaveBeenCalled()
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects immediately and clears the timeout when snapshot delivery rejects', async () => {
    vi.useFakeTimers()
    try {
      const webview = createWebview()
      const webviewRef = createWebviewRef(webview)
      const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webviewRef)))
      act(() => stateChanged(webview))
      vi.mocked(webview.send).mockRejectedValueOnce(new Error('guest unavailable'))

      let copyResult: Promise<void>
      act(() => {
        copyResult = result.current.copy()
      })
      const outcome = copyResult!.then(
        () => 'resolved',
        (error: Error) => error.message
      )
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(await Promise.race([outcome, Promise.resolve('pending')])).toBe(
        'Failed to request webview annotation snapshot'
      )
      expect(result.current.copying).toBe(false)
      expect(vi.getTimerCount()).toBe(0)
      expect(request).not.toHaveBeenCalled()
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a correlated malformed snapshot immediately and clears the timeout', async () => {
    vi.useFakeTimers()
    try {
      const webview = createWebview()
      const webviewRef = createWebviewRef(webview)
      const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webviewRef)))
      act(() => stateChanged(webview))

      let copyResult: Promise<void>
      act(() => {
        copyResult = result.current.copy()
      })
      const outcome = copyResult!.then(
        () => 'resolved',
        (error: Error) => error.message
      )
      await act(async () => {
        webview.emitNative('ipc-message', {
          channel: WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
          args: [
            {
              type: 'snapshot_ready',
              sessionId: sessionOne,
              requestId: '00000000-0000-4000-8000-000000000010',
              annotations: [{ ...annotation, region: { rect: { x: 0, y: 0, width: 0, height: 1 }, elements: [] } }]
            }
          ]
        })
        await Promise.resolve()
      })

      const immediateOutcome = await Promise.race([outcome, Promise.resolve('pending')])
      const immediateCopying = result.current.copying
      const pendingTimers = vi.getTimerCount()
      if (immediateOutcome === 'pending') {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(2_001)
          await outcome
        })
      }

      expect(immediateOutcome).toBe('Invalid webview annotation snapshot')
      expect(immediateCopying).toBe(false)
      expect(pendingTimers).toBe(0)
      expect(request).not.toHaveBeenCalled()
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects a pending snapshot on unmount and ignores its late response', async () => {
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    const { result, unmount } = renderHook(() => useWebviewAnnotationSession(initialProps(webviewRef)))
    act(() => stateChanged(webview))
    let copyResult: Promise<void>
    act(() => {
      copyResult = result.current.copy()
    })

    const copyRejection = expect(copyResult!).rejects.toThrow('detached')
    unmount()
    act(() => snapshotReady(webview))

    await copyRejection
    expect(request).not.toHaveBeenCalled()
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('does not write a late main result after navigation invalidates the operation', async () => {
    let resolveExport: ((markdown: string) => void) | undefined
    request.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolveExport = resolve
        })
    )
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webviewRef)))
    act(() => stateChanged(webview))
    let copyResult: Promise<void>
    act(() => {
      copyResult = result.current.copy()
    })
    act(() => snapshotReady(webview))
    await waitFor(() => expect(request).toHaveBeenCalledOnce())

    act(() => webview.emitNative('did-start-navigation', { isMainFrame: true, isInPlace: false }))
    const copyRejection = expect(copyResult!).rejects.toThrow('stale')
    await act(async () => {
      resolveExport?.('# stale')
      await copyRejection
    })
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
  })

  it('allows only one copy operation until its snapshot is resolved', async () => {
    const webview = createWebview()
    const webviewRef = createWebviewRef(webview)
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webviewRef)))
    act(() => stateChanged(webview))
    let firstCopy: Promise<void>
    let secondCopy: Promise<void>
    act(() => {
      firstCopy = result.current.copy()
      secondCopy = result.current.copy()
    })

    expect(sentCommands(webview).filter((command) => command.type === 'request_snapshot')).toHaveLength(1)
    expect(result.current.copying).toBe(true)
    await expect(secondCopy!).resolves.toBeUndefined()

    await act(async () => {
      snapshotReady(webview)
      await expect(firstCopy!).resolves.toBeUndefined()
    })
    expect(request).toHaveBeenCalledOnce()
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('# Resolved annotations')
    expect(result.current.copying).toBe(false)
  })
})
