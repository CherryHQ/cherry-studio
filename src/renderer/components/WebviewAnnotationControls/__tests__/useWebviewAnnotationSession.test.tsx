import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  type WebviewAnnotationGuestEvent,
  type WebviewAnnotationHostCommand,
  type WebviewAnnotationLocale,
  type WebviewAnnotationTarget
} from '@shared/types/webviewAnnotation'
import { act, render, renderHook, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
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
  placeholder: 'Add a comment',
  save: 'Save',
  cancel: 'Cancel',
  delete: 'Delete',
  edit: 'Edit',
  elementUnavailable: 'Element unavailable'
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
  webview: WebviewTag | null
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

const initialProps = (webview: WebviewTag | null, overrides: Partial<HookProps> = {}): HookProps => ({
  webview,
  isHostActive: true,
  target,
  locale,
  theme: 'dark',
  ...overrides
})

function SessionHarness({ webview, onCommit }: { webview: WebviewTag; onCommit: () => void }) {
  useWebviewAnnotationSession(initialProps(webview))
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

function SessionStateHarness({ webview }: { webview: WebviewTag }) {
  const session = useWebviewAnnotationSession(initialProps(webview))
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
    let boundDuringCommit = false

    render(
      <Activity mode="visible">
        <SessionHarness
          webview={webview}
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
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webview)))

    act(() => stateChanged(webview, sessionOne, true, 3))

    expect(result.current).toMatchObject({ ready: true, enabled: true, count: 3 })
  })

  it('commits guest state ahead of unrelated suspended Activity work', () => {
    const webview = createWebview()
    const suspend = new Promise<never>(() => {})
    const view = render(
      <Suspense fallback={<span>Pending</span>}>
        <Activity mode="visible">
          <SuspendedSibling suspend={suspend} />
          <SessionStateHarness webview={webview} />
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
    const { result, rerender } = renderHook((props: HookProps) => useWebviewAnnotationSession(props), {
      initialProps: initialProps(first)
    })

    expect(result.current.ready).toBe(false)
    expect(sentCommands(first)).toContainEqual({ type: 'request_state' })
    act(() => stateChanged(first, sessionOne, true, 1))
    expect(result.current).toMatchObject({ ready: true, enabled: true, count: 1 })
    expect(sentCommands(first)).toContainEqual(
      expect.objectContaining({ type: 'configure', sessionId: sessionOne, locale, theme: 'dark' })
    )

    rerender(initialProps(second))
    expect(result.current).toMatchObject({ ready: false, enabled: false, count: 0 })
    act(() => stateChanged(first, sessionOne, true, 5))
    expect(result.current.count).toBe(0)

    act(() => stateChanged(second, sessionTwo, false, 2))
    expect(result.current).toMatchObject({ ready: true, enabled: false, count: 2 })
  })

  it('retires only a new main-frame document and accepts only its next session', () => {
    const webview = createWebview()
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webview)))
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
    const { result, rerender } = renderHook((props: HookProps) => useWebviewAnnotationSession(props), {
      initialProps: initialProps(webview)
    })
    act(() => stateChanged(webview, sessionOne, true, 1))
    vi.mocked(webview.send).mockClear()

    rerender(initialProps(webview, { target: { ...target, label: '演示' }, theme: 'light' }))
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
    rerender(initialProps(webview, { target: { id: 'mini-app:other', label: 'Other' }, theme: 'light' }))
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
    const { result, rerender } = renderHook((props: HookProps) => useWebviewAnnotationSession(props), {
      initialProps: initialProps(webview)
    })
    act(() => stateChanged(webview, sessionOne, true, 2))

    rerender(initialProps(webview, { isHostActive: false }))

    expect(result.current).toMatchObject({ ready: true, enabled: false, count: 2 })
    expect(sentCommands(webview)).toContainEqual({ type: 'deactivate', sessionId: sessionOne })
  })

  it('ignores foreign, malformed, and mismatched snapshot events', async () => {
    const webview = createWebview()
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webview)))

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
      const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webview)))
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

  it('rejects a pending snapshot on unmount and ignores its late response', async () => {
    const webview = createWebview()
    const { result, unmount } = renderHook(() => useWebviewAnnotationSession(initialProps(webview)))
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
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webview)))
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
    const { result } = renderHook(() => useWebviewAnnotationSession(initialProps(webview)))
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
