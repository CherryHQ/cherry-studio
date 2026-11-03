// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import { Activity, useLayoutEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cacheService } from '@renderer/data/CacheService'
import {
  agentBrowserRuntimeService as runtime,
  topicBrowserRuntimeService as topicRuntime
} from '@renderer/services/AgentBrowserRuntimeService'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { BrowserCursorState } from '@shared/types/browserCursor'

import { AgentBrowserRuntimeHost } from '../AgentBrowserRuntimeHost'

const bridge = vi.hoisted(() => ({
  listeners: new Map<string, (input: unknown) => void>(),
  binding: undefined as number | undefined,
  presented: false,
  attachGate: undefined as Promise<void> | undefined,
  attaches: [] as Array<{ webviewId?: number; requestId?: string }>,
  toasts: [] as unknown[],
  tabs: [{ id: 'tab-a', type: 'route', url: '/app/agents?sessionId=session-a', title: 'Agent' }] as Tab[]
}))

vi.mock('@renderer/hooks/tab', () => ({ useTabs: () => ({ tabs: bridge.tabs }) }))
vi.mock('@renderer/services/toast', () => ({
  toast: {
    warning: (...args: unknown[]) => void bridge.toasts.push(args[0])
  }
}))
vi.mock('@renderer/data/hooks/usePreference', async () => {
  const { mockUsePreference } = await import('@test-mocks/renderer/usePreference')
  return { usePreference: mockUsePreference }
})
vi.mock('@renderer/ipc/ipcApi', () => ({
  ipcApi: {
    on: (event: string, handler: (input: { sessionId: string }) => void) => {
      bridge.listeners.set(event, (input) => handler(input as { sessionId: string }))
      return () => bridge.listeners.delete(event)
    },
    request: async (route: string, input: { webviewId?: number; presented?: boolean; requestId?: string }) => {
      if (route === 'browser.cursor.present') bridge.presented = input.presented ?? false
      if (route === 'browser.pane.attach') {
        bridge.attaches.push(input)
        await bridge.attachGate
        bridge.binding = input.webviewId
        return { tabId: 'binding-a' }
      }
      if (route === 'browser.pane.detach') bridge.binding = undefined
      return undefined
    }
  }
}))

let livePresentation = 0
function Presentation() {
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    livePresentation += 1
    runtime.update('session-a', { anchor })
    return () => {
      livePresentation -= 1
      runtime.update('session-a', { anchor: null })
    }
  }, [anchor])
  return <div ref={setAnchor} />
}

function Harness({ visible }: { visible: boolean }) {
  return (
    <>
      <Activity mode={visible ? 'visible' : 'hidden'}>
        <Presentation />
      </Activity>
      <AgentBrowserRuntimeHost />
    </>
  )
}

function selectContents(element: HTMLElement): Selection {
  const selection = window.getSelection()
  if (!selection) throw new Error('Selection API is unavailable')
  const range = document.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

function emitCursorState(state: BrowserCursorState): void {
  act(() => bridge.listeners.get('browser.cursor.state')?.(state))
}

describe('AgentBrowserRuntimeHost', () => {
  beforeEach(() => {
    runtime.dispose()
    topicRuntime.dispose()
    bridge.tabs = [{ id: 'tab-a', type: 'route', url: '/app/agents?sessionId=session-a', title: 'Agent' }]
    bridge.binding = undefined
    bridge.presented = false
    bridge.attachGate = undefined
    bridge.attaches = []
    bridge.toasts = []
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    MockUsePreferenceUtils.setPreferenceValue('app.spell_check.enabled', true)
    const ids = new WeakMap<HTMLElement, number>()
    let nextId = 42
    Object.assign(HTMLElement.prototype, {
      getWebContentsId(this: HTMLElement) {
        if (!ids.has(this)) ids.set(this, nextId++)
        return ids.get(this)
      },
      isLoading: () => false,
      getTitle: () => 'Background page',
      getURL: () => 'https://example.com/'
    })
    runtime.declare('session-a', 'tab-a')
  })
  afterEach(() => {
    cleanup()
    window.getSelection()?.removeAllRanges()
    for (const key of ['getWebContentsId', 'isLoading', 'getTitle', 'getURL'])
      Reflect.deleteProperty(HTMLElement.prototype, key)
    runtime.dispose()
    topicRuntime.dispose()
    vi.unstubAllGlobals()
  })

  it.each([
    { type: 'route', url: '/app/chat' },
    { type: 'route', url: '/app/chat?topicId=topic-b' },
    { type: 'route', url: '/app/settings?topicId=topic-a' },
    { type: 'webview', url: '/app/chat?topicId=topic-a' }
  ] as const)('releases a topic guest when its tab retargets to $type $url', async (destination) => {
    bridge.tabs = [{ id: 'tab-a', type: 'route', url: '/app/chat?topicId=topic-a', title: 'Chat' }]
    const view = render(<AgentBrowserRuntimeHost />)
    act(() => bridge.listeners.get('browser.guest.ensure_requested')?.({ sessionId: 'topic-a', scope: 'topic' }))
    await waitFor(() => expect(bridge.binding).toBe(42))
    const guest = view.getByTestId('webview-browser-guest')

    bridge.tabs = [{ ...bridge.tabs[0], ...destination }]
    view.rerender(<AgentBrowserRuntimeHost />)

    await waitFor(() => expect(bridge.binding).toBeUndefined())
    expect(guest.isConnected).toBe(false)
    expect(topicRuntime.get('topic-a')).toBeUndefined()
    act(() => bridge.listeners.get('browser.guest.ensure_requested')?.({ sessionId: 'topic-a', scope: 'topic' }))
    expect(topicRuntime.get('topic-a')).toBeUndefined()
  })

  it('retains a topic guest until its last owning tab leaves, including an atomic owner transfer', async () => {
    const tab: Tab = { id: 'tab-a', type: 'route', url: '/app/chat?topicId=topic-a', title: 'Chat' }
    bridge.tabs = [tab]
    const view = render(<AgentBrowserRuntimeHost />)
    act(() => topicRuntime.ensure('topic-a'))
    await waitFor(() => expect(bridge.binding).toBe(42))
    const guest = view.getByTestId('webview-browser-guest')

    bridge.tabs = [{ ...tab, id: 'tab-b' }]
    view.rerender(<AgentBrowserRuntimeHost />)
    expect(view.getByTestId('webview-browser-guest')).toBe(guest)
    bridge.tabs = [tab, { ...tab, id: 'tab-b' }]
    view.rerender(<AgentBrowserRuntimeHost />)
    bridge.tabs = [
      { ...tab, url: '/app/chat?topicId=topic-b' },
      { ...tab, id: 'tab-b' }
    ]
    view.rerender(<AgentBrowserRuntimeHost />)
    expect(view.getByTestId('webview-browser-guest')).toBe(guest)
    expect(bridge.binding).toBe(42)

    bridge.tabs = [bridge.tabs[0]]
    view.rerender(<AgentBrowserRuntimeHost />)
    await waitFor(() => expect(bridge.binding).toBeUndefined())
    expect(guest.isConnected).toBe(false)
  })

  it('keeps a topic guest while its page is hidden by Activity and releases it when the tab closes', async () => {
    bridge.tabs = [{ id: 'tab-a', type: 'route', url: '/app/chat?topicId=topic-a', title: 'Chat' }]
    const view = render(<Harness visible />)
    act(() => topicRuntime.ensure('topic-a'))
    await waitFor(() => expect(bridge.binding).toBe(42))
    const guest = view.getByTestId('webview-browser-guest')

    view.rerender(<Harness visible={false} />)
    expect(livePresentation).toBe(0)
    expect(view.getByTestId('webview-browser-guest')).toBe(guest)
    expect(bridge.binding).toBe(42)
    view.rerender(<Harness visible />)
    expect(view.getByTestId('webview-browser-guest')).toBe(guest)

    bridge.tabs = []
    view.rerender(<Harness visible />)
    await waitFor(() => expect(bridge.binding).toBeUndefined())
    expect(guest.isConnected).toBe(false)
  })

  it('keeps the execution binding while Activity stops the view and releases it when the owner closes', async () => {
    runtime.ensure('session-a', 'https://example.com/')
    const view = render(<Harness visible />)
    await waitFor(() => expect(bridge.binding).toBe(42))
    await waitFor(() => expect(bridge.presented).toBe(true))
    const guest = view.getByTestId('webview-browser-guest')
    view.rerender(<Harness visible={false} />)
    await act(async () => {})
    expect(livePresentation).toBe(0)
    expect(bridge.binding).toBe(42)
    expect(bridge.presented).toBe(false)
    expect(view.getByTestId('webview-browser-guest')).toBe(guest)

    view.rerender(<Harness visible />)
    await waitFor(() => expect(bridge.presented).toBe(true))
    expect(view.getByTestId('webview-browser-guest')).toBe(guest)
    bridge.tabs = []
    view.rerender(<Harness visible />)
    await waitFor(() => expect(bridge.binding).toBeUndefined())
    expect(guest.isConnected).toBe(false)
    expect(runtime.get('session-a')).toBeUndefined()
  })

  it('mounts the guest above the pane and host overlays above the guest at the document root', async () => {
    runtime.ensure('session-a', 'https://example.com/')
    const view = render(<Harness visible />)
    await waitFor(() => expect(bridge.binding).toBe(42))

    const guest = view.getByTestId('webview-browser-guest')
    const cursor = await view.findByTestId('browser-cursor-overlay')
    const guestPlane = guest.parentElement
    const overlayPlane = cursor.parentElement

    // Electron compositing requires body siblings ordered above the z-40 pane host.
    expect(guestPlane).not.toBeNull()
    expect(overlayPlane).not.toBeNull()
    expect(guestPlane?.parentElement).toBe(document.body)
    expect(overlayPlane?.parentElement).toBe(document.body)
    expect(guestPlane?.nextElementSibling).toBe(overlayPlane)
    expect(guestPlane).toHaveClass('z-[45]')
    expect(overlayPlane).toHaveClass('z-50')
    expect(guestPlane).not.toContainElement(cursor)
    expect(overlayPlane).toContainElement(runtime.get('session-a')?.overlays ?? null)
  })

  it('clears only chat selections after an agent browser press', async () => {
    const outside = document.createElement('div')
    outside.textContent = 'Outside selection'
    const messages = document.createElement('div')
    messages.id = 'messages'
    messages.textContent = 'Chat selection'
    document.body.append(outside, messages)

    runtime.ensure('session-a', 'https://example.com/')
    const view = render(<Harness visible />)
    await waitFor(() => expect(bridge.presented).toBe(true))
    vi.spyOn(view.getByTestId('webview-browser-guest'), 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600
    } as DOMRect)

    const pressed = (sequence: number): BrowserCursorState => ({
      sessionId: 'session-a',
      tabId: 'binding-a',
      kind: 'pressed',
      sequence,
      documentId: 'document',
      x: 80,
      y: 40,
      scale: 1,
      animate: false
    })

    const outsideSelection = selectContents(outside)
    emitCursorState(pressed(1))
    expect(outsideSelection.toString()).toBe('Outside selection')

    const chatSelection = selectContents(messages)
    emitCursorState(pressed(2))
    expect(chatSelection.rangeCount).toBe(0)
  })

  it.each(['switch', 'close'] as const)('keeps a running guest after tab %s until its turn ends', async (action) => {
    const key = 'topic.stream.statuses.agent-session:session-a' as const
    const status = { activeExecutions: [], awaitingApprovalAnchors: [] }
    cacheService.setShared(key, { ...status, status: 'streaming' })
    runtime.ensure('session-a', 'https://example.com/')
    const view = render(<Harness visible />)
    await waitFor(() => expect(bridge.binding).toBe(42))
    const guest = view.getByTestId('webview-browser-guest')

    if (action === 'switch') act(() => runtime.declare('session-b', 'tab-a'))
    else bridge.tabs = []
    view.rerender(<Harness visible={false} />)
    act(() => runtime.reconcileOwners(new Set(bridge.tabs.map((tab) => tab.id))))
    act(() => cacheService.setShared(key, { ...status, status: 'awaiting-approval' }))
    act(() => bridge.listeners.get('browser.guest.ensure_requested')?.({ sessionId: 'session-a' }))

    expect(view.getByTestId('webview-browser-guest')).toBe(guest)
    expect(bridge.binding).toBe(42)
    expect(runtime.get('session-a')?.anchor).toBeNull()
    act(() => cacheService.setShared(key, { ...status, status: 'done' }))
    await waitFor(() => expect(bridge.binding).toBeUndefined())
    expect(guest.isConnected).toBe(false)
    expect(runtime.get('session-a')).toBeUndefined()
    act(() => runtime.ensure('session-a'))
    expect(runtime.get('session-a')).toBeUndefined()
  })

  it('can create a guest after switching away during a pending turn and retain it when switching back', async () => {
    const key = 'topic.stream.statuses.agent-session:session-a' as const
    const status = { activeExecutions: [], awaitingApprovalAnchors: [] }
    cacheService.setShared(key, { ...status, status: 'pending' })
    const view = render(<Harness visible={false} />)
    act(() => runtime.declare('session-b', 'tab-a'))
    act(() => bridge.listeners.get('browser.guest.ensure_requested')?.({ sessionId: 'session-a' }))
    await waitFor(() => expect(bridge.binding).toBe(42))
    const guest = view.getByTestId('webview-browser-guest')

    act(() => runtime.declare('session-a', 'tab-a'))
    view.rerender(<Harness visible />)
    act(() => cacheService.setShared(key, { ...status, status: 'done' }))
    expect(view.getByTestId('webview-browser-guest')).toBe(guest)
    expect(bridge.binding).toBe(42)
    act(() => runtime.close('session-a'))
    await waitFor(() => expect(bridge.binding).toBeUndefined())
  })

  it('releases the previous session guest when its only owning tab changes sessions', async () => {
    runtime.ensure('session-a', 'https://example.com/')
    const view = render(<Harness visible />)
    await waitFor(() => expect(bridge.binding).toBe(42))
    const guest = view.getByTestId('webview-browser-guest')

    act(() => runtime.declare('session-b', 'tab-a'))
    await waitFor(() => expect(bridge.binding).toBeUndefined())
    expect(guest.isConnected).toBe(false)
    expect(runtime.get('session-a')).toBeUndefined()
    runtime.ensure('session-a')
    expect(runtime.get('session-a')).toBeUndefined()
    act(() => runtime.ensure('session-b', 'https://other.test/'))
    expect(runtime.get('session-b')?.sourceUrl).toBe('https://other.test/')
    await act(async () => {})
  })

  it('retains the previous session while another tab still owns it', () => {
    runtime.declare('session-a', 'tab-b')
    runtime.ensure('session-a', 'https://example.com/')
    const resource = runtime.get('session-a')
    runtime.declare('session-b', 'tab-a')
    expect(runtime.get('session-a')).toBe(resource)
    runtime.reconcileOwners(new Set(['tab-a']))
    expect(runtime.get('session-a')).toBeUndefined()
    runtime.ensure('session-b', 'https://other.test/')
    expect(runtime.get('session-b')?.sourceUrl).toBe('https://other.test/')
  })

  it('creates an execution target on request without mounting the hidden panel', async () => {
    render(<Harness visible={false} />)
    act(() => bridge.listeners.get('browser.guest.ensure_requested')?.({ sessionId: 'session-a' }))
    await waitFor(() => expect(bridge.binding).toBe(42))
    expect(livePresentation).toBe(0)
    expect(runtime.get('session-a')?.ready).toBe(true)
    expect(runtime.get('session-a')?.anchor).toBeNull()
  })

  it.each(['reattach', 'recreate'] as const)(
    'repairs the guest with %s while retaining its presentation',
    async (kind) => {
      runtime.ensure('session-a', 'https://example.com/')
      const view = render(<Harness visible />)
      await waitFor(() => expect(bridge.binding).toBe(42))
      const original = view.getByTestId('webview-browser-guest')
      const anchor = runtime.get('session-a')?.anchor
      const overlays = runtime.get('session-a')?.overlays
      const requestId = '11111111-1111-4111-8111-111111111111'
      act(() =>
        bridge.listeners.get('browser.guest.ensure_requested')?.({
          sessionId: 'session-a',
          repair: { requestId, kind, expiresAt: Date.now() + 10000 }
        })
      )
      await waitFor(() => expect(bridge.attaches.some((input) => input.requestId === requestId)).toBe(true))
      const repaired = view.getByTestId('webview-browser-guest')
      if (kind === 'reattach') {
        expect(repaired).toBe(original)
        expect(bridge.binding).toBe(42)
      } else {
        expect(repaired).not.toBe(original)
        expect(original.isConnected).toBe(false)
        expect(bridge.binding).not.toBe(42)
      }
      expect(runtime.get('session-a')?.anchor).toBe(anchor)
      expect(runtime.get('session-a')?.overlays).toBe(overlays)
    }
  )

  it('reattaches the existing guest without replacing it or notifying the user', async () => {
    runtime.ensure('session-a', 'https://example.com/')
    const view = render(<Harness visible />)
    await waitFor(() => expect(bridge.binding).toBe(42))
    const original = view.getByTestId('webview-browser-guest')
    const requestId = '44444444-4444-4444-8444-444444444444'
    act(() =>
      bridge.listeners.get('browser.guest.ensure_requested')?.({
        sessionId: 'session-a',
        repair: { requestId, kind: 'reattach', expiresAt: Date.now() + 10000 }
      })
    )
    await waitFor(() => expect(bridge.attaches.some((input) => input.requestId === requestId)).toBe(true))
    expect(view.getByTestId('webview-browser-guest')).toBe(original)
    expect(original.isConnected).toBe(true)
    await act(async () => {})
    expect(bridge.toasts).toHaveLength(0)
  })

  it('rebuilds a recreated guest once and reports it exactly once across redelivered repairs', async () => {
    runtime.ensure('session-a', 'https://example.com/')
    const view = render(<Harness visible />)
    await waitFor(() => expect(bridge.binding).toBe(42))
    const original = view.getByTestId('webview-browser-guest')
    const repair = {
      requestId: '55555555-5555-4555-8555-555555555555',
      kind: 'recreate' as const,
      expiresAt: Date.now() + 10000
    }
    act(() => bridge.listeners.get('browser.guest.ensure_requested')?.({ sessionId: 'session-a', repair }))
    await waitFor(() => expect(bridge.attaches.some((input) => input.requestId === repair.requestId)).toBe(true))
    const recreated = view.getByTestId('webview-browser-guest')
    expect(recreated).not.toBe(original)
    expect(original.isConnected).toBe(false)
    await waitFor(() => expect(bridge.toasts).toHaveLength(1))

    act(() => bridge.listeners.get('browser.guest.ensure_requested')?.({ sessionId: 'session-a', repair }))
    view.rerender(<Harness visible />)
    view.rerender(<Harness visible />)
    await act(async () => {})

    expect(bridge.toasts).toHaveLength(1)
    expect(view.getByTestId('webview-browser-guest')).toBe(recreated)
  })

  it.each(['reattach', 'recreate'] as const)(
    'creates a missing resource for %s and retires its token only after attach succeeds',
    async (kind) => {
      let confirm!: () => void
      bridge.attachGate = new Promise<void>((resolve) => {
        confirm = resolve
      })
      render(<Harness visible={false} />)
      const repair = { requestId: 'missing-resource', kind, expiresAt: Date.now() + 10000 }
      act(() => bridge.listeners.get('browser.guest.ensure_requested')?.({ sessionId: 'session-a', repair }))
      expect(runtime.get('session-a')).toMatchObject({
        sourceUrl: 'about:blank',
        securityProfile: 'agent-browser',
        repair,
        guestGeneration: kind === 'recreate' ? 1 : 0,
        bindingRevision: 1
      })
      await waitFor(() =>
        expect(bridge.attaches).toEqual([{ sessionId: 'session-a', webviewId: 42, requestId: repair.requestId }])
      )
      expect(bridge.binding).toBeUndefined()
      expect(runtime.get('session-a')?.repair).toBe(repair)
      expect(bridge.toasts).toHaveLength(0)
      await act(async () => {
        confirm()
      })
      await waitFor(() => expect(runtime.get('session-a')?.repair).toBeUndefined())
      expect(bridge.binding).toBe(42)
      expect(livePresentation).toBe(0)
      expect(bridge.attaches).toHaveLength(1)
      expect(bridge.toasts).toHaveLength(kind === 'recreate' ? 1 : 0)
    }
  )

  it.each(['before expiry', 'after expiry'] as const)(
    'binds an HTML replacement without replaying a completed repair token %s',
    async (timing) => {
      runtime.ensure('session-a')
      const view = render(<Harness visible />)
      await waitFor(() => expect(bridge.binding).toBe(42))
      const repair = { requestId: 'completed-repair', kind: 'recreate' as const, expiresAt: Date.now() + 10000 }
      act(() => bridge.listeners.get('browser.guest.ensure_requested')?.({ sessionId: 'session-a', repair }))
      await waitFor(() => expect(bridge.toasts).toHaveLength(1))
      const repaired = view.getByTestId('webview-browser-guest')
      const clock = vi.spyOn(Date, 'now')
      try {
        if (timing === 'after expiry') clock.mockReturnValue(repair.expiresAt + 1)
        act(() => runtime.ensure('session-a', 'file:///workspace/after-repair.html'))
        const html = view.getByTestId('webview-browser-guest')
        expect(html).not.toBe(repaired)
        expect(html).toHaveAttribute('partition', 'agent-html-artifact')
        await waitFor(() => expect(bridge.binding).toBe((html as unknown as WebviewTag).getWebContentsId()))
        expect(bridge.attaches.at(-1)).not.toHaveProperty('requestId')
        expect(runtime.get('session-a')?.repair).toBeUndefined()
        expect(bridge.toasts).toHaveLength(1)
      } finally {
        clock.mockRestore()
      }
    }
  )

  it('retires a pending repair when an ordinary ensure replaces the source and profile', async () => {
    runtime.ensure('session-a')
    const view = render(<Harness visible />)
    await waitFor(() => expect(bridge.binding).toBe(42))
    act(() => {
      runtime.ensure('session-a', undefined, undefined, {
        requestId: 'superseded-repair',
        kind: 'recreate',
        expiresAt: Date.now() + 10000
      })
      runtime.ensure('session-a', 'file:///workspace/replacement.html')
    })
    expect(runtime.get('session-a')?.repair).toBeUndefined()
    const html = view.getByTestId('webview-browser-guest')
    await waitFor(() => expect(bridge.binding).toBe((html as unknown as WebviewTag).getWebContentsId()))
    expect(bridge.attaches.at(-1)).not.toHaveProperty('requestId')
    expect(bridge.toasts).toHaveLength(0)
  })

  it('ignores an expired repair request and keeps the live guest untouched', async () => {
    runtime.ensure('session-a', 'https://example.com/')
    const view = render(<Harness visible />)
    await waitFor(() => expect(bridge.binding).toBe(42))
    const original = view.getByTestId('webview-browser-guest')
    const requestId = '66666666-6666-4666-8666-666666666666'
    act(() =>
      bridge.listeners.get('browser.guest.ensure_requested')?.({
        sessionId: 'session-a',
        repair: { requestId, kind: 'recreate', expiresAt: Date.now() }
      })
    )
    await act(async () => {})
    expect(view.getByTestId('webview-browser-guest')).toBe(original)
    expect(original.isConnected).toBe(true)
    expect(runtime.get('session-a')?.guestGeneration).toBe(0)
    expect(runtime.get('session-a')?.repair).toBeUndefined()
    expect(bridge.attaches.some((input) => input.requestId === requestId)).toBe(false)
    expect(bridge.toasts).toHaveLength(0)
  })

  it('preserves ordinary navigation and replaces the guest before changing file or preview authorization', async () => {
    runtime.ensure('session-a', 'https://example.com/')
    const view = render(<Harness visible />)
    await waitFor(() => expect(bridge.binding).toBe(42))
    const ordinary = view.getByTestId('webview-browser-guest')
    act(() => runtime.ensure('session-a', 'http://192.168.1.2/'))
    expect(view.getByTestId('webview-browser-guest')).toBe(ordinary)
    act(() => runtime.ensure('session-a', 'file:///workspace/first.html'))
    const file = view.getByTestId('webview-browser-guest')
    expect(file).not.toBe(ordinary)
    expect(file).toHaveAttribute('partition', 'agent-html-artifact')
    act(() => runtime.ensure('session-a', 'file:///workspace/second.html'))
    expect(view.getByTestId('webview-browser-guest')).not.toBe(file)
    act(() => runtime.ensure('session-a', 'http://localhost:5173/', 'agent-dev-preview'))
    const preview = view.getByTestId('webview-browser-guest')
    act(() => runtime.ensure('session-a', 'http://localhost:5173/next', 'agent-dev-preview'))
    expect(view.getByTestId('webview-browser-guest')).toBe(preview)
    act(() => runtime.ensure('session-a', 'http://localhost:5174/', 'agent-dev-preview'))
    expect(view.getByTestId('webview-browser-guest')).not.toBe(preview)
    await act(async () => {})
  })
})
