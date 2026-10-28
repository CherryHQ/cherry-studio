// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { Activity } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AgentBrowserRuntimeHost } from '@renderer/components/AgentBrowserRuntimeHost'
import { agentBrowserRuntimeService as browserRuntime } from '@renderer/services/AgentBrowserRuntimeService'

import { AgentBrowserView } from '../AgentBrowserView'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/data/hooks/usePreference', async () => {
  const { MockUsePreference } = await import('@test-mocks/renderer/usePreference')
  return MockUsePreference
})
const bridge = vi.hoisted(() => ({ binding: undefined as number | undefined, tabs: [{ id: 'tab-a' }] }))
vi.mock('@renderer/hooks/tab', () => ({ useTabs: () => ({ tabs: bridge.tabs }) }))
vi.mock('@renderer/ipc/ipcApi', () => ({
  ipcApi: {
    on: () => () => {},
    request: async (route: string, input: { webviewId?: number }) => {
      if (route === 'browser.pane.attach') {
        bridge.binding = input.webviewId
        return { tabId: 'binding-a' }
      }
      if (route === 'browser.pane.detach') bridge.binding = undefined
      return undefined
    }
  }
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

describe('AgentBrowserView', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    )
    bridge.tabs = [{ id: 'tab-a' }]
    bridge.binding = undefined
  })
  afterEach(() => {
    cleanup()
    browserRuntime.dispose()
    vi.unstubAllGlobals()
  })

  it.each([
    ['https://example.com/', 'agent-browser'],
    ['file:///workspace/index.html', 'agent-html-artifact'],
    ['http://localhost:5173/', 'agent-dev-preview']
  ] as const)('retains %s when a pane mounts without a navigation request', (url, profile) => {
    browserRuntime.declare('session-a', 'tab-a')
    browserRuntime.ensure('session-a', url, profile)
    const browser = (
      <AgentBrowserView
        onNavigate={vi.fn()}
        sessionId="session-a"
        securityProfile="agent-browser"
        isHostActive
        target={{ id: 'agent-browser:session-a', label: 'Browser' }}
      />
    )
    const view = render(browser)
    expect(browserRuntime.get('session-a')).toMatchObject({ sourceUrl: url, securityProfile: profile })
    view.unmount()
    render(browser)
    expect(browserRuntime.get('session-a')).toMatchObject({ sourceUrl: url, securityProfile: profile })
  })

  it('creates an empty browser without a URL and still honors explicit navigation requests', () => {
    browserRuntime.declare('session-a', 'tab-a')
    const props = {
      onNavigate: vi.fn(),
      sessionId: 'session-a',
      securityProfile: 'agent-browser' as const,
      isHostActive: true,
      target: { id: 'agent-browser:session-a', label: 'Browser' }
    }
    const view = render(<AgentBrowserView {...props} />)
    expect(browserRuntime.get('session-a')?.sourceUrl).toBe('about:blank')
    view.rerender(<AgentBrowserView {...props} initialUrl="file:///workspace/index.html" />)
    expect(browserRuntime.get('session-a')).toMatchObject({
      sourceUrl: 'file:///workspace/index.html',
      securityProfile: 'agent-html-artifact'
    })
    view.rerender(<AgentBrowserView {...props} initialUrl="about:blank" />)
    expect(browserRuntime.get('session-a')).toMatchObject({
      sourceUrl: 'about:blank',
      securityProfile: 'agent-browser'
    })
  })

  it('keeps the bound guest and its page when the real Agent view hides, and releases it with its owner', async () => {
    let nativeTitle = 'Example page'
    const guestMethods = {
      getWebContentsId: () => 42,
      getTitle: () => nativeTitle,
      getURL: () => 'https://example.com/',
      isLoading: () => false,
      canGoBack: () => false,
      canGoForward: () => false,
      stopFindInPage: () => {}
    }
    Object.assign(HTMLElement.prototype, guestMethods)
    browserRuntime.declare('session-a', 'tab-a')
    const browser = (
      <AgentBrowserView
        sessionId="session-a"
        initialUrl="https://example.com/"
        securityProfile="agent-browser"
        onNavigate={(url) => browserRuntime.ensure('session-a', url)}
        target={{ id: 'agent-browser:session-a', label: 'Browser' }}
        isHostActive
      />
    )
    const harness = (visible: boolean) => (
      <>
        <Activity mode={visible ? 'visible' : 'hidden'}>{browser}</Activity>
        <AgentBrowserRuntimeHost />
      </>
    )
    try {
      const view = render(harness(true))
      await waitFor(() => expect(bridge.binding).toBe(42))
      const guest = screen.getByTestId('webview-browser-guest')
      expect(screen.getByRole('combobox', { name: 'webview.navigation.address' })).toHaveValue(
        'example.com / Example page'
      )
      expect(browserRuntime.get('session-a')?.anchor?.isConnected).toBe(true)

      view.rerender(harness(false))
      expect(browserRuntime.get('session-a')?.anchor).toBeNull()
      expect(bridge.binding).toBe(42)
      expect(screen.getByTestId('webview-browser-guest')).toBe(guest)

      nativeTitle = 'Updated in background'
      await act(() => guest.dispatchEvent(Object.assign(new Event('page-title-updated'), { title: nativeTitle })))
      view.rerender(harness(true))
      expect(screen.getByTestId('webview-browser-guest')).toBe(guest)
      expect(screen.getByRole('combobox', { name: 'webview.navigation.address' })).toHaveValue(
        'example.com / Updated in background'
      )
      expect(browserRuntime.get('session-a')?.anchor?.isConnected).toBe(true)

      await act(() =>
        guest.dispatchEvent(Object.assign(new Event('did-fail-load'), { isMainFrame: true, errorCode: -102 }))
      )
      const alert = screen.getByRole('alert')
      expect(alert).toHaveTextContent('webview.browser.load_failed')
      expect(browserRuntime.get('session-a')?.overlays).toContainElement(alert)

      bridge.tabs = []
      view.rerender(harness(true))
      await waitFor(() => expect(bridge.binding).toBeUndefined())
      expect(guest.isConnected).toBe(false)
      view.unmount()
    } finally {
      cleanup()
      for (const key of Object.keys(guestMethods)) Reflect.deleteProperty(HTMLElement.prototype, key)
    }
  })
})
