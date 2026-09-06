// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { MiniApp } from '@shared/data/types/miniApp'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { WebviewTag } from 'electron'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, RefObject } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MinimalToolbar from '../MinimalToolbar'

const mocks = vi.hoisted(() => ({
  loadURL: vi.fn().mockResolvedValue(undefined),
  openWebsite: vi.fn().mockResolvedValue(undefined),
  toastError: vi.fn()
}))

vi.mock('@cherrystudio/ui', () => ({
  Button: ({ children, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
  Input: (props: InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [false, vi.fn()]
}))

vi.mock('@renderer/components/MiniApp/MiniAppDetailPanel', () => ({ default: () => null }))
vi.mock('@renderer/components/WebviewAnnotationControls', () => ({
  WebviewAnnotationControls: () => <div data-testid="annotation-controls" />
}))
vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({ pinned: [], allApps: [], updateAppStatus: vi.fn() })
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (_route: string, url: string) => mocks.openWebsite(url) }
}))
vi.mock('@renderer/services/toast', () => ({ toast: { error: mocks.toastError } }))
vi.mock('@renderer/utils/platform', () => ({ isDev: false }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'miniApp.error.load_failed': 'Failed to load app',
        'settings.miniApps.custom.url': 'URL',
        'settings.miniApps.custom.url_invalid': 'Enter a valid URL'
      })[key] ?? key
  })
}))

const app: MiniApp = {
  appId: 'demo',
  kind: 'site',
  presetMiniAppId: 'demo',
  status: 'enabled',
  orderKey: 'a0',
  name: 'Demo',
  url: 'https://example.com/',
  logo: 'application'
}

function createWebview(initialUrl = app.url) {
  let currentUrl = initialUrl
  const webview = document.createElement('webview') as unknown as WebviewTag
  Object.assign(webview, {
    canGoBack: vi.fn(() => false),
    canGoForward: vi.fn(() => false),
    getURL: vi.fn(() => currentUrl),
    goBack: vi.fn(),
    goForward: vi.fn(),
    loadURL: mocks.loadURL
  })

  const navigate = (type: 'did-navigate' | 'did-navigate-in-page', url: string, isMainFrame = true) => {
    currentUrl = url
    webview.dispatchEvent(Object.assign(new Event(type), { url, isMainFrame }))
  }

  return { navigate, webview }
}

function renderToolbar(webview: WebviewTag | null, currentUrl: string | null = app.url) {
  const webviewRef: RefObject<WebviewTag | null> = { current: webview }
  return {
    ...render(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        webviewRevision={0}
        currentUrl={currentUrl}
        isWebviewReady
        isHostActive
        onReload={vi.fn()}
        onOpenDevTools={vi.fn()}
        splitMode="open"
        onSplit={vi.fn()}
      />
    ),
    webviewRef
  }
}

describe('MinimalToolbar address bar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.loadURL.mockResolvedValue(undefined)
  })

  it('normalizes and loads an entered web address', async () => {
    const { webview } = createWebview()
    const user = userEvent.setup()
    renderToolbar(webview)

    const address = screen.getByRole('textbox', { name: 'URL' })
    await user.clear(address)
    await user.type(address, 'cherry-ai.com/docs{Enter}')

    await waitFor(() => expect(mocks.loadURL).toHaveBeenCalledWith('https://cherry-ai.com/docs'))
  })

  it('normalizes a hostname with an explicit port as HTTPS', async () => {
    const { webview } = createWebview()
    const user = userEvent.setup()
    renderToolbar(webview)

    const address = screen.getByRole('textbox', { name: 'URL' })
    await user.clear(address)
    await user.type(address, 'example.com:8080/path{Enter}')

    await waitFor(() => expect(mocks.loadURL).toHaveBeenCalledWith('https://example.com:8080/path'))
  })

  it('normalizes a local hostname with an explicit port as HTTP', async () => {
    const { webview } = createWebview()
    const user = userEvent.setup()
    renderToolbar(webview)

    const address = screen.getByRole('textbox', { name: 'URL' })
    await user.clear(address)
    await user.type(address, 'localhost:3000{Enter}')

    await waitFor(() => expect(mocks.loadURL).toHaveBeenCalledWith('http://localhost:3000'))
  })

  it('tracks only main-frame navigation without overwriting an active edit', async () => {
    const { navigate, webview } = createWebview()
    const user = userEvent.setup()
    renderToolbar(webview)

    const address = screen.getByRole('textbox', { name: 'URL' })
    act(() => navigate('did-navigate', 'https://example.com/account'))
    expect(address).toHaveValue('https://example.com/account')

    act(() => navigate('did-navigate-in-page', 'https://tracker.example/frame', false))
    expect(address).toHaveValue('https://example.com/account')

    await user.click(address)
    await user.clear(address)
    await user.type(address, 'draft.example')
    act(() => navigate('did-navigate-in-page', 'https://example.com/account#profile'))
    expect(address).toHaveValue('draft.example')

    fireEvent.blur(address)
    expect(address).toHaveValue('https://example.com/account#profile')
  })

  it('rebinds navigation updates when the concrete webview changes', () => {
    const first = createWebview('https://first.example')
    const second = createWebview('https://second.example')
    const { rerender, webviewRef } = renderToolbar(first.webview, null)

    const address = screen.getByRole('textbox', { name: 'URL' })
    expect(address).toHaveValue('https://first.example')

    webviewRef.current = second.webview
    rerender(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        webviewRevision={1}
        currentUrl={null}
        isWebviewReady
        isHostActive
        onReload={vi.fn()}
        onOpenDevTools={vi.fn()}
        splitMode="open"
        onSplit={vi.fn()}
      />
    )
    expect(address).toHaveValue('https://second.example')

    act(() => first.navigate('did-navigate', 'https://stale.example'))
    expect(address).toHaveValue('https://second.example')

    act(() => second.navigate('did-navigate', 'https://current.example'))
    expect(address).toHaveValue('https://current.example')
  })

  it('ignores a late load failure from a replaced webview', async () => {
    let rejectLoad: ((error: Error) => void) | undefined
    mocks.loadURL.mockReturnValueOnce(
      new Promise<void>((_resolve, reject) => {
        rejectLoad = reject
      })
    )
    const first = createWebview('https://first.example')
    const second = createWebview('https://second.example')
    const user = userEvent.setup()
    const { rerender, webviewRef } = renderToolbar(first.webview, null)

    const address = screen.getByRole('textbox', { name: 'URL' })
    await user.clear(address)
    await user.type(address, 'missing.example{Enter}')
    await waitFor(() => expect(mocks.loadURL).toHaveBeenCalledWith('https://missing.example'))

    webviewRef.current = second.webview
    rerender(
      <MinimalToolbar
        app={app}
        webviewRef={webviewRef}
        webviewRevision={1}
        currentUrl={null}
        isWebviewReady
        isHostActive
        onReload={vi.fn()}
        onOpenDevTools={vi.fn()}
        splitMode="open"
        onSplit={vi.fn()}
      />
    )
    expect(address).toHaveValue('https://second.example')

    await act(async () => {
      rejectLoad?.(new Error('ERR_NAME_NOT_RESOLVED'))
      await Promise.resolve()
    })

    expect(address).toHaveValue('https://second.example')
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('rejects unsupported protocols and restores the current page after a load failure', async () => {
    const { webview } = createWebview('https://example.com/current')
    const user = userEvent.setup()
    renderToolbar(webview, 'https://example.com/current')

    const address = screen.getByRole('textbox', { name: 'URL' })
    await user.clear(address)
    await user.type(address, 'javascript:alert(1){Enter}')

    expect(mocks.loadURL).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalledWith('Enter a valid URL')
    expect(address).toHaveValue('https://example.com/current')

    mocks.loadURL.mockRejectedValueOnce(new Error('ERR_NAME_NOT_RESOLVED'))
    await user.click(address)
    await user.clear(address)
    await user.type(address, 'missing.example{Enter}')

    await waitFor(() => expect(mocks.toastError).toHaveBeenLastCalledWith('Failed to load app'))
    expect(address).toHaveValue('https://example.com/current')
  })
})
