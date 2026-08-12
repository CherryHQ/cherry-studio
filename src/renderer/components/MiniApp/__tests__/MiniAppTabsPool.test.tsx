import type { MiniApp } from '@shared/data/types/miniApp'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `WebviewContainer` renders an Electron `<webview>` element which JSDOM can't
// instantiate. Stub it with a div carrying the same `data-mini-app-id` so DOM
// order assertions still work.
vi.mock('@renderer/components/MiniApp/WebviewContainer', () => ({
  default: ({
    appid,
    url,
    onSetRefCallback
  }: {
    appid: string
    url: string
    onSetRefCallback: (appid: string, el: HTMLElement | null) => void
  }) => (
    // Forward the ref like the real container does — the pool drives pane
    // visibility through `ref.style.display`.
    <div
      ref={(el) => onSetRefCallback(appid, el)}
      data-mini-app-id={appid}
      data-testid={`webview-${appid}`}
      data-url={url}
    />
  )
}))

const stubApp = (id: string): MiniApp => ({
  appId: id,
  name: id,
  url: `https://${id}.example.com`,
  presetMiniAppId: id as MiniApp['presetMiniAppId'],
  status: 'enabled',
  orderKey: 'a0'
})

const mocks = vi.hoisted(() => ({
  openedKeepAliveMiniApps: [] as MiniApp[],
  currentMiniAppId: '',
  splitOpen: false,
  splitMiniAppId: '',
  tabs: [] as { id: string; url: string }[],
  activeTabId: ''
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    openedKeepAliveMiniApps: mocks.openedKeepAliveMiniApps,
    currentMiniAppId: mocks.currentMiniAppId,
    splitOpen: mocks.splitOpen,
    splitMiniAppId: mocks.splitMiniAppId
  })
}))

vi.mock('@renderer/hooks/tab', () => ({
  useTabs: () => ({
    tabs: mocks.tabs,
    activeTabId: mocks.activeTabId
  })
}))

vi.mock('@renderer/utils/webviewStateManager', () => ({
  getWebviewLoaded: () => false,
  setWebviewLoaded: vi.fn()
}))

import MiniAppTabsPool from '../MiniAppTabsPool'

const renderedAppIds = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-mini-app-id]')).map((el) => el.dataset.miniAppId as string)

const renderedAppUrls = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[data-mini-app-id]')).map((el) => el.dataset.url as string)

const webviewOf = (container: HTMLElement, appId: string): HTMLElement =>
  container.querySelector<HTMLElement>(`[data-mini-app-id="${appId}"]`) as HTMLElement

/** The positioned box wrapping one webview — carries the pane geometry. */
const paneOf = (container: HTMLElement, appId: string): HTMLElement =>
  webviewOf(container, appId).parentElement as HTMLElement

describe('MiniAppTabsPool', () => {
  beforeEach(() => {
    mocks.openedKeepAliveMiniApps = []
    mocks.currentMiniAppId = ''
    mocks.splitOpen = false
    mocks.splitMiniAppId = ''
    mocks.tabs = []
    mocks.activeTabId = ''
  })

  it('renders webviews in stable appId-sorted order regardless of LRU order', () => {
    // Three apps. The hook returns them in LRU order (most-recent last).
    mocks.openedKeepAliveMiniApps = [stubApp('charlie'), stubApp('alpha'), stubApp('bravo')]
    mocks.currentMiniAppId = 'alpha'
    mocks.tabs = [{ id: 't1', url: '/app/mini-app/alpha' }]
    mocks.activeTabId = 't1'

    const { container, rerender } = render(<MiniAppTabsPool />)

    // Always sorted by appId, NOT by LRU order — otherwise React would move
    // <webview> DOM nodes when the LRU touches an app, and Electron <webview>
    // loses its content on detach/reattach.
    expect(renderedAppIds(container)).toEqual(['alpha', 'bravo', 'charlie'])

    // LRU touches "charlie" — list re-orders, but the rendered DOM order must
    // stay the same so no <webview> gets moved.
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo'), stubApp('charlie')]
    mocks.currentMiniAppId = 'charlie'
    rerender(<MiniAppTabsPool />)

    expect(renderedAppIds(container)).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('keeps DOM order stable when an app is added (only the new one inserts in sort position)', () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('charlie')]
    mocks.currentMiniAppId = 'alpha'
    const { container, rerender } = render(<MiniAppTabsPool />)
    expect(renderedAppIds(container)).toEqual(['alpha', 'charlie'])

    // Adding "bravo" must place it between alpha/charlie alphabetically — the
    // existing two webviews retain their DOM positions.
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('charlie'), stubApp('bravo')]
    rerender(<MiniAppTabsPool />)
    expect(renderedAppIds(container)).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('updates WebviewContainer props when an opened app changes without changing appId', () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
    mocks.currentMiniAppId = 'alpha'
    const { container, rerender } = render(<MiniAppTabsPool />)
    expect(renderedAppIds(container)).toEqual(['alpha', 'bravo'])
    expect(renderedAppUrls(container)).toEqual(['https://alpha.example.com', 'https://bravo.example.com'])

    mocks.openedKeepAliveMiniApps = [
      { ...stubApp('bravo'), url: 'https://bravo.example.com' },
      { ...stubApp('alpha'), url: 'https://renamed-alpha.example.com' }
    ]
    rerender(<MiniAppTabsPool />)

    expect(renderedAppIds(container)).toEqual(['alpha', 'bravo'])
    expect(renderedAppUrls(container)).toEqual(['https://renamed-alpha.example.com', 'https://bravo.example.com'])
  })

  describe('split panes', () => {
    beforeEach(() => {
      mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo'), stubApp('charlie')]
      mocks.currentMiniAppId = 'alpha'
      mocks.tabs = [{ id: 't1', url: '/app/mini-app/alpha' }]
      mocks.activeTabId = 't1'
    })

    it('shows the active and split apps side by side, hiding the rest', () => {
      mocks.splitOpen = true
      mocks.splitMiniAppId = 'bravo'

      const { container } = render(<MiniAppTabsPool />)

      expect(webviewOf(container, 'alpha').style.display).toBe('inline-flex')
      expect(webviewOf(container, 'bravo').style.display).toBe('inline-flex')
      expect(webviewOf(container, 'charlie').style.display).toBe('none')

      expect(paneOf(container, 'alpha').className).toContain('w-1/2')
      expect(paneOf(container, 'alpha').className).toContain('left-0')
      expect(paneOf(container, 'bravo').className).toContain('w-1/2')
      expect(paneOf(container, 'bravo').className).toContain('left-1/2')
    })

    it('lets the split pane receive clicks', () => {
      mocks.splitOpen = true
      mocks.splitMiniAppId = 'bravo'

      const { container } = render(<MiniAppTabsPool />)

      // Without this the user can see the second model but cannot type into it.
      expect(paneOf(container, 'bravo').className).toContain('pointer-events-auto')
      expect(paneOf(container, 'charlie').className).toContain('pointer-events-none')
    })

    it('leaves the second pane empty when the split id repeats the active app', () => {
      mocks.splitOpen = true
      mocks.splitMiniAppId = 'alpha'

      const { container } = render(<MiniAppTabsPool />)

      // One <webview> element cannot render in two places. Switching tabs can
      // make the active app equal the split one; showing it twice blanks a pane.
      expect(webviewOf(container, 'alpha').style.display).toBe('inline-flex')
      expect(webviewOf(container, 'bravo').style.display).toBe('none')
      expect(webviewOf(container, 'charlie').style.display).toBe('none')
    })

    it('restores full width after the split closes', () => {
      mocks.splitOpen = true
      mocks.splitMiniAppId = 'bravo'
      const { container, rerender } = render(<MiniAppTabsPool />)
      expect(paneOf(container, 'alpha').className).toContain('w-1/2')

      mocks.splitOpen = false
      mocks.splitMiniAppId = ''
      rerender(<MiniAppTabsPool />)

      expect(paneOf(container, 'alpha').className).toContain('w-full')
      expect(webviewOf(container, 'alpha').style.display).toBe('inline-flex')
      expect(webviewOf(container, 'bravo').style.display).toBe('none')
    })
  })
})
