// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { act, render, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WebviewHost } from '../WebviewHost'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@renderer/data/hooks/usePreference', async () => {
  const { mockUsePreference } = await import('@test-mocks/renderer/usePreference')
  return { usePreference: mockUsePreference }
})

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest }
}))

describe('WebviewHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.setPreferenceValue('app.spell_check.enabled', true)
    vi.spyOn(mockRendererLoggerService, 'debug').mockImplementation(() => {})
  })

  it('owns the common guest lifecycle without MiniApp-specific state', async () => {
    const onWebviewChange = vi.fn()
    const onNavigate = vi.fn()
    const view = render(
      <WebviewHost
        id="agent-browser:session-a"
        src="http://localhost:5173/"
        partition="agent-dev-preview"
        reloadKey={0}
        allowPopups
        openLinksExternal={false}
        elementAttributes={{ 'data-owner': 'agent-pane' }}
        onWebviewChange={onWebviewChange}
        onDidNavigate={onNavigate}
      />
    )
    const webview = view.container.querySelector('webview') as unknown as WebviewTag
    const reload = vi.fn()
    Object.assign(webview, {
      getWebContentsId: vi.fn(() => 42),
      reload
    })

    expect(webview).toHaveAttribute('partition', 'agent-dev-preview')
    expect(webview).toHaveAttribute('allowpopups', 'true')
    expect(webview).toHaveAttribute('data-owner', 'agent-pane')
    expect(webview).toHaveAttribute('src', 'http://localhost:5173/')
    expect(onWebviewChange).toHaveBeenCalledWith(webview)

    webview.dispatchEvent(new Event('dom-ready'))
    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith('webview.set_spell_check_enabled', {
        webviewId: 42,
        isEnable: true
      })
      expect(mocks.ipcRequest).toHaveBeenCalledWith('webview.set_open_link_external', {
        webviewId: 42,
        isExternal: false
      })
    })

    const navigationEvent = Object.assign(new Event('did-navigate'), {
      isMainFrame: true,
      url: 'http://localhost:5173/dashboard'
    })
    webview.dispatchEvent(navigationEvent)
    expect(onNavigate).toHaveBeenCalledWith(navigationEvent)

    view.rerender(
      <WebviewHost
        id="agent-browser:session-a"
        src="http://localhost:5173/"
        partition="agent-dev-preview"
        reloadKey={1}
        onWebviewChange={onWebviewChange}
      />
    )
    expect(reload).toHaveBeenCalledOnce()

    view.unmount()
    expect(onWebviewChange).toHaveBeenLastCalledWith(null)
  })

  it('replaces the guest when its security profile changes', () => {
    const view = render(<WebviewHost id="changing-profile" src="about:blank" partition="agent-dev-preview" />)
    const firstGuest = view.container.querySelector('webview')

    view.rerender(
      <WebviewHost id="changing-profile" src="file:///workspace/index.html" partition="agent-html-artifact" />
    )

    const secondGuest = view.container.querySelector('webview')
    expect(secondGuest).not.toBe(firstGuest)
    expect(secondGuest).toHaveAttribute('partition', 'agent-html-artifact')
  })
  it('updates preferences without replaying readiness or duplicating navigation callbacks', () => {
    const loaded = vi.fn()
    const navigated = vi.fn()
    const props = { id: 'site', src: 'https://example.com/', partition: 'persist:webview' }
    const view = render(<WebviewHost {...props} onDomReady={loaded} />)
    const guest = view.container.querySelector('webview') as unknown as WebviewTag
    Object.assign(guest, { getWebContentsId: () => 42, isLoading: () => false })
    act(() => {
      guest.dispatchEvent(new Event('dom-ready'))
    })
    expect(loaded).toHaveBeenCalledOnce()
    mocks.ipcRequest.mockClear()

    MockUsePreferenceUtils.setPreferenceValue('app.spell_check.enabled', false)
    view.rerender(<WebviewHost {...props} openLinksExternal={false} onDomReady={loaded} onDidNavigate={navigated} />)
    expect(view.container.querySelector('webview')).toBe(guest)
    expect(loaded).toHaveBeenCalledOnce()
    expect(mocks.ipcRequest).toHaveBeenCalledWith('webview.set_spell_check_enabled', { webviewId: 42, isEnable: false })
    expect(mocks.ipcRequest).toHaveBeenCalledWith('webview.set_open_link_external', {
      webviewId: 42,
      isExternal: false
    })
    act(() => {
      guest.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'https://example.com/next' }))
    })
    expect(navigated).toHaveBeenCalledOnce()
    view.unmount()
    guest.dispatchEvent(Object.assign(new Event('did-navigate'), { url: 'https://example.com/late' }))
    expect(navigated).toHaveBeenCalledOnce()
  })
})
