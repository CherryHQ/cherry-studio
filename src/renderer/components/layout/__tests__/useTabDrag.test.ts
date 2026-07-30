// @vitest-environment jsdom
import type { Tab } from '@renderer/hooks/tab'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.hoisted(() => vi.fn())
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))

let keepAliveMiniApps: unknown[] = []
vi.mock('@renderer/data/CacheService', () => ({
  cacheService: {
    get: (key: string) => (key === 'mini_app.opened_keep_alive' ? keepAliveMiniApps : undefined)
  }
}))

import { useTabDrag } from '../useTabDrag'

const MINI_APP_TAB: Tab = {
  id: 'tab-openclaw',
  type: 'route',
  url: '/app/mini-app/openclaw-dashboard',
  title: 'OpenClaw',
  lastAccessTime: 0,
  isDormant: false
}

const OPENCLAW_KEEP_ALIVE_ENTRY = {
  appId: 'openclaw-dashboard',
  presetMiniAppId: null,
  status: 'enabled',
  orderKey: '',
  name: 'OpenClaw',
  url: 'http://127.0.0.1:18790#token=secret',
  logo: 'openclaw'
}

/**
 * Drives the pointer sequence that tears a tab out of the bar: press on the tab, then move
 * far below it. Thresholds are compared against the tab bar's rect, which is a zero rect in
 * jsdom — so a large positive clientY reads as "dragged out".
 */
function dragTabOut(tab: Tab) {
  const tabBar = document.createElement('div')
  const tabEl = document.createElement('button')
  tabEl.setPointerCapture = vi.fn()
  document.body.append(tabBar, tabEl)

  const { result } = renderHook(() =>
    useTabDrag({
      pinnedTabs: [],
      normalTabs: [tab],
      canDetach: true,
      reorderTabs: vi.fn(),
      closeTab: vi.fn(),
      setActiveTab: vi.fn()
    })
  )

  act(() => {
    result.current.tabBarRef.current = tabBar
    result.current.tabRefs.current.set(tab.id, tabEl)
    result.current.handlePointerDown(
      {
        button: 0,
        pointerId: 1,
        clientX: 10,
        clientY: 10,
        screenX: 10,
        screenY: 10,
        target: tabEl,
        currentTarget: tabEl
      } as unknown as React.PointerEvent,
      tab,
      'normal'
    )
  })

  act(() => {
    // jsdom has no PointerEvent constructor; a MouseEvent carrying pointerId is what the
    // handler actually reads.
    const move = new MouseEvent('pointermove', { clientX: 20, clientY: 400, screenX: 500, screenY: 400 })
    Object.defineProperty(move, 'pointerId', { value: 1 })
    document.dispatchEvent(move)
  })
}

beforeEach(() => {
  keepAliveMiniApps = []
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('useTabDrag detach', () => {
  // Regression: the tab bar has two detach paths — the context menu (TabsContext.detachTab)
  // and this drag tear-off. Both must send the transient mini-app descriptor, or the torn-off
  // window has no way to resolve `/app/mini-app/<id>` and renders "app not found".
  it('carries the transient mini-app descriptor when a mini-app tab is torn off', () => {
    keepAliveMiniApps = [OPENCLAW_KEEP_ALIVE_ENTRY]

    dragTabOut(MINI_APP_TAB)

    expect(requestMock).toHaveBeenCalledWith('tab.detach', expect.objectContaining({ miniApp: expect.anything() }))
    const payload = requestMock.mock.calls[0][1]
    expect(payload).toMatchObject({
      url: '/app/mini-app/openclaw-dashboard',
      miniApp: {
        appId: 'openclaw-dashboard',
        name: 'OpenClaw',
        url: 'http://127.0.0.1:18790#token=secret',
        logo: 'openclaw'
      }
    })
  })

  it('omits the descriptor for an ordinary tab', () => {
    dragTabOut({ ...MINI_APP_TAB, id: 'tab-chat', url: '/app/chat', title: 'Chat' })

    expect(requestMock).toHaveBeenCalledWith('tab.detach', expect.anything())
    expect(requestMock.mock.calls[0][1]).not.toHaveProperty('miniApp')
  })
})
