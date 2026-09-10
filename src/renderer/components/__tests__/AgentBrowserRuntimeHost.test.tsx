// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { agentBrowserRuntimeService as runtime } from '@renderer/services/AgentBrowserRuntimeService'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { Activity, useLayoutEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentBrowserRuntimeHost } from '../AgentBrowserRuntimeHost'

const bridge = vi.hoisted(() => ({
  listeners: new Map<string, (input: { sessionId: string }) => void>(),
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
      bridge.listeners.set(event, handler)
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
