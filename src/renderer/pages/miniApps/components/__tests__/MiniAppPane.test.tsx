import type { MiniApp } from '@shared/data/types/miniApp'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { WebviewTag } from 'electron'
import type { RefObject } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import MiniAppPane from '../MiniAppPane'

interface ToolbarProbeProps {
  webview?: WebviewTag | null
  webviewRef?: RefObject<WebviewTag | null>
  webviewRevision?: number
  isWebviewReady: boolean
}

const mocks = vi.hoisted(() => ({
  loaded: false,
  listeners: new Set<(loaded: boolean) => void>(),
  toolbarRenders: [] as ToolbarProbeProps[],
  toolbarProps: null as ToolbarProbeProps | null,
  searchWebviewRef: null as RefObject<WebviewTag | null> | null
}))

vi.mock('../MinimalToolbar', () => ({
  default: (props: ToolbarProbeProps) => {
    mocks.toolbarRenders.push(props)
    mocks.toolbarProps = props
    return (
      <div
        data-testid="minimal-toolbar"
        data-ready={String(props.isWebviewReady)}
        data-webview-id={(props.webviewRef?.current ?? props.webview)?.dataset.miniAppId ?? ''}
      />
    )
  }
}))

vi.mock('../WebviewSearch', () => ({
  default: ({ webviewRef }: { webviewRef: RefObject<WebviewTag | null> }) => {
    mocks.searchWebviewRef = webviewRef
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
  mocks.toolbarRenders.length = 0
  mocks.toolbarProps = null
  mocks.searchWebviewRef = null
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
  it('keeps an already-loaded webview behind one stable ref', () => {
    mocks.loaded = true
    const webview = createWebview()
    document.body.appendChild(webview)

    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} isHostActive />)

    expect(mocks.toolbarRenders[0]).toMatchObject({
      webviewRef: expect.objectContaining({ current: webview }),
      webviewRevision: expect.any(Number),
      isWebviewReady: true
    })
    expect(mocks.toolbarProps).not.toHaveProperty('webview')
    expect(mocks.toolbarProps?.webviewRef).toBe(mocks.searchWebviewRef)
    expect(mocks.searchWebviewRef?.current).toBe(webview)
    expect(screen.getByTestId('minimal-toolbar')).toHaveAttribute('data-ready', 'true')
    expect(screen.getByTestId('webview-search')).toHaveAttribute('data-webview-id', customApp.appId)
  })

  it('attaches a present webview without changing the ref identity', async () => {
    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} isHostActive />)
    const initialRef = mocks.searchWebviewRef
    const webview = createWebview()
    document.body.appendChild(webview)

    expect(initialRef?.current).toBeNull()
    emitLoaded(true)

    await waitFor(() => expect(mocks.toolbarProps?.webviewRef?.current).toBe(webview))
    expect(mocks.searchWebviewRef).toBe(initialRef)
    expect(initialRef?.current).toBe(webview)
    expect(screen.getByTestId('minimal-toolbar')).toHaveAttribute('data-ready', 'true')
  })

  it('reconciles replacement webviews and removes listeners from the retired element', async () => {
    mocks.loaded = true
    const firstWebview = createWebview()
    const removeEventListener = vi.spyOn(firstWebview, 'removeEventListener')
    document.body.appendChild(firstWebview)

    render(<MiniAppPane app={customApp} splitMode="open" onSplit={vi.fn()} isHostActive />)
    const stableRef = mocks.searchWebviewRef
    await waitFor(() => expect(stableRef?.current).toBe(firstWebview))

    const replacementWebview = createWebview()
    act(() => {
      firstWebview.remove()
    })

    await waitFor(() => expect(stableRef?.current).toBeNull())
    expect(mocks.toolbarProps?.webviewRef?.current).toBeNull()
    expect(screen.getByTestId('minimal-toolbar')).toHaveAttribute('data-ready', 'false')
    act(() => {
      document.body.appendChild(replacementWebview)
    })
    await waitFor(() => expect(stableRef?.current).toBe(replacementWebview))
    expect(mocks.toolbarProps?.webviewRef?.current).toBe(replacementWebview)
    expect(mocks.searchWebviewRef).toBe(stableRef)
    expect(screen.getByTestId('minimal-toolbar')).toHaveAttribute('data-ready', 'true')
    expect(screen.getByTestId('webview-search')).toHaveAttribute('data-webview-id', customApp.appId)
    expect(removeEventListener).toHaveBeenCalledWith('did-navigate-in-page', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('focus', expect.any(Function))

    emitLoaded(false)
    expect(stableRef?.current).toBeNull()
    expect(screen.getByTestId('minimal-toolbar')).toHaveAttribute('data-ready', 'false')

    emitLoaded(true)
    await waitFor(() => expect(stableRef?.current).toBe(replacementWebview))
    expect(screen.getByTestId('minimal-toolbar')).toHaveAttribute('data-ready', 'true')
  })
})
