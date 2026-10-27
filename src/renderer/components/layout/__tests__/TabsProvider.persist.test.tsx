// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CacheService } from '@renderer/data/CacheService'
import type { TabsContextValue } from '@renderer/hooks/tab'
import type { CacheSyncMessage } from '@shared/data/cache/cacheTypes'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

vi.unmock('@data/CacheService')
vi.unmock('@renderer/data/CacheService')
vi.unmock('@data/hooks/useCache')
vi.unmock('@renderer/data/hooks/useCache')
vi.mock('@renderer/components/AgentBrowserRuntimeHost', () => ({ AgentBrowserRuntimeHost: () => null }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() }, useIpcOn: vi.fn() }))
vi.mock('@renderer/hooks/useWindowInitData', () => ({ useWindowInitData: () => null }))

const key = 'ui.tab.pinned_tabs'
const pin = (id = 'pin', extra: Record<string, unknown> = {}): Tab => ({
  id,
  type: 'route',
  url: '/unknown',
  title: '',
  isPinned: true,
  ...extra
})
const home: Tab = { id: 'home', type: 'route', url: '/app/chat', title: '' }
let service: CacheService
let context: TabsContextValue
let receive: (message: CacheSyncMessage) => void
const broadcast = vi.fn()
let disposables: (() => void)[] = []

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  broadcast.mockClear()
  localStorage.clear()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      cache: {
        broadcastSync: broadcast,
        onSync: (listener: typeof receive) => {
          receive = listener
          return vi.fn()
        },
        getAllShared: async () => ({})
      }
    }
  })
})
afterEach(() => {
  cleanup()
  disposables.forEach((dispose) => dispose())
  disposables = []
  service?.cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function mount(
  raw: unknown,
  normals: Tab[] = [],
  active = 'home',
  detached = false,
  feedback = false,
  onMount?: () => void
) {
  localStorage.setItem(
    'cs_cache_persist',
    JSON.stringify({
      [key]: raw,
      'ui.tab.normal_tabs': normals,
      'ui.tab.active_tab_id': active,
      'ui.sidebar.width': 321
    })
  )
  service = (await import('@renderer/data/CacheService')).cacheService
  const { TabsProvider } = await import('../TabsProvider')
  const { useTabsContext } = await import('@renderer/hooks/tab')
  const { usePersistCache } = await import('@renderer/data/hooks/useCache')
  function ReadTabs() {
    context = useTabsContext()
    const [pins, setPins] = usePersistCache(key)
    useEffect(() => {
      onMount?.()
    }, [])
    useEffect(() => {
      if (feedback && Array.isArray(pins) && pins[0]?.isPinned) {
        setPins(pins.map((tab) => ({ ...tab, isPinned: false, title: tab.title === 'a' ? 'b' : 'a' })))
      }
    }, [pins, setPins])
    return <output>{context.tabs.map((tab) => tab.id).join(',')}</output>
  }
  return render(
    <TabsProvider initialDefaultTab={home} includePinnedTabs={!detached}>
      <ReadTabs />
    </TabsProvider>
  )
}

// These cases catch unsafe render-time consumption, destructive repair, and repeated writeback.
describe('pinned persistence with the real store and hook', () => {
  it('repairs non-array envelopes before render and reaches a fixed point', async () => {
    await mount(null)
    expect(screen.getByRole('status').textContent).toBe('home')
    const notified = vi.fn()
    disposables.push(service.subscribe(key, notified))
    for (const raw of [false, true, 0, 1, '', 'bad', {}]) {
      await act(async () => {
        receive({ type: 'persist', key, value: raw })
      })
      expect(service.getPersist(key)).toEqual([])
      expect(context.tabs.map((tab) => tab.id)).toEqual(['home'])
    }
    const snapshot = service.getPersist(key)
    notified.mockClear()
    await act(async () => {
      receive({ type: 'persist', key, value: [] })
    })
    expect(service.getPersist(key)).toBe(snapshot)
    expect(notified).not.toHaveBeenCalled()
  })

  it('retains healthy siblings in order while repairing every entry field immutably', async () => {
    const raw = [
      null,
      false,
      3,
      'x',
      [],
      {},
      pin('', {}),
      pin(' ', {}),
      pin('bad-type', { type: 'other' }),
      pin('no-type', { type: undefined }),
      pin('no-id', { id: 5 }),
      pin('no-url', { url: undefined }),
      pin('bad-url', { url: 'http://[' }),
      pin('blank-url', { url: '  ' }),
      pin('num-url', { url: 9 }),
      pin('library', { url: '/app/library' }),
      pin('temp', { metadata: { transientMiniApp: true } }),
      pin('a'),
      pin('b', {
        title: null,
        isPinned: false,
        isDormant: 'no',
        lastAccessTime: Infinity,
        icon: 1,
        metadata: [],
        savedState: { scrollPosition: 'bad', keep: 1 },
        extra: 2
      }),
      pin('a'),
      pin('normal'),
      pin('c', { savedState: null, metadata: null }),
      pin('d', { isPinned: 'yes', lastAccessTime: NaN, savedState: { scrollPosition: Infinity } }),
      pin('e', { title: undefined, isPinned: undefined, lastAccessTime: 'now', icon: null }),
      pin('web', { type: 'webview', metadata: { entity: 'kept' }, savedState: { scrollPosition: 5 } })
    ]
    await mount(raw, [{ ...home }, pin('normal', { isPinned: false })])
    const { repairPinnedTabs } = await import('../TabsProvider')
    const original = structuredClone(raw)
    const repaired = repairPinnedTabs(raw, [pin('normal')])
    expect(repaired.tabs.map((tab) => tab.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'web'])
    expect(repaired.tabs[0]).not.toHaveProperty('isDormant')
    expect(repaired.tabs[1]).toEqual(pin('b', { title: 'unknown', isDormant: true, savedState: { keep: 1 }, extra: 2 }))
    expect(repaired.tabs[2]).toEqual(pin('c'))
    expect(repaired.tabs[3]).toEqual(pin('d', { savedState: {} }))
    expect(repaired.tabs[4]).toEqual(pin('e', { title: 'unknown' }))
    expect(repaired.tabs[5]).toEqual(
      pin('web', { type: 'webview', metadata: { entity: 'kept' }, savedState: { scrollPosition: 5 } })
    )
    expect(raw).toEqual(original)
    expect(repairPinnedTabs(repaired.tabs, [pin('normal')])).toEqual({ tabs: repaired.tabs, changed: false })
    expect(repairPinnedTabs(undefined, [])).toEqual({ tabs: [], changed: false })
    expect(context.tabs.map((tab) => tab.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'web', 'home', 'normal'])
    const notified = vi.fn()
    disposables.push(service.subscribe(key, notified))
    const snapshot = service.getPersist(key)
    await act(async () => {
      receive({ type: 'persist', key, value: structuredClone(snapshot) })
    })
    expect(service.getPersist(key)).toBe(snapshot)
    expect(notified).not.toHaveBeenCalled()
  })

  it('restores pinned home once and keeps distinct ids with the same URL', async () => {
    await mount([
      pin('home', { url: '/app/chat' }),
      pin('code-a', { url: '/app/code' }),
      pin('code-b', { url: '/app/code' })
    ])
    expect(context.tabs.map((tab) => tab.id)).toEqual(['home', 'code-a', 'code-b'])
    expect(context.activeTabId).toBe('home')
    expect(context.tabs.filter((tab) => !tab.isDormant).map((tab) => tab.id)).toEqual(['home'])
    expect(service.getPersist('ui.tab.normal_tabs')).toEqual([])
  })

  it('does not originate pinned writes or broadcasts from a detached provider', async () => {
    const view = await mount({ broken: true }, [], '', true)
    const write = vi.spyOn(service, 'setPersist')
    await act(async () => {
      context.reorderTabs('pinned', 0, 1)
      context.pinTab('home')
      context.unpinTab('home')
      context.openTab('/unknown', { isPinned: true })
    })
    view.rerender(<span>done</span>)
    expect(service.getPersist(key)).toEqual({ broken: true })
    expect(write.mock.calls.filter(([writtenKey]) => writtenKey === key)).toEqual([])
    expect(broadcast.mock.calls.filter(([message]) => message.key === key)).toEqual([])
  })

  it('preserves pins across pin/unpin batches with temporarily stale normals', async () => {
    await mount([])
    await act(async () => {
      context.pinTab('home')
      context.unpinTab('home')
      context.pinTab('home')
    })
    expect(service.getPersist(key).map((tab) => tab.id)).toEqual(['home'])
    expect(service.getPersist('ui.tab.normal_tabs')).toEqual([])
    await act(async () => {
      context.unpinTab('home')
    })
    expect(service.getPersist(key)).toEqual([])
    expect(context.tabs.map((tab) => tab.id)).toEqual(['home'])
  })

  it('contains automatic feedback across async turns, rejects stale work, and permits recovery', async () => {
    await mount([pin()])
    const { loggerService } = await import('@logger')
    const logger = loggerService.withContext('TabsProvider')
    const warning = vi.spyOn(logger, 'warn')
    const error = vi.spyOn(loggerService.withContext('CacheService'), 'error')
    const seen: Tab[][] = []
    disposables.push(
      service.subscribe(key, () => {
        seen.push(structuredClone(service.getPersist(key)))
      })
    )
    // A foreign source disagrees with ownership on each asynchronous turn. Only provider repairs count.
    for (let turn = 0; turn < 8; turn += 1) {
      await act(async () => {
        await Promise.resolve()
        receive({ type: 'persist', key, value: [pin('pin', { isPinned: false, title: String(turn % 2) })] })
      })
    }
    expect(service.getPersist(key)).toEqual([])
    expect(warning).toHaveBeenCalledTimes(1)
    expect(warning).toHaveBeenCalledWith('Pinned cache recovery', {
      key,
      reason: 'automatic feedback budget exhausted',
      count: 8
    })
    expect(error).not.toHaveBeenCalled()
    expect(seen.filter((tabs) => tabs.length && tabs[0].isPinned === true)).toHaveLength(7)
    expect(context.tabs.map((tab) => tab.id)).toEqual(['home'])
    await act(async () => {
      await Promise.resolve()
    })
    expect(service.getPersist(key)).toEqual([])
    expect(service.getPersist('ui.sidebar.width')).toBe(321)
    await act(async () => {
      context.pinTab('home')
    })
    expect(service.getPersist(key).map((tab) => tab.id)).toEqual(['home'])
    expect(warning).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(350)
    })
    expect(JSON.parse(localStorage.getItem('cs_cache_persist')!)['ui.sidebar.width']).toBe(321)
  })

  it('uses the latest value when a child writes before mount restoration', async () => {
    await mount([pin('old')], [], 'old', false, false, () => {
      service.setPersist(key, [pin('old'), pin('intervening')])
    })
    expect(service.getPersist(key).map((tab) => tab.id)).toEqual(['old', 'intervening'])
    expect(context.tabs.filter((tab) => !tab.isDormant).map((tab) => tab.id)).toEqual(['old'])
  })

  it('wakes the surviving normal when feedback rejects the active pin', async () => {
    await mount([pin()], [{ ...home, isDormant: true }], 'pin', false, true)
    expect(service.getPersist(key)).toEqual([])
    expect(context.activeTabId).toBe('home')
    expect(context.activeTab?.isDormant).toBe(false)
    expect(context.tabs).toContainEqual(context.activeTab)
    expect(screen.getByRole('status').textContent).toBe('home')
    expect(service.getPersist('ui.tab.normal_tabs')).toEqual([{ ...home, isDormant: false }])
  })

  it('creates an awake launchpad when feedback rejects the only tab', async () => {
    await mount([pin('home')], [], 'home', false, true)
    expect(service.getPersist(key)).toEqual([])
    expect(context.tabs).toHaveLength(1)
    expect(context.activeTab).toMatchObject({ url: '/app/launchpad', isDormant: false })
    expect(context.activeTabId).toBe(context.tabs[0].id)
    expect(screen.getByRole('status').textContent).toBe(context.activeTabId)
    expect(service.getPersist('ui.tab.normal_tabs')).toEqual([context.activeTab])
    expect(service.getPersist('ui.tab.normal_tabs').some((tab) => tab.id === 'home')).toBe(false)
  })

  it('rejects delayed ingress in the store before accepting a new pin command', async () => {
    await mount([pin()], [], 'pin')
    for (let turn = 0; turn < 8; turn += 1) {
      await act(async () => {
        receive({ type: 'persist', key, value: [pin('pin', { isPinned: false, title: String(turn % 2) })] })
      })
    }
    expect(service.getPersist(key)).toEqual([])
    const seen: Tab[][] = []
    disposables.push(service.subscribe(key, () => seen.push(service.getPersist(key))))
    await act(async () => {
      receive({ type: 'persist', key, value: [pin('stale')] })
    })
    expect(service.getPersist(key)).toEqual([])
    expect(seen).toEqual([[pin('stale')], []])
    expect(service.getPersist('ui.tab.normal_tabs').some((tab) => tab.id === 'stale')).toBe(false)
    await act(async () => {
      context.pinTab('home')
    })
    expect(service.getPersist(key)).toEqual([expect.objectContaining({ id: 'home', isPinned: true })])
    expect(context.tabs.some((tab) => tab.id === 'stale')).toBe(false)
    await act(async () => {
      vi.advanceTimersByTime(350)
    })
    const stored = JSON.parse(localStorage.getItem('cs_cache_persist')!)
    expect(stored[key].map((tab: Tab) => tab.id)).toEqual(['home'])
    expect(stored['ui.tab.normal_tabs'].some((tab: Tab) => tab.id === 'stale')).toBe(false)
    await act(async () => {
      context.unpinTab('home')
    })
    expect(service.getPersist(key)).toEqual([])
    await act(async () => {
      context.openTab('/unknown', { id: 'fresh', forceNew: true, isPinned: true })
    })
    expect(service.getPersist(key)).toEqual([expect.objectContaining({ id: 'fresh', isPinned: true })])
    await act(async () => {
      context.closeTabs(['fresh'])
    })
    expect(service.getPersist(key)).toEqual([])
    expect(context.tabs.map((tab) => tab.id)).toEqual(['home'])
  })

  it('bounds twelve alternating automatic title updates across async turns', async () => {
    await mount([pin()], [], 'pin')
    const { loggerService } = await import('@logger')
    const warning = vi.spyOn(loggerService.withContext('TabsProvider'), 'warn')
    for (let turn = 0; turn < 12; turn += 1) {
      await act(async () => {
        await Promise.resolve()
        context.updateTab('pin', { title: String(turn % 2) })
      })
    }
    expect(service.getPersist(key)).toEqual([])
    expect(context.tabs.some((tab) => tab.id === 'pin')).toBe(false)
    expect(context.activeTab?.isDormant).toBe(false)
    expect(warning).toHaveBeenCalledExactlyOnceWith('Pinned cache recovery', {
      key,
      reason: 'automatic feedback budget exhausted',
      count: 8
    })
  })

  it('contains an alternating effect source without a React subscriber failure', async () => {
    await mount([pin()], [], 'home', false, true)
    expect(service.getPersist(key)).toEqual([])
    expect(context.tabs.map((tab) => tab.id)).toEqual(['home'])
    expect(broadcast.mock.calls.filter(([message]) => message.key === key).at(-1)?.[0].value).toEqual([])
    expect(service.getPersist('ui.sidebar.width')).toBe(321)
  })

  it('contains a synchronous subscriber source and broadcasts only the final fallback', async () => {
    await mount([pin()])
    let revisions = 0
    disposables.push(
      service.subscribe(key, () => {
        const pins = service.getPersist(key)
        if (pins[0]?.isPinned) {
          revisions += 1
          service.setPersist(
            key,
            pins.map((tab) => ({ ...tab, isPinned: false, title: String(revisions % 2) }))
          )
        }
      })
    )
    await act(async () => {
      service.setPersist(key, [pin('pin', { isPinned: false })])
    })
    expect(revisions).toBe(7)
    expect(service.getPersist(key)).toEqual([])
    expect(broadcast.mock.calls.filter(([message]) => message.key === key).at(-1)?.[0].value).toEqual([])
    expect(context.tabs.map((tab) => tab.id)).toEqual(['home'])
  })

  it('allows more than eight independent pinned additions', async () => {
    await mount([])
    for (let index = 0; index < 12; index += 1) {
      await act(async () => {
        context.openTab('/unknown', { id: `intent-${index}`, forceNew: true, isPinned: true })
      })
    }
    expect(service.getPersist(key)).toHaveLength(12)
    expect(context.tabs.filter((tab) => tab.isPinned)).toHaveLength(12)
  })
})
