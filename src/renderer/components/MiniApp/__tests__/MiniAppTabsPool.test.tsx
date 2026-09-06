import type { MiniApp } from '@shared/data/types/miniApp'
import { act, render, screen, waitFor } from '@testing-library/react'
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
        // A local app's <webview> mounts only after `runtime.prepare`; `deferAttach`
        // replays that late attach when the test says so.
        // The real ref is a <webview> tag; the pool toggles devtools on it.
        if (el) {
          const tag = el as unknown as {
            openDevTools: () => void
            closeDevTools: () => void
            isDevToolsOpened: () => boolean
          }
          tag.openDevTools = () => {
            mocks.devToolsOpen.add(appid)
            mocks.openDevTools(appid)
          }
          tag.closeDevTools = () => {
            mocks.devToolsOpen.delete(appid)
            mocks.closeDevTools(appid)
          }
          tag.isDevToolsOpened = () => mocks.devToolsOpen.has(appid)
        }
        if (el && mocks.deferAttach.has(appid)) mocks.pendingAttach.set(appid, () => onSetRefCallback(appid, el))
        else onSetRefCallback(appid, el)
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
  kind: 'site',
  appId: id,
  name: id,
  url: `https://${id}.example.com`,
  presetMiniAppId: id as MiniApp['presetMiniAppId'],
  status: 'enabled',
  orderKey: 'a0'
})

const mocks = vi.hoisted(() => ({
  openDevTools: vi.fn(),
  closeDevTools: vi.fn(),
  devToolsOpen: new Set<string>(),
  commandHandlers: new Map<string, { handler: () => void; enabled: boolean }>(),
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
  closeTab: vi.fn(),
  setSplitOpen: vi.fn(),
  setSplitMiniAppId: vi.fn(),
  clearWebviewState: vi.fn(),
  focusHandlers: new Map<string, (appid: string, focused: boolean) => void>(),
  loadHandlers: new Map<string, (appid: string) => void>(),
  contextKeys: [] as Array<{ key: string; value: unknown }>,
  deferAttach: new Set<string>(),
  pendingAttach: new Map<string, () => void>()
}))

// `vi.hoisted` is required, not stylistic: `vi.mock` is hoisted above every `const`,
// so a factory closing over a plain one hits the TDZ on first import.
const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (payload: unknown) => void>(),
  request: vi.fn(() => Promise.resolve())
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: ipc.request },
  useIpcOn: (event: string, handler: (payload: unknown) => void) => {
    ipc.handlers.set(event, handler)
  }
}))
const emitIpc = (event: string, payload: unknown) => act(() => ipc.handlers.get(event)?.(payload))

vi.mock('@renderer/hooks/command', () => ({
  useCommandContextKey: (key: string, value: unknown) => {
    mocks.contextKeys.push({ key, value })
  },
  useCommandHandler: (command: string, handler: () => void, options?: { enabled?: boolean }) => {
    mocks.commandHandlers.set(command, { handler, enabled: options?.enabled !== false })
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
    setMiniAppShow: mocks.setMiniAppShow,
    setSplitOpen: mocks.setSplitOpen,
    setSplitMiniAppId: mocks.setSplitMiniAppId
  })
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: () => [mocks.maxKeepAliveMiniApps]
}))

vi.mock('@renderer/hooks/tab', () => ({
  useTabs: () => ({
    tabs: mocks.tabs,
    activeTabId: mocks.activeTabId,
    closeTab: mocks.closeTab
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
    mocks.closeTab.mockReset()
    mocks.setSplitOpen.mockReset()
    mocks.setSplitMiniAppId.mockReset()
    mocks.clearWebviewState.mockReset()
    mocks.focusHandlers.clear()
    mocks.loadHandlers.clear()
    mocks.contextKeys = []
    mocks.commandHandlers.clear()
    mocks.openDevTools.mockReset()
    mocks.closeDevTools.mockReset()
    mocks.devToolsOpen.clear()
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

  /** The DevTools command registration the pool currently exposes. */
  const devToolsEntry = () => mocks.commandHandlers.get('app.devtools.toggle')

  it('inspects the visible MiniApp pane instead of the host window', () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
    mocks.currentMiniAppId = 'alpha'
    mocks.tabs = [{ id: 't1', url: '/app/mini-app/alpha' }]
    mocks.activeTabId = 't1'

    render(<MiniAppTabsPool />)

    expect(devToolsEntry()?.enabled).toBe(true)
    act(() => devToolsEntry()!.handler())
    expect(mocks.openDevTools).toHaveBeenCalledWith('alpha')
  })

  it('closes the MiniApp console on a second invocation', () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha')]
    mocks.currentMiniAppId = 'alpha'
    mocks.tabs = [{ id: 't1', url: '/app/mini-app/alpha' }]
    mocks.activeTabId = 't1'

    render(<MiniAppTabsPool />)

    // The command is a toggle: opening only would leave the guest console stuck open.
    act(() => devToolsEntry()!.handler())
    act(() => devToolsEntry()!.handler())

    expect(mocks.openDevTools).toHaveBeenCalledTimes(1)
    expect(mocks.closeDevTools).toHaveBeenCalledWith('alpha')
  })

  it('hands the shortcut back to the host when no MiniApp pane is on screen', () => {
    // Pooled but hidden: the guest still owns Electron's focused WebContents, which is
    // exactly why the shortcut used to open the MiniApp console from unrelated tabs.
    mocks.openedKeepAliveMiniApps = [stubApp('alpha')]
    mocks.currentMiniAppId = 'alpha'
    mocks.tabs = [
      { id: 't1', url: '/app/mini-app/alpha' },
      { id: 't2', url: '/app/chat' }
    ]
    mocks.activeTabId = 't2'

    render(<MiniAppTabsPool />)

    // Disabled, so CommandProvider's findLast falls through to the AppShell handler.
    expect(devToolsEntry()?.enabled).toBe(false)
  })

  it('inspects the focused pane while the split shows two MiniApps', () => {
    mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
    mocks.currentMiniAppId = 'alpha'
    mocks.splitOpen = true
    mocks.splitMiniAppId = 'bravo'
    mocks.tabs = [{ id: 't1', url: '/app/mini-app/alpha' }]
    mocks.activeTabId = 't1'

    render(<MiniAppTabsPool />)

    act(() => devToolsEntry()!.handler())
    expect(mocks.openDevTools).toHaveBeenLastCalledWith('alpha')

    act(() => {
      mocks.focusHandlers.get('bravo')!('bravo', true)
    })
    act(() => devToolsEntry()!.handler())
    expect(mocks.openDevTools).toHaveBeenLastCalledWith('bravo')
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

  describe('pane visibility reports', () => {
    const localApp = (id: string): MiniApp => ({
      kind: 'app',
      appId: id,
      name: id,
      url: `cherry-miniapp://${id}/index.html`,
      presetMiniAppId: null,
      status: 'enabled',
      orderKey: 'a0',
      version: '1.0.0',
      nameI18n: { en: id },
      aiModelId: null,
      aiQuickModelId: null
    })
    const reports = () =>
      ipc.request.mock.calls
        .filter((c: unknown[]) => c[0] === 'mini_app.runtime.set_visible')
        .map((c: unknown[]) => c[1])

    it('tells main when a local app pane is shown or hidden, once per change', () => {
      // The bug this guards: `app.visibilityChange` documented and subscribed to, with
      // nothing in the host ever producing it — a guest cannot see `display: none`.
      mocks.openedKeepAliveMiniApps = [localApp('alpha'), localApp('bravo')]
      mocks.currentMiniAppId = 'alpha'
      mocks.tabs = [
        { id: 'alpha-tab', url: '/app/mini-app/alpha' },
        { id: 'bravo-tab', url: '/app/mini-app/bravo' }
      ]
      mocks.activeTabId = 'alpha-tab'
      const { rerender } = render(<MiniAppTabsPool />)
      expect(reports()).toEqual(
        expect.arrayContaining([
          { appId: 'alpha', visible: true },
          { appId: 'bravo', visible: false }
        ])
      )

      ipc.request.mockClear()
      mocks.currentMiniAppId = 'bravo'
      mocks.activeTabId = 'bravo-tab'
      rerender(<MiniAppTabsPool />)
      expect(reports()).toEqual(
        expect.arrayContaining([
          { appId: 'alpha', visible: false },
          { appId: 'bravo', visible: true }
        ])
      )

      ipc.request.mockClear()
      rerender(<MiniAppTabsPool />)
      expect(reports()).toEqual([])
    })

    it('hides and reports a pane whose webview attaches after the user moved on', () => {
      // The bug this guards: the visibility effect runs on dependency changes only. A
      // local app's <webview> mounts once `runtime.prepare` resolves; if the user switched
      // away meanwhile, nothing changes again and the new pane stays shown — and main,
      // never told otherwise, treats the guest as visible for `clipboard.read` and friends.
      mocks.openedKeepAliveMiniApps = [localApp('alpha'), localApp('bravo')]
      mocks.tabs = [
        { id: 'alpha-tab', url: '/app/mini-app/alpha' },
        { id: 'bravo-tab', url: '/app/mini-app/bravo' }
      ]
      mocks.currentMiniAppId = 'alpha'
      mocks.activeTabId = 'alpha-tab'
      mocks.deferAttach.add('alpha')
      try {
        const { rerender } = render(<MiniAppTabsPool />)
        mocks.currentMiniAppId = 'bravo'
        mocks.activeTabId = 'bravo-tab'
        rerender(<MiniAppTabsPool />)
        ipc.request.mockClear()

        act(() => mocks.pendingAttach.get('alpha')!())

        expect(screen.getByTestId('webview-alpha').style.display).toBe('none')
        expect(reports()).toEqual([{ appId: 'alpha', visible: false }])
      } finally {
        mocks.deferAttach.clear()
        mocks.pendingAttach.clear()
      }
    })

    it('reports nothing for site webviews, which have no guest bridge to tell', () => {
      mocks.openedKeepAliveMiniApps = [stubApp('alpha')]
      mocks.currentMiniAppId = 'alpha'
      mocks.tabs = [{ id: 'alpha-tab', url: '/app/mini-app/alpha' }]
      mocks.activeTabId = 'alpha-tab'
      render(<MiniAppTabsPool />)

      expect(reports()).toEqual([])
    })
  })

  describe('host-initiated eviction', () => {
    it('drops the evicted app from the pool', () => {
      // The bug this guards: shipping only the broadcast. With no consumer the host
      // waits out its timeout and turns an ordinary update into a hard kill.
      mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
      // Every pooled app needs a tab: the pool evicts unreferenced entries on its own.
      mocks.tabs = [
        { id: 'alpha-tab', url: '/app/mini-app/alpha' },
        { id: 'bravo-tab', url: '/app/mini-app/bravo' }
      ]
      const { container, rerender } = render(<MiniAppTabsPool />)

      emitIpc('mini_app.runtime.evicted', { appId: 'alpha' })

      // Asserts the RESOLVED list, not the argument: the implementation passes an
      // updater, so `toHaveBeenCalledWith([...])` would compare against a function.
      expect(mocks.openedKeepAliveMiniApps.map((a) => a.appId)).toEqual(['bravo'])
      expect(mocks.clearWebviewState).toHaveBeenCalledWith('alpha')
      // The `useMiniApps` stand-in is not reactive: rerender to see the pool react.
      rerender(<MiniAppTabsPool />)
      expect(renderedAppIds(container)).toEqual(['bravo'])
    })

    it('ignores an eviction for an app it is not showing', () => {
      mocks.openedKeepAliveMiniApps = [stubApp('alpha')]
      mocks.tabs = [{ id: 'alpha-tab', url: '/app/mini-app/alpha' }]
      render(<MiniAppTabsPool />)

      emitIpc('mini_app.runtime.evicted', { appId: 'charlie' })

      expect(mocks.clearWebviewState).not.toHaveBeenCalledWith('charlie')
    })

    it('closes the active tab so the launcher can reopen the evicted app', () => {
      // Nothing re-adds an evicted app while its tab stays active: MiniAppPage only
      // opens on tab/app changes, and clear-data/reset change neither. Without the
      // close the pane stays blank until the user happens to switch tabs.
      mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
      mocks.currentMiniAppId = 'alpha'
      mocks.tabs = [
        { id: 'alpha-tab', url: '/app/mini-app/alpha' },
        { id: 'bravo-tab', url: '/app/mini-app/bravo' }
      ]
      mocks.activeTabId = 'alpha-tab'
      const { container, rerender } = render(<MiniAppTabsPool />)

      emitIpc('mini_app.runtime.evicted', { appId: 'alpha' })

      expect(mocks.closeTab).toHaveBeenCalledTimes(1)
      expect(mocks.closeTab).toHaveBeenCalledWith('alpha-tab')
      // The mocked hook is not reactive: rerender to observe the updated pool list.
      rerender(<MiniAppTabsPool />)
      expect(renderedAppIds(container)).toEqual(['bravo'])

      // The user reopens from the launcher: a fresh tab plus a fresh pool entry, and
      // the launcher (useMiniAppPopup) makes the reopened app current again.
      mocks.openedKeepAliveMiniApps = [stubApp('bravo'), stubApp('alpha')]
      mocks.currentMiniAppId = 'alpha'
      mocks.tabs = [
        { id: 'bravo-tab', url: '/app/mini-app/bravo' },
        { id: 'alpha-tab-2', url: '/app/mini-app/alpha' }
      ]
      mocks.activeTabId = 'alpha-tab-2'
      rerender(<MiniAppTabsPool />)

      expect(webviewOf(container, 'alpha').style.display).toBe('inline-flex')
    })

    it('leaves a background tab open when its app is evicted', () => {
      // Switching back re-activates MiniAppPage, which re-adds the app itself, so
      // only the pool entry goes; closing the tab would throw away the user's place.
      mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
      mocks.currentMiniAppId = 'alpha'
      mocks.tabs = [
        { id: 'alpha-tab', url: '/app/mini-app/alpha' },
        { id: 'bravo-tab', url: '/app/mini-app/bravo' }
      ]
      mocks.activeTabId = 'alpha-tab'
      const { container, rerender } = render(<MiniAppTabsPool />)

      emitIpc('mini_app.runtime.evicted', { appId: 'bravo' })

      expect(mocks.closeTab).not.toHaveBeenCalled()
      rerender(<MiniAppTabsPool />)
      expect(renderedAppIds(container)).toEqual(['alpha'])
      expect(mocks.clearWebviewState).toHaveBeenCalledWith('bravo')
    })

    it('closes the split pane when its app is evicted', () => {
      // The split pane owns no tab, so no MiniAppPage re-adds its app: without
      // this the pane keeps its toolbar over an empty webview slot.
      mocks.openedKeepAliveMiniApps = [stubApp('alpha'), stubApp('bravo')]
      mocks.currentMiniAppId = 'alpha'
      mocks.splitOpen = true
      mocks.splitMiniAppId = 'bravo'
      mocks.tabs = [{ id: 'alpha-tab', url: '/app/mini-app/alpha' }]
      mocks.activeTabId = 'alpha-tab'
      render(<MiniAppTabsPool />)

      emitIpc('mini_app.runtime.evicted', { appId: 'bravo' })

      expect(mocks.setSplitMiniAppId).toHaveBeenCalledWith('')
      expect(mocks.setSplitOpen).toHaveBeenCalledWith(false)
      expect(mocks.closeTab).not.toHaveBeenCalled()
    })
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
