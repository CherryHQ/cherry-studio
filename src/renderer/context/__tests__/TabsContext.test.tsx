// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { TAB_LIMITS } from '@renderer/services/TabLruManager'
import type * as RouteTitle from '@renderer/utils/routeTitle'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let currentLanguage = 'en'

const PINNED_FILES_TAB: Tab = {
  id: 'files',
  type: 'route',
  url: '/app/files',
  title: 'Files',
  lastAccessTime: 0,
  isDormant: false,
  isPinned: true
}

// Stable reference: re-renders are then driven only by the i18n.language change,
// not by a fresh pinnedTabs identity — which is what makes the test catch a dropped
// i18n.language dependency in the tabs useMemo.
const STABLE_PINNED: [Tab[], () => void] = [[PINNED_FILES_TAB], vi.fn()]

// Mutable persisted session for the normal-tabs / active-tab-id keys, set per test before render
// and reset in beforeEach. Accessed lazily inside the mock factory (at render time), so no TDZ.
let mockNormalSession: [Tab[], () => void] = [[], vi.fn()]
let mockActiveSession: [string, () => void] = ['', vi.fn()]

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@renderer/data/hooks/useCache', () => ({
  usePersistCache: (key: string) =>
    key === 'ui.tab.normal_tabs'
      ? mockNormalSession
      : key === 'ui.tab.active_tab_id'
        ? mockActiveSession
        : STABLE_PINNED
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof ReactI18next>()
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: currentLanguage } })
  }
})

vi.mock('@renderer/utils/routeTitle', async () => {
  const actual = await vi.importActual<typeof RouteTitle>('@renderer/utils/routeTitle')
  const titles: Record<string, Record<string, string>> = {
    '/app/agents': { en: 'Agent', zh: '代理' },
    '/app/chat': { en: 'Chat', zh: '聊天' },
    '/app/files': { en: 'Files', zh: '文件' }
  }
  return {
    ...actual,
    getDefaultRouteTitle: (url: string) => titles[url]?.[currentLanguage] ?? url
  }
})

import { TabsProvider, useTabsContext } from '../TabsContext'

function TabTitleWriter() {
  const { tabs, updateTab } = useTabsContext()
  const didUpdateRef = useRef(false)

  useEffect(() => {
    if (didUpdateRef.current) return
    didUpdateRef.current = true
    updateTab('home', { title: 'Session title', icon: 'icon:spark' })
  }, [updateTab])

  return <div data-testid="home-title">{tabs.find((tab) => tab.id === 'home')?.title}</div>
}

function PinnedRouteTitle() {
  const { tabs } = useTabsContext()
  return <div data-testid="files-title">{tabs.find((tab) => tab.id === 'files')?.title}</div>
}

// Surfaces restored session state: active tab id, each tab's awake/dormant state, and the raw id list.
function SessionInspector() {
  const { tabs, activeTabId } = useTabsContext()
  return (
    <div>
      <div data-testid="active">{activeTabId}</div>
      <div data-testid="tabs">{tabs.map((tab) => `${tab.id}:${tab.isDormant ? 'dormant' : 'awake'}`).join(',')}</div>
      <div data-testid="ids">{tabs.map((tab) => tab.id).join(',')}</div>
    </div>
  )
}

// Materializes a pinned tab from "init" the way a detached sub-window re-creates its tab.
function PinnedTabMaterializer() {
  const { tabs, openTab } = useTabsContext()
  const didOpenRef = useRef(false)

  useEffect(() => {
    if (didOpenRef.current) return
    didOpenRef.current = true
    openTab('/app/chat?topicId=t1', { id: 'detached', isPinned: true, forceNew: true })
  }, [openTab])

  return <div data-testid="detached-pinned">{String(tabs.find((tab) => tab.id === 'detached')?.isPinned)}</div>
}

beforeEach(() => {
  currentLanguage = 'en'
  mockNormalSession = [[], vi.fn()]
  mockActiveSession = ['', vi.fn()]
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TabsContext', () => {
  it('preserves page-owned titles for the fixed home conversation tab', async () => {
    render(
      <TabsProvider
        initialDefaultTab={{
          id: 'home',
          type: 'route',
          url: '/app/agents',
          title: '',
          lastAccessTime: Date.now(),
          isDormant: false
        }}
        includePinnedTabs={false}>
        <TabTitleWriter />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('home-title')).toHaveTextContent('Session title'))
  })

  it('refreshes localized route tab titles when the app language changes', async () => {
    // A fresh element each render so React doesn't bail out on referential equality.
    const renderUi = () => (
      <TabsProvider
        initialDefaultTab={{
          id: 'home',
          type: 'route',
          url: '/app/chat',
          title: '',
          lastAccessTime: 0,
          isDormant: false
        }}>
        <PinnedRouteTitle />
      </TabsProvider>
    )
    const { rerender } = render(renderUi())

    await waitFor(() => expect(screen.getByTestId('files-title')).toHaveTextContent('Files'))

    // Switch language and re-render: the tabs useMemo must recompute via its
    // i18n.language dependency so the route-derived title re-localizes.
    currentLanguage = 'zh'
    rerender(renderUi())

    await waitFor(() => expect(screen.getByTestId('files-title')).toHaveTextContent('文件'))
  })

  it('keeps isPinned on a tab materialized in a sub-window so it round-trips on re-attach', async () => {
    render(
      <TabsProvider initialDefaultTab={null} includePinnedTabs={false}>
        <PinnedTabMaterializer />
      </TabsProvider>
    )

    // A detached sub-window has no pinned section, so the tab is shown from the normal
    // list — but it must keep isPinned so Tab_Attach carries the pinned state back…
    await waitFor(() => expect(screen.getByTestId('detached-pinned')).toHaveTextContent('true'))
    // …without ever writing the shared pinned-tabs cache from this window.
    expect(STABLE_PINNED[1]).not.toHaveBeenCalled()
  })

  it('routes an isPinned tab into the persistent pinned list in the main window', async () => {
    render(
      <TabsProvider initialDefaultTab={null}>
        <PinnedTabMaterializer />
      </TabsProvider>
    )

    await waitFor(() => expect(STABLE_PINNED[1]).toHaveBeenCalled())
  })

  it('restores the persisted session and keeps only the active tab awake', async () => {
    const tabA: Tab = { id: 'a', type: 'route', url: '/app/chat', title: '', lastAccessTime: 1, isDormant: false }
    const tabB: Tab = { id: 'b', type: 'route', url: '/app/agents', title: '', lastAccessTime: 2, isDormant: false }
    mockNormalSession = [[tabA, tabB], vi.fn()]
    mockActiveSession = ['b', vi.fn()]

    render(
      <TabsProvider initialDefaultTab={null}>
        <SessionInspector />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('b'))
    // Active tab (b) awake, the other restored tab (a) dormant ⇒ only one TabRouter mounts.
    const dump = screen.getByTestId('tabs').textContent ?? ''
    expect(dump).toContain('a:dormant')
    expect(dump).toContain('b:awake')
  })

  it('keeps the resolved active tab awake when the persisted active id is stale', async () => {
    // Active id points at a tab that no longer exists in either the pinned or normal set. The
    // resolved active tab (first normal tab) must still be awake, or AppShell renders no TabRouter.
    const tabA: Tab = { id: 'a', type: 'route', url: '/app/chat', title: '', lastAccessTime: 1, isDormant: false }
    const tabB: Tab = { id: 'b', type: 'route', url: '/app/agents', title: '', lastAccessTime: 2, isDormant: false }
    mockNormalSession = [[tabA, tabB], vi.fn()]
    mockActiveSession = ['ghost', vi.fn()]

    render(
      <TabsProvider initialDefaultTab={null}>
        <SessionInspector />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('a'))
    expect(screen.getByTestId('tabs').textContent ?? '').toContain('a:awake')
  })

  it('honors a pinned active tab when no unpinned tabs were open', async () => {
    // Last session had zero normal tabs but the active tab was the pinned "files" tab — restore must
    // reselect it (the default tab stays present but dormant) instead of falling back to default.
    mockNormalSession = [[], vi.fn()]
    mockActiveSession = ['files', vi.fn()]

    render(
      <TabsProvider>
        <SessionInspector />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('files'))
    const dump = screen.getByTestId('tabs').textContent ?? ''
    expect(dump).toContain('files:awake')
    expect(dump).toContain('home:dormant')
  })

  it('does not restore a persisted session in a detached sub-window', async () => {
    const tabA: Tab = { id: 'a', type: 'route', url: '/app/chat', title: '', lastAccessTime: 1, isDormant: false }
    mockNormalSession = [[tabA], vi.fn()]
    mockActiveSession = ['a', vi.fn()]

    const freshTab: Tab = {
      id: 'fresh',
      type: 'route',
      url: '/app/chat',
      title: '',
      lastAccessTime: 0,
      isDormant: false
    }
    render(
      <TabsProvider initialDefaultTab={freshTab} includePinnedTabs={false}>
        <SessionInspector />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('fresh'))
    const ids = screen.getByTestId('ids').textContent ?? ''
    expect(ids).not.toContain('a')
  })

  it('caps the restored session to the LRU hard cap, dropping the oldest non-active tabs', async () => {
    const overflow = TAB_LIMITS.hardCap + 5
    // n0 is the OLDEST (lastAccessTime 0) yet is the active tab — it must survive the cap.
    const many: Tab[] = Array.from({ length: overflow }, (_, i) => ({
      id: `n${i}`,
      type: 'route',
      url: '/app/chat',
      title: '',
      lastAccessTime: i,
      isDormant: false
    }))
    mockNormalSession = [many, vi.fn()]
    mockActiveSession = ['n0', vi.fn()]

    render(
      <TabsProvider initialDefaultTab={null}>
        <SessionInspector />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('n0'))
    const ids = (screen.getByTestId('ids').textContent ?? '').split(',').filter((id) => id.startsWith('n'))
    expect(ids).toHaveLength(TAB_LIMITS.hardCap)
    expect(ids).toContain('n0') // active retained despite being oldest
    expect(ids).toContain(`n${overflow - 1}`) // newest retained
    expect(ids).not.toContain('n1') // oldest non-active dropped
  })
})
