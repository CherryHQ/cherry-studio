// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { Activity, useLayoutEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { agentBrowserRuntimeService as runtime } from '@renderer/services/AgentBrowserRuntimeService'
import type { BrowserCursorState } from '@shared/types/browserCursor'

import { AgentBrowserRuntimeHost } from '../AgentBrowserRuntimeHost'

const bridge = vi.hoisted(() => ({
  listeners: new Map<string, (input: unknown) => void>(),
  binding: undefined as number | undefined,
  presented: false,
  tabs: [{ id: 'tab-a' }]
}))

vi.mock('@renderer/hooks/tab', () => ({ useTabs: () => ({ tabs: bridge.tabs }) }))
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
    request: async (route: string, input: { webviewId?: number; presented?: boolean }) => {
      if (route === 'browser.cursor.present') bridge.presented = input.presented ?? false
      if (route === 'browser.pane.attach') {
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
    bridge.tabs = [{ id: 'tab-a' }]
    bridge.binding = undefined
    bridge.presented = false
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    MockUsePreferenceUtils.setPreferenceValue('app.spell_check.enabled', true)
    Object.assign(HTMLElement.prototype, {
      getWebContentsId: () => 42,
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
    vi.unstubAllGlobals()
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
