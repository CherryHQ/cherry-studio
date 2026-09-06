// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { mockRendererLoggerService } from '@test-mocks/RendererLoggerService'
import { render, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WebviewHost } from '../WebviewHost'

const mocks = vi.hoisted(() => ({
  ipcRequest: vi.fn().mockResolvedValue(undefined)
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => [true, vi.fn()]
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest }
}))

describe('WebviewHost', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(mockRendererLoggerService, 'debug').mockImplementation(() => {})
  })

  it('owns the common guest lifecycle without MiniApp-specific state', async () => {
    const onWebviewChange = vi.fn()
    const onNavigate = vi.fn()
    const view = render(
      <WebviewHost
        id="agent-browser:session-a"
        src="http://localhost:5173/"
        securityProfile="agent-dev-preview"
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
        securityProfile="agent-dev-preview"
        reloadKey={1}
        onWebviewChange={onWebviewChange}
      />
    )
    expect(reload).toHaveBeenCalledOnce()

    view.unmount()
    expect(onWebviewChange).toHaveBeenLastCalledWith(null)
  })

  it('replaces the guest when its security profile changes', () => {
    const view = render(<WebviewHost id="changing-profile" src="about:blank" securityProfile="agent-dev-preview" />)
    const firstGuest = view.container.querySelector('webview')

    view.rerender(
      <WebviewHost id="changing-profile" src="file:///workspace/index.html" securityProfile="agent-html-artifact" />
    )

    const secondGuest = view.container.querySelector('webview')
    expect(secondGuest).not.toBe(firstGuest)
    expect(secondGuest).toHaveAttribute('partition', 'agent-html-artifact')
  })
})
