import type { MiniApp } from '@shared/data/types/miniApp'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import type { RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MiniAppPane from '../MiniAppPane'

const mocks = vi.hoisted(() => ({
  loaded: false,
  listeners: new Set<(loaded: boolean) => void>(),
  toolbarProps: null as { webview: WebviewTag | null; isWebviewReady: boolean } | null,
  searchWebview: null as WebviewTag | null
}))

vi.mock('../MinimalToolbar', () => ({
  default: (props: { webview: WebviewTag | null; isWebviewReady: boolean }) => {
    mocks.toolbarProps = props
    return (
      <div
        data-testid="minimal-toolbar"
        data-ready={String(props.isWebviewReady)}
        data-webview-id={props.webview?.dataset.miniAppId ?? ''}
      />
    )
  }
}))

vi.mock('../WebviewSearch', () => ({
  default: ({ webviewRef }: { webviewRef: RefObject<WebviewTag | null> }) => {
    mocks.searchWebview = webviewRef.current
    return <div data-testid="webview-search" data-webview-id={webviewRef.current?.dataset.miniAppId ?? ''} />
  }
}))

vi.mock('@renderer/utils/webviewStateManager', () => ({
  getWebviewLoaded: () => mocks.loaded,
  onWebviewStateChange: (_appId: string, listener: (loaded: boolean) => void) => {
    mocks.listeners.add(listener)
    return () => mocks.listeners.delete(listener)
  },
  setWebviewLoaded: vi.fn()
}))

vi.mock('@renderer/components/icons/miniAppsLogo', () => ({
  getMiniAppsLogoRef: () => undefined,
  useMiniAppLogo: () => undefined
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

vi.mock('react-spinners/BeatLoader', () => ({
  default: () => <div data-testid="beat-loader" />
}))

const customApp: MiniApp = {
  appId: 'custom-chatgpt',
  kind: 'site',
  presetMiniAppId: null,
  status: 'enabled',
  orderKey: 'a0',
  name: 'ChatGPT',
  url: 'https://chat.openai.com',
  logoSrc: 'file:///files/chatgpt.webp'
}

type TestWebview = WebviewTag & HTMLElement

function createWebview(appId = customApp.appId): TestWebview {
  const webview = document.createElement('webview') as unknown as TestWebview
  webview.dataset.miniAppId = appId
  webview.reload = vi.fn()
  webview.openDevTools = vi.fn()
  return webview
}

function emitLoaded(loaded: boolean) {
  mocks.loaded = loaded
  act(() => {
    for (const listener of mocks.listeners) listener(loaded)
  })
}

beforeEach(() => {
  mocks.loaded = false
  mocks.listeners.clear()
  mocks.toolbarProps = null
  mocks.searchWebview = null
})

afterEach(() => {
  cleanup()
  document.querySelectorAll('webview').forEach((webview) => webview.remove())
})

describe('MiniAppPane loading logo', () => {
  it('names the standalone loading logo with the mini-app identity', () => {
    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} isHostActive />)

    expect(screen.getByRole('img', { name: 'ChatGPT' })).toHaveAttribute('src', 'file:///files/chatgpt.webp')
  })
})

describe('MiniAppPane concrete webview ownership', () => {
  it('passes an already-loaded concrete webview to its children as ready', async () => {
    mocks.loaded = true
    const webview = createWebview()
    document.body.appendChild(webview)

    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} isHostActive />)

    await waitFor(() => expect(mocks.toolbarProps?.webview).toBe(webview))
    expect(mocks.searchWebview).toBe(webview)
    expect(screen.getByTestId('minimal-toolbar')).toHaveAttribute('data-ready', 'true')
    expect(screen.getByTestId('webview-search')).toHaveAttribute('data-webview-id', customApp.appId)
  })

  it('attaches a present webview when readiness changes from false to true', async () => {
    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} isHostActive />)
    const webview = createWebview()
    document.body.appendChild(webview)

    expect(mocks.toolbarProps?.webview).toBeNull()
    emitLoaded(true)

    await waitFor(() => expect(mocks.toolbarProps?.webview).toBe(webview))
    expect(mocks.searchWebview).toBe(webview)
    expect(screen.getByTestId('minimal-toolbar')).toHaveAttribute('data-ready', 'true')
  })

  it('reconciles replacement webviews and removes listeners from the retired element', async () => {
    mocks.loaded = true
    const firstWebview = createWebview()
    const removeEventListener = vi.spyOn(firstWebview, 'removeEventListener')
    document.body.appendChild(firstWebview)

    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} isHostActive />)
    await waitFor(() => expect(mocks.toolbarProps?.webview).toBe(firstWebview))

    const replacementWebview = createWebview()
    act(() => {
      firstWebview.remove()
    })

    await waitFor(() => expect(mocks.toolbarProps?.webview).toBeNull())
    expect(screen.getByTestId('minimal-toolbar')).toHaveAttribute('data-ready', 'false')
    act(() => {
      document.body.appendChild(replacementWebview)
    })
    await waitFor(() => expect(mocks.toolbarProps?.webview).toBe(replacementWebview))
    expect(mocks.searchWebview).toBe(replacementWebview)
    expect(screen.getByTestId('minimal-toolbar')).toHaveAttribute('data-ready', 'true')
    expect(screen.getByTestId('webview-search')).toHaveAttribute('data-webview-id', customApp.appId)
    expect(removeEventListener).toHaveBeenCalledWith('did-navigate-in-page', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function))

    emitLoaded(false)
    expect(mocks.toolbarProps?.webview).toBeNull()
    expect(screen.getByTestId('minimal-toolbar')).toHaveAttribute('data-ready', 'false')

    emitLoaded(true)
    await waitFor(() => expect(mocks.toolbarProps?.webview).toBe(replacementWebview))
    expect(screen.getByTestId('minimal-toolbar')).toHaveAttribute('data-ready', 'true')
  })
})
