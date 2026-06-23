// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

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
  usePersistCache: () => STABLE_PINNED
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
})
