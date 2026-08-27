import type { MiniApp } from '@shared/data/types/miniApp'
import { act, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `WebviewContainer` renders an Electron `<webview>` element which JSDOM can't
// instantiate. Stub it with a div carrying the same `data-mini-app-id` so DOM
// order assertions still work.
vi.mock('@renderer/components/MiniApp/WebviewContainer', () => ({
  default: ({
    appid,
    url,
    onSetRefCallback,
    onLoadedCallback,
    onFocusChange
  }: {
    appid: string
    url: string
    onSetRefCallback: (appid: string, el: HTMLElement | null) => void
    onLoadedCallback?: (appid: string) => void
    onFocusChange?: (appid: string, focused: boolean) => void
  }) => (
    // Forward the ref like the real container does — the pool drives pane
    // visibility through `ref.style.display`.
    <div
      ref={(el) => {
        onSetRefCallback(appid, el)
        if (onLoadedCallback) mocks.loadHandlers.set(appid, onLoadedCallback)
        if (onFocusChange) mocks.focusHandlers.set(appid, onFocusChange)
      }}
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
  openedOneOffMiniApp: null as MiniApp | null,
  maxKeepAliveMiniApps: 10,
  setOpenedKeepAliveMiniApps: vi.fn(),
  setCurrentMiniAppId: vi.fn(),
  setMiniAppShow: vi.fn(),
  tabs: [] as { id: string; url: string; isDormant?: boolean; isPinned?: boolean }[],
  activeTabId: '',
  clearWebviewState: vi.fn(),
  focusHandlers: new Map<string, (appid: string, focused: boolean) => void>(),
  loadHandlers: new Map<string, (appid: string) => void>(),
  contextKeys: [] as Array<{ key: string; value: unknown }>
}))

vi.mock('@renderer/hooks/command', () => ({
  useCommandContextKey: (key: string, value: unknown) => {
    mocks.contextKeys.push({ key, value })
  }
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    openedKeepAliveMiniApps: mocks.openedKeepAliveMiniApps,
    currentMiniAppId: mocks.currentMiniAppId,
    splitOpen: mocks.splitOpen,
    splitMiniAppId: mocks.splitMiniAppId,
    openedOneOffMiniApp: mocks.openedOneOffMiniApp,
    setOpenedKeepAliveMiniApps: mocks.setOpenedKeepAliveMiniApps,
    setCurrentMiniAppId: mocks.setCurrentMiniAppId,
    setMiniAppShow: mocks.setMiniAppShow
  })
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [mocks.maxKeepAliveMiniApps]
}))

vi.mock('@renderer/hooks/tab', () => ({
  useTabs: () => ({
    tabs: mocks.tabs,
    activeTabId: mocks.activeTabId
  })
}))

vi.mock('@renderer/utils/webviewStateManager', () => ({
  clearWebviewState: mocks.clearWebviewState,
  getWebviewLoaded: () => false,
  setWebviewLoaded: vi.fn()
}))

import { clearWebviewState, setWebviewLoaded } from '@renderer/utils/webviewStateManager'

import MiniAppTabsPool from '../MiniAppTabsPool'

const PassiveEffectProbe = ({ onEffect }: { onEffect: () => void }) => {
  useEffect(() => {
    onEffect()
  }, [onEffect])
  return null
}

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
    vi.clearAllMocks()
    mocks.openedKeepAliveMiniApps = []
    mocks.currentMiniAppId = ''
    mocks.splitOpen = false
    mocks.splitMiniAppId = ''
    mocks.openedOneOffMiniApp = null
    mocks.maxKeepAliveMiniApps = 10
    mocks.setOpenedKeepAliveMiniApps.mockReset()
    mocks.tabs = []
    mocks.activeTabId = ''
    mocks.setOpenedKeepAliveMiniApps.mockImplementation((value: MiniApp[] | ((prev: MiniApp[]) => MiniApp[])) => {
      mocks.openedKeepAliveMiniApps = typeof value === 'function' ? value(mocks.openedKeepAliveMiniApps) : value
    })
    mocks.setCurrentMiniAppId.mockImplementation((value: string) => {
      mocks.currentMiniAppId = value
    })
    mocks.setMiniAppShow.mockImplementation(() => undefined)
    mocks.clearWebviewState.mockReset()
    mocks.focusHandlers.clear()
    mocks.loadHandlers.clear()
    mocks.contextKeys = []
  })

  /** Latest value the pool published for `webview.focused`. */
  const focusedKey = () => mocks.contextKeys.filter((e) => e.key === 'webview.focused').at(-1)?.value

  it('keeps webview.focused set when another pane mounts behind the focused one', () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha')]
    mocks.currentMiniAppId = 'alpha'
    mocks.tabs = [{ id: 't1', url: '/app/mini-app/alpha' }]
    mocks.activeTabId = 't1'

    const { rerender } = render(<MiniAppTabsPool />)
    expect(focusedKey()).toBe(false)

    act(() => {
      mocks.focusHandlers.get('alpha')!('alpha', true)
    })
    expect(focusedKey()).toBe(true)

    // Opening a second MiniApp mounts another pane while alpha still holds focus.
    // Per-pane registration made the newcomer's `false` win and handed Escape back
    // to app.fullscreen.exit.
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
    act(() => {
      rerender(<MiniAppTabsPool />)
    })
    expect(focusedKey()).toBe(true)

    act(() => {
      mocks.focusHandlers.get('alpha')!('alpha', false)
    })
    expect(focusedKey()).toBe(false)
  })

  it('ignores a stale blur from a pane that no longer holds focus', () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
    mocks.currentMiniAppId = 'alpha'
    mocks.tabs = [{ id: 't1', url: '/app/mini-app/alpha' }]
    mocks.activeTabId = 't1'

    render(<MiniAppTabsPool />)

    // Focus moves alpha -> bravo; alpha's blur can land after bravo's focus.
    act(() => {
      mocks.focusHandlers.get('alpha')!('alpha', true)
      mocks.focusHandlers.get('bravo')!('bravo', true)
      mocks.focusHandlers.get('alpha')!('alpha', false)
    })

    expect(focusedKey()).toBe(true)
  })

  it('renders webviews in stable appId-sorted order regardless of LRU order', () => {
    // Three apps. The hook returns them in LRU order (most-recent last).
    mocks.openedKeepAliveMiniApps = [stubApp('charlie'), stubApp('alpha'), stubApp('bravo')]
    mocks.currentMiniAppId = 'alpha'
    mocks.tabs = [
      { id: 't1', url: '/app/mini-app/alpha' },
      { id: 't2', url: '/app/mini-app/bravo' },
      { id: 't3', url: '/app/mini-app/charlie' }
    ]
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
    mocks.tabs = [
      { id: 't1', url: '/app/mini-app/alpha' },
      { id: 't2', url: '/app/mini-app/charlie' }
    ]
    const { container, rerender } = render(<MiniAppTabsPool />)
    expect(renderedAppIds(container)).toEqual(['alpha', 'charlie'])

    // Adding "bravo" must place it between alpha/charlie alphabetically — the
    // existing two webviews retain their DOM positions.
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('charlie'), stubApp('bravo')]
    mocks.tabs = [
      { id: 't1', url: '/app/mini-app/alpha' },
      { id: 't2', url: '/app/mini-app/bravo' },
      { id: 't3', url: '/app/mini-app/charlie' }
    ]
    rerender(<MiniAppTabsPool />)
    expect(renderedAppIds(container)).toEqual(['alpha', 'bravo', 'charlie'])
  })

  it('updates WebviewContainer props when an opened app changes without changing appId', () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
    mocks.currentMiniAppId = 'alpha'
    mocks.tabs = [
      { id: 't1', url: '/app/mini-app/alpha' },
      { id: 't2', url: '/app/mini-app/bravo' }
    ]
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

  it('evicts keep-alive apps that no tab still references', async () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
    mocks.currentMiniAppId = 'bravo'
    mocks.tabs = [
      { id: 't1', url: '/app/mini-app/alpha' },
      { id: 'home', url: '/app/translate' }
    ]
    mocks.activeTabId = 'home'

    const { rerender } = render(<MiniAppTabsPool />)

    await waitFor(() => expect(mocks.openedKeepAliveMiniApps.map((app) => app.appId)).toEqual(['alpha']))
    expect(clearWebviewState).toHaveBeenCalledWith('bravo')
    // The reactive cache re-renders the pool; realign observes the fresh pool there.
    act(() => {
      rerender(<MiniAppTabsPool />)
    })
    expect(mocks.setCurrentMiniAppId).toHaveBeenCalledWith('')
    expect(mocks.setMiniAppShow).toHaveBeenCalledWith(false)
  })

  it('moves global current state to the active mini app when the previous current app is evicted', async () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
    mocks.currentMiniAppId = 'bravo'
    mocks.tabs = [{ id: 't1', url: '/app/mini-app/alpha' }]
    mocks.activeTabId = 't1'

    const { rerender } = render(<MiniAppTabsPool />)

    await waitFor(() => expect(mocks.openedKeepAliveMiniApps.map((app) => app.appId)).toEqual(['alpha']))
    expect(clearWebviewState).toHaveBeenCalledWith('bravo')
    act(() => {
      rerender(<MiniAppTabsPool />)
    })
    expect(mocks.setCurrentMiniAppId).toHaveBeenCalledWith('alpha')
    expect(mocks.setMiniAppShow).toHaveBeenCalledWith(true)
  })

  it('clears global current state when the active mini app is not kept alive', async () => {
    mocks.openedKeepAliveMiniApps = [stubApp('bravo')]
    mocks.currentMiniAppId = 'bravo'
    mocks.tabs = [{ id: 't1', url: '/app/mini-app/alpha' }]
    mocks.activeTabId = 't1'

    const { rerender } = render(<MiniAppTabsPool />)

    await waitFor(() => expect(mocks.openedKeepAliveMiniApps).toEqual([]))
    expect(clearWebviewState).toHaveBeenCalledWith('bravo')
    act(() => {
      rerender(<MiniAppTabsPool />)
    })
    expect(mocks.setCurrentMiniAppId).toHaveBeenCalledWith('')
    expect(mocks.setMiniAppShow).toHaveBeenCalledWith(false)
  })

  it('keeps a webview alive from URL-only mini app tabs', () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha')]
    mocks.currentMiniAppId = 'alpha'
    mocks.tabs = [{ id: 't1', url: '/app/mini-app/alpha' }]
    mocks.activeTabId = 't1'

    render(<MiniAppTabsPool />)

    expect(mocks.openedKeepAliveMiniApps.map((app) => app.appId)).toEqual(['alpha'])
    expect(clearWebviewState).not.toHaveBeenCalled()
  })

  it('keeps a split-opened app pooled after the split closes', async () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
    mocks.currentMiniAppId = 'alpha'
    mocks.tabs = [{ id: 't1', url: '/app/mini-app/alpha' }]
    mocks.activeTabId = 't1'
    mocks.splitOpen = true
    mocks.splitMiniAppId = 'bravo'

    const { rerender } = render(<MiniAppTabsPool />)
    expect(mocks.openedKeepAliveMiniApps.map((app) => app.appId)).toEqual(['alpha', 'bravo'])

    // closeSplit's contract: only the pane closes; the app stays pooled for the cap-LRU.
    mocks.splitOpen = false
    mocks.splitMiniAppId = ''
    act(() => {
      rerender(<MiniAppTabsPool />)
    })

    expect(mocks.openedKeepAliveMiniApps.map((app) => app.appId)).toEqual(['alpha', 'bravo'])
    expect(clearWebviewState).not.toHaveBeenCalledWith('bravo')
  })

  it('realigns a current id that references an app missing from the pool', async () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
    mocks.currentMiniAppId = 'ghost'
    mocks.tabs = [{ id: 't1', url: '/app/mini-app/alpha' }]
    mocks.activeTabId = 't1'

    render(<MiniAppTabsPool />)

    await waitFor(() => expect(mocks.openedKeepAliveMiniApps.map((app) => app.appId)).toEqual(['alpha']))
    expect(mocks.setCurrentMiniAppId).toHaveBeenCalledWith('alpha')
    expect(mocks.setMiniAppShow).toHaveBeenCalledWith(true)
  })

  it('keeps an app current when it joins the pool between render and orphan cleanup (in-place tab switch)', async () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha')]
    mocks.currentMiniAppId = 'alpha'
    mocks.tabs = [{ id: 't1', url: '/app/mini-app/bravo' }]
    mocks.activeTabId = 't1'

    // MiniAppPage's passive effect commits bravo to the store before the pool's
    // cleanup effect runs — the pool's closures still hold the pre-bravo snapshot.
    const { rerender } = render(
      <>
        <PassiveEffectProbe
          onEffect={() => {
            mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
            mocks.currentMiniAppId = 'bravo'
          }}
        />
        <MiniAppTabsPool />
      </>
    )
    await waitFor(() => expect(mocks.openedKeepAliveMiniApps.map((app) => app.appId)).toEqual(['bravo']))
    expect(clearWebviewState).toHaveBeenCalledWith('alpha')

    // The store update re-renders the pool; realign must not have hidden bravo meanwhile.
    act(() => {
      rerender(
        <>
          <PassiveEffectProbe onEffect={() => undefined} />
          <MiniAppTabsPool />
        </>
      )
    })

    expect(mocks.currentMiniAppId).toBe('bravo')
    expect(mocks.setMiniAppShow).not.toHaveBeenCalledWith(false)
  })

  it('realigns a dangling current id even when no orphan cleanup runs', () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha')]
    mocks.currentMiniAppId = 'ghost'
    mocks.tabs = [{ id: 't1', url: '/app/mini-app/alpha' }]
    mocks.activeTabId = 't1'

    render(<MiniAppTabsPool />)

    expect(mocks.setOpenedKeepAliveMiniApps).not.toHaveBeenCalled()
    expect(mocks.setCurrentMiniAppId).toHaveBeenCalledWith('alpha')
    expect(mocks.setMiniAppShow).toHaveBeenCalledWith(true)
  })

  it('leaves a one-off current app untouched while orphan cleanup evicts pooled apps', async () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha')]
    mocks.openedOneOffMiniApp = stubApp('solo')
    mocks.currentMiniAppId = 'solo'
    mocks.tabs = [{ id: 'home', url: '/app/translate' }]
    mocks.activeTabId = 'home'

    render(<MiniAppTabsPool />)

    await waitFor(() => expect(mocks.openedKeepAliveMiniApps).toEqual([]))
    expect(clearWebviewState).toHaveBeenCalledWith('alpha')
    expect(mocks.setCurrentMiniAppId).not.toHaveBeenCalled()
    expect(mocks.setMiniAppShow).not.toHaveBeenCalledWith(false)
  })

  it('ignores a load callback that lands after the app was evicted', async () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
    mocks.currentMiniAppId = 'alpha'
    mocks.tabs = [
      { id: 't1', url: '/app/mini-app/alpha' },
      { id: 't2', url: '/app/mini-app/bravo' }
    ]
    mocks.activeTabId = 't1'

    const { rerender } = render(<MiniAppTabsPool />)
    const staleLoad = mocks.loadHandlers.get('bravo')!

    // Closing bravo's tab evicts it; a webview load event can still be in flight.
    mocks.tabs = [{ id: 't1', url: '/app/mini-app/alpha' }]
    act(() => {
      rerender(<MiniAppTabsPool />)
    })
    await waitFor(() => expect(mocks.openedKeepAliveMiniApps.map((app) => app.appId)).toEqual(['alpha']))
    // The reactive cache update re-renders the pool, unmounting the evicted webview.
    act(() => {
      rerender(<MiniAppTabsPool />)
    })

    vi.mocked(setWebviewLoaded).mockClear()
    staleLoad('bravo')

    expect(setWebviewLoaded).not.toHaveBeenCalledWith('bravo', true)
  })

  it('trims the oldest unprotected webviews when the keep-alive cap decreases', () => {
    const alpha = stubApp('alpha')
    const bravo = stubApp('bravo')
    const charlie = stubApp('charlie')
    mocks.maxKeepAliveMiniApps = 1
    mocks.openedKeepAliveMiniApps = [alpha, bravo, charlie]

    const { container } = render(<MiniAppTabsPool />)

    expect(renderedAppIds(container)).toEqual(['charlie'])
    expect(mocks.setOpenedKeepAliveMiniApps).toHaveBeenCalledWith([charlie])
    expect(mocks.clearWebviewState).toHaveBeenCalledWith('alpha')
    expect(mocks.clearWebviewState).toHaveBeenCalledWith('bravo')
  })

  it('preserves awake pinned webviews while trimming an unpinned entry', () => {
    const pinA = stubApp('pinA')
    const unpinned = stubApp('unpinned')
    const pinC = stubApp('pinC')
    mocks.maxKeepAliveMiniApps = 1
    mocks.openedKeepAliveMiniApps = [pinA, unpinned, pinC]
    mocks.tabs = [
      { id: 'pin-a', url: '/app/mini-app/pinA', isPinned: true },
      { id: 'pin-c', url: '/app/mini-app/pinC', isPinned: true }
    ]

    const { container } = render(<MiniAppTabsPool />)

    expect(renderedAppIds(container)).toEqual(['pinA', 'pinC'])
    expect(mocks.setOpenedKeepAliveMiniApps).toHaveBeenCalledWith([pinA, pinC])
    expect(mocks.clearWebviewState).toHaveBeenCalledWith('unpinned')
  })

  it('evicts a dormant pin from the global pool without evicting the active miniapp', () => {
    const dormant = stubApp('dormant')
    const pinned = stubApp('pinned')
    const active = stubApp('active')
    mocks.maxKeepAliveMiniApps = 2
    mocks.openedKeepAliveMiniApps = [dormant, pinned, active]
    mocks.currentMiniAppId = active.appId
    mocks.tabs = [
      { id: 'dormant-tab', url: '/app/mini-app/dormant', isPinned: true, isDormant: true },
      { id: 'pinned-tab', url: '/app/mini-app/pinned', isPinned: true },
      { id: 'active-tab', url: '/app/mini-app/active' }
    ]
    mocks.activeTabId = 'active-tab'

    const { container } = render(<MiniAppTabsPool />)

    expect(renderedAppIds(container)).toEqual(['active', 'pinned'])
    expect(mocks.setOpenedKeepAliveMiniApps).toHaveBeenCalledWith([pinned, active])
    expect(mocks.clearWebviewState).toHaveBeenCalledWith('dormant')
    expect(mocks.clearWebviewState).not.toHaveBeenCalledWith('active')
  })

  it.each(['?source=assistant', '#details'])('protects the active miniapp when its tab URL ends with %s', (suffix) => {
    const alpha = stubApp('alpha')
    const bravo = stubApp('bravo')
    mocks.maxKeepAliveMiniApps = 1
    mocks.openedKeepAliveMiniApps = [alpha, bravo]
    mocks.currentMiniAppId = alpha.appId
    mocks.tabs = [{ id: 'active-tab', url: `/app/mini-app/alpha${suffix}` }]
    mocks.activeTabId = 'active-tab'

    const { container } = render(<MiniAppTabsPool />)

    expect(renderedAppIds(container)).toEqual(['alpha'])
    expect(mocks.setOpenedKeepAliveMiniApps).toHaveBeenCalledWith([alpha])
    expect(mocks.clearWebviewState).toHaveBeenCalledWith('bravo')
    expect(mocks.clearWebviewState).not.toHaveBeenCalledWith('alpha')
  })

  it('reconciles retention before sibling passive effects can update the keep-alive cache', () => {
    const effectOrder: string[] = []
    mocks.maxKeepAliveMiniApps = 1
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
    // Both apps stay tab-referenced so only the retention layout effect fires, not orphan cleanup.
    mocks.tabs = [
      { id: 't1', url: '/app/mini-app/alpha' },
      { id: 't2', url: '/app/mini-app/bravo' }
    ]
    mocks.setOpenedKeepAliveMiniApps.mockImplementation(() => effectOrder.push('pool'))

    render(
      <>
        <PassiveEffectProbe onEffect={() => effectOrder.push('page')} />
        <MiniAppTabsPool />
      </>
    )

    expect(effectOrder).toEqual(['pool', 'page'])
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
