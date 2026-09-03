// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { TAB_LIMITS } from '@renderer/services/TabLruManager'
import type * as RouteTitle from '@renderer/utils/routeTitle'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, useRef } from 'react'
import type * as ReactI18next from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let currentLanguage = 'en'
let navigationLayout: 'sidebar' | 'tabs' | 'both' = 'tabs'
const sidebarMocks = vi.hoisted(() => ({
  ensureFavoritesPinned: vi.fn(),
  favorites: [
    { type: 'app' as const, id: 'assistants' as const },
    { type: 'app' as const, id: 'agents' as const },
    { type: 'app' as const, id: 'files' as const }
  ] as SidebarFavoriteItem[]
}))

const PINNED_FILES_TAB: Tab = {
  id: 'files',
  type: 'route',
  url: '/app/files',
  title: 'Files',
  lastAccessTime: 0,
  isDormant: false,
  isPinned: true
}

const LEGACY_LIBRARY_PINNED_TAB: Tab = {
  id: 'library',
  type: 'route',
  url: '/app/library?resourceType=assistant',
  title: 'Library',
  lastAccessTime: 0,
  isDormant: false,
  isPinned: true
}

const PINNED_OPENCLAW_TAB: Tab = {
  id: 'openclaw',
  type: 'route',
  url: '/app/openclaw',
  title: 'OpenClaw',
  lastAccessTime: 0,
  isDormant: false,
  isPinned: true
}

const PINNED_CODE_TAB: Tab = {
  id: 'code',
  type: 'route',
  url: '/app/code',
  title: 'Code',
  lastAccessTime: 0,
  isDormant: false,
  isPinned: true
}

const HOME_TAB: Tab = {
  id: 'home',
  type: 'route',
  url: '/app/chat',
  title: '',
  lastAccessTime: 0,
  isDormant: false
}

// Stable reference: re-renders are then driven only by the i18n.language change,
// not by a fresh pinnedTabs identity — which is what makes the test catch a dropped
// i18n.language dependency in the tabs useMemo.
let pinnedTabsValue: Tab[] = [PINNED_FILES_TAB]
const setPinnedTabsMock = vi.fn()

// Restore-session keys (normal tabs + active id). Default to empty (fresh launch); individual
// restore tests set them before render. Kept separate from the pinned tuple so the mock returns the
// right value per key — a key-agnostic mock would feed the restore logic the pinned array.
let normalTabsValue: Tab[] = []
const setNormalTabsMock = vi.fn()
let activeTabIdValue = ''
const setActiveTabIdMock = vi.fn()

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
  usePersistCache: (key: string) => {
    if (key === 'ui.tab.normal_tabs') return [normalTabsValue, setNormalTabsMock]
    if (key === 'ui.tab.active_tab_id') return [activeTabIdValue, setActiveTabIdMock]
    return [pinnedTabsValue, setPinnedTabsMock]
  }
}))

vi.mock('@renderer/data/hooks/usePreference', () => ({
  usePreference: () => [navigationLayout, vi.fn()]
}))

vi.mock('@renderer/hooks/useSidebarFavorites', () => ({
  useSidebarFavorites: () => ({
    favorites: sidebarMocks.favorites,
    ensureFavoritesPinned: sidebarMocks.ensureFavoritesPinned
  })
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
    '/app/files': { en: 'Files', zh: '文件' },
    '/app/launchpad': { en: 'Launchpad', zh: '启动台' }
  }
  return {
    ...actual,
    getDefaultRouteTitle: (url: string) => titles[url]?.[currentLanguage] ?? url
  }
})

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() },
  useIpcOn: vi.fn()
}))

import { useCloseConversationTabs, useTabsContext } from '@renderer/hooks/tab'

import { migratePinnedTabs, TabsProvider } from '../TabsProvider'

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

function TabIds() {
  const { tabs } = useTabsContext()
  return <div data-testid="tab-ids">{tabs.map((tab) => tab.id).join(',')}</div>
}

const conversationTabActionRender = vi.fn()

function ConversationTabMutationControls() {
  const { activeTabId, addTab, closeTab, setActiveTab, tabs, updateTab } = useTabsContext()

  return (
    <>
      <button
        type="button"
        onClick={() => {
          addTab({
            id: 'topic-a-tab',
            type: 'route',
            url: '/app/chat?topicId=topic-a',
            title: 'Topic A',
            lastAccessTime: 0,
            isDormant: false
          })
          addTab({
            id: 'unrelated-tab',
            type: 'route',
            url: '/app/files',
            title: 'Files',
            lastAccessTime: 0,
            isDormant: false
          })
        }}>
        Seed tabs
      </button>
      <button type="button" onClick={() => setActiveTab('home')}>
        Activate home
      </button>
      <button
        type="button"
        onClick={() => updateTab('topic-a-tab', { title: 'Renamed Topic', metadata: { test: true } })}>
        Rename background topic
      </button>
      <button type="button" onClick={() => closeTab('unrelated-tab')}>
        Close unrelated tab
      </button>
      <div data-testid="conversation-tab-active">{activeTabId}</div>
      <div data-testid="conversation-tab-snapshot">{tabs.map((tab) => `${tab.id}:${tab.title}`).join(',')}</div>
    </>
  )
}

function ConversationTabActionProbe() {
  conversationTabActionRender()
  const closeConversationTabs = useCloseConversationTabs()

  return (
    <button type="button" onClick={() => closeConversationTabs('assistants', ['topic-a'])}>
      Close background topic
    </button>
  )
}

// Surfaces restored-session state: active tab id, each tab's awake/dormant state, and the id list.
function SessionInspector() {
  const { tabs, activeTabId } = useTabsContext()
  return (
    <div>
      <div data-testid="active">{activeTabId}</div>
      <div data-testid="session-tabs">
        {tabs.map((tab) => `${tab.id}:${tab.isDormant ? 'dormant' : 'awake'}`).join(',')}
      </div>
      <div data-testid="session-ids">{tabs.map((tab) => tab.id).join(',')}</div>
      <div data-testid="session-urls">{tabs.map((tab) => `${tab.id}=${tab.url}`).join(',')}</div>
    </div>
  )
}

function BatchCloseControls() {
  const { activeTabId, addTab, closeTabs, setActiveTab, tabs, updateTab } = useTabsContext()

  return (
    <>
      <button
        type="button"
        onClick={() => {
          for (const id of ['b', 'c', 'd']) {
            addTab({
              id,
              type: 'route',
              url: `/app/chat?topicId=${id}`,
              title: id.toUpperCase(),
              lastAccessTime: 0,
              isDormant: false
            })
          }
        }}>
        Seed tabs
      </button>
      <button type="button" onClick={() => setActiveTab('c')}>
        Activate C
      </button>
      <button type="button" onClick={() => setActiveTab('home')}>
        Activate Home
      </button>
      <button type="button" onClick={() => setActiveTab('d')}>
        Activate D
      </button>
      <button type="button" onClick={() => closeTabs(['b', 'c'])}>
        Close B and C
      </button>
      <button type="button" onClick={() => closeTabs(['home', 'b', 'd'], 'c')}>
        Close others around C
      </button>
      <button type="button" onClick={() => updateTab('c', { isDormant: true })}>
        Hibernate C
      </button>
      <button type="button" onClick={() => closeTabs(['b', 'c'], 'c')}>
        Close B and C keeping C
      </button>
      <button type="button" onClick={() => closeTabs(['d'])}>
        Close D
      </button>
      <button type="button" onClick={() => closeTabs(['home', 'b', 'c', 'd'], 'files')}>
        Close all normals to Files
      </button>
      <div data-testid="active-tab-id">{activeTabId}</div>
      <div data-testid="tab-ids">{tabs.map((tab) => tab.id).join(',')}</div>
      <div data-testid="dormant-ids">
        {tabs
          .filter((tab) => tab.isDormant)
          .map((tab) => tab.id)
          .join(',')}
      </div>
    </>
  )
}

function TabSnapshot() {
  const { activeTabId, tabs } = useTabsContext()
  return (
    <div>
      <div data-testid="tab-ids">{tabs.map((tab) => tab.id).join(',')}</div>
      <div data-testid="tab-urls">{tabs.map((tab) => tab.url).join(',')}</div>
      <div data-testid="tab-titles">{tabs.map((tab) => tab.title).join(',')}</div>
      <div data-testid="active-tab-id">{activeTabId}</div>
    </div>
  )
}

function WorkspaceControls() {
  const {
    activateWorkspace,
    activeTabId,
    closeTab,
    closeFocusedRoute,
    closeWorkspace,
    navigationLayout,
    openRoute,
    setActiveTab,
    tabBarTabs,
    tabs,
    updateTab
  } = useTabsContext()

  return (
    <div>
      <button type="button" onClick={() => openRoute('/app/chat?topicId=second', { forceNew: true })}>
        Open second chat
      </button>
      <button type="button" onClick={() => openRoute('/settings/appearance')}>
        Open settings
      </button>
      <button type="button" onClick={() => openRoute('/app/release-notes')}>
        Open release notes
      </button>
      <button type="button" onClick={() => openRoute('/app/notes')}>
        Open notes
      </button>
      <button type="button" onClick={() => setActiveTab('home')}>
        Activate home workspace
      </button>
      <button type="button" onClick={() => updateTab(activeTabId, { url: '/app/agents' })}>
        Rewrite active route
      </button>
      <button type="button" onClick={closeFocusedRoute}>
        Close focused
      </button>
      <button type="button" onClick={() => activateWorkspace('launchpad', '/app/launchpad')}>
        Open launchpad
      </button>
      <button type="button" onClick={() => closeWorkspace('app:assistants')}>
        Close chat workspace
      </button>
      <button type="button" onClick={() => closeTab(activeTabId)}>
        Close active tab
      </button>
      <div data-testid="workspace-layout">{navigationLayout}</div>
      <div data-testid="workspace-active">{activeTabId}</div>
      <div data-testid="workspace-tabs">
        {tabs.map((tab) => `${tab.id}:${tab.workspaceKey ?? 'focused'}:${tab.url}`).join(',')}
      </div>
      <div data-testid="tab-bar-tabs">{tabBarTabs.map((tab) => tab.id).join(',')}</div>
    </div>
  )
}

function CloseTabOnMount({ tabId }: { tabId: string }) {
  const { closeTab } = useTabsContext()
  const didCloseRef = useRef(false)

  useEffect(() => {
    if (didCloseRef.current) return
    didCloseRef.current = true
    closeTab(tabId)
  }, [closeTab, tabId])

  return <TabSnapshot />
}

function CloseHomeAfterSecondTabOpens() {
  const { closeTab, openTab, tabs } = useTabsContext()
  const didOpenRef = useRef(false)
  const didCloseRef = useRef(false)

  useEffect(() => {
    if (didOpenRef.current) return
    didOpenRef.current = true
    openTab('/app/agents', { id: 'agents', forceNew: true })
  }, [openTab])

  useEffect(() => {
    if (didCloseRef.current || !tabs.some((tab) => tab.id === 'agents')) return
    didCloseRef.current = true
    closeTab('home')
  }, [closeTab, tabs])

  return <TabSnapshot />
}

// Opens the same URL as the initial tab with forceNew to verify the explicit duplicate-tab escape hatch.
function ForceNewSameUrlOpener() {
  const { openTab } = useTabsContext()
  const didOpenRef = useRef(false)

  useEffect(() => {
    if (didOpenRef.current) return
    didOpenRef.current = true
    openTab('/app/launchpad', { forceNew: true })
  }, [openTab])

  return <TabSnapshot />
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

function PinnedOverflowSeeder() {
  const { addTab } = useTabsContext()
  return (
    <button
      type="button"
      onClick={() => {
        for (let i = 0; i <= TAB_LIMITS.hardCap; i++) {
          addTab({
            id: `pinned-${i}`,
            type: 'route',
            url: `/app/chat?topicId=pinned-${i}`,
            title: `Pinned ${i}`,
            lastAccessTime: i,
            isDormant: false,
            isPinned: true
          })
        }
      }}>
      Seed pinned overflow
    </button>
  )
}

function TransientMiniAppPinner() {
  const { openTab, pinTab, tabs } = useTabsContext()
  const didOpenRef = useRef(false)
  const didPinRef = useRef(false)

  useEffect(() => {
    if (didOpenRef.current) return
    didOpenRef.current = true
    openTab('/app/mini-app/deepseek-harness', {
      id: 'transient-mini-app',
      title: 'DeepSeek Harness',
      metadata: { transientMiniApp: true },
      forceNew: true
    })
  }, [openTab])

  useEffect(() => {
    if (didPinRef.current || !tabs.some((tab) => tab.id === 'transient-mini-app')) return
    didPinRef.current = true
    pinTab('transient-mini-app')
  }, [pinTab, tabs])

  return <div data-testid="transient-tab-ids">{tabs.map((tab) => tab.id).join(',')}</div>
}

beforeEach(() => {
  currentLanguage = 'en'
  navigationLayout = 'tabs'
  pinnedTabsValue = [PINNED_FILES_TAB]
  normalTabsValue = []
  activeTabIdValue = ''
  sidebarMocks.favorites = [
    { type: 'app', id: 'assistants' },
    { type: 'app', id: 'agents' },
    { type: 'app', id: 'files' }
  ]
  sidebarMocks.ensureFavoritesPinned.mockImplementation((items: readonly SidebarFavoriteItem[]) => {
    for (const item of items) {
      if (!sidebarMocks.favorites.some((favorite) => favorite.type === item.type && favorite.id === item.id)) {
        sidebarMocks.favorites = [...sidebarMocks.favorites, item]
      }
    }
  })
  conversationTabActionRender.mockClear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TabsProvider', () => {
  it('restores the full multi-tab session in the combined layout', () => {
    navigationLayout = 'both'
    pinnedTabsValue = []
    normalTabsValue = [
      { id: 'chat-id', type: 'route', url: '/app/chat', title: 'Chat', lastAccessTime: 2, isDormant: false },
      { id: 'agent-id', type: 'route', url: '/app/agents', title: 'Agent', lastAccessTime: 1, isDormant: false }
    ]
    activeTabIdValue = 'chat-id'

    render(
      <TabsProvider initialDefaultTab={null}>
        <WorkspaceControls />
      </TabsProvider>
    )

    expect(screen.getByTestId('workspace-layout')).toHaveTextContent('both')
    expect(screen.getByTestId('tab-bar-tabs')).toHaveTextContent('chat-id,agent-id')
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('chat-id:focused:/app/chat')
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('agent-id:focused:/app/agents')
  })

  it('preserves legacy independent utility tabs in the combined layout', async () => {
    navigationLayout = 'both'
    pinnedTabsValue = []

    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <WorkspaceControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('/settings/appearance'))

    fireEvent.click(screen.getByRole('button', { name: 'Open release notes' }))
    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('/app/release-notes'))
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('/settings/appearance')
    expect((screen.getByTestId('workspace-tabs').textContent ?? '').split(',')).toHaveLength(3)
    expect((screen.getByTestId('tab-bar-tabs').textContent ?? '').split(',')).toHaveLength(3)

    fireEvent.click(screen.getByRole('button', { name: 'Activate home workspace' }))
    await waitFor(() => expect(screen.getByTestId('workspace-active')).toHaveTextContent('home'))
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('/settings/appearance')
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('/app/release-notes')
  })

  it('keeps workspace identity aligned when legacy navigation rewrites a tab route', async () => {
    navigationLayout = 'both'
    pinnedTabsValue = []

    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <WorkspaceControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Rewrite active route' }))

    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('home:app:agents:/app/agents'))
  })

  it('keeps one mounted workspace per app in sidebar layout', async () => {
    navigationLayout = 'sidebar'
    pinnedTabsValue = []
    normalTabsValue = [
      {
        id: 'older-chat',
        type: 'route',
        url: '/app/chat?topicId=older',
        title: 'Older',
        lastAccessTime: 1,
        isDormant: false
      },
      {
        id: 'active-chat',
        type: 'route',
        url: '/app/chat?topicId=active',
        title: 'Active',
        lastAccessTime: 2,
        isDormant: false
      }
    ]
    activeTabIdValue = 'active-chat'

    render(
      <TabsProvider initialDefaultTab={null}>
        <WorkspaceControls />
      </TabsProvider>
    )

    await waitFor(() =>
      expect(screen.getByTestId('workspace-tabs')).toHaveTextContent(
        'active-chat:app:assistants:/app/chat?topicId=active'
      )
    )
    expect(screen.getByTestId('workspace-tabs')).not.toHaveTextContent('older-chat')
  })

  it('moves restored pinned tabs into unpinned Sidebar workspaces', async () => {
    navigationLayout = 'sidebar'
    pinnedTabsValue = [PINNED_FILES_TAB]
    normalTabsValue = [HOME_TAB]
    activeTabIdValue = 'home'

    render(
      <TabsProvider initialDefaultTab={null}>
        <WorkspaceControls />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('files:app:files:/app/files'))
    expect(setPinnedTabsMock).toHaveBeenCalledWith([])
  })

  it('keeps the focused route source when duplicate tabs collapse into Sidebar workspaces', async () => {
    navigationLayout = 'sidebar'
    pinnedTabsValue = []
    normalTabsValue = [
      {
        id: 'newer-chat',
        type: 'route',
        url: '/app/chat?topicId=newer',
        title: 'Newer',
        lastAccessTime: 10,
        isDormant: false
      },
      {
        id: 'source-chat',
        type: 'route',
        url: '/app/chat?topicId=source',
        title: 'Source',
        lastAccessTime: 1,
        isDormant: false
      },
      {
        id: 'settings',
        type: 'route',
        url: '/settings/appearance',
        title: 'Settings',
        metadata: { returnWorkspaceId: 'source-chat' },
        lastAccessTime: 20,
        isDormant: false
      }
    ]
    activeTabIdValue = 'settings'

    render(
      <TabsProvider initialDefaultTab={null}>
        <WorkspaceControls />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('source-chat:app:assistants'))
    expect(screen.getByTestId('workspace-tabs')).not.toHaveTextContent('newer-chat')
    expect(screen.getByTestId('workspace-active')).toHaveTextContent('settings')
  })

  it('reuses the chat workspace and ignores forceNew in sidebar layout', async () => {
    navigationLayout = 'sidebar'
    pinnedTabsValue = []

    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <WorkspaceControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open second chat' }))

    await waitFor(() =>
      expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('home:app:assistants:/app/chat?topicId=second')
    )
    expect((screen.getByTestId('workspace-tabs').textContent ?? '').split(',')).toHaveLength(1)
  })

  it('favorites a new Sidebar workspace with one preference write', async () => {
    navigationLayout = 'sidebar'
    pinnedTabsValue = []

    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <WorkspaceControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open notes' }))

    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('app:notes:/app/notes'))
    expect(sidebarMocks.ensureFavoritesPinned).toHaveBeenCalledTimes(1)
    expect(sidebarMocks.ensureFavoritesPinned).toHaveBeenCalledWith([{ type: 'app', id: 'notes' }])
  })

  it('uses one focused route and returns to its source workspace', async () => {
    navigationLayout = 'sidebar'
    pinnedTabsValue = []

    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <WorkspaceControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('focused:/settings/appearance'))
    expect(screen.getByTestId('workspace-active')).not.toHaveTextContent('home')

    fireEvent.click(screen.getByRole('button', { name: 'Close focused' }))
    await waitFor(() => expect(screen.getByTestId('workspace-active')).toHaveTextContent('home'))
    expect(screen.getByTestId('workspace-tabs')).not.toHaveTextContent('/settings/appearance')
  })

  it('keeps a reused pinned focused route removable from persistent storage', async () => {
    const pinnedFocusedTab: Tab = {
      id: 'focused-settings',
      type: 'route',
      url: '/settings/appearance',
      title: 'Settings',
      metadata: { returnWorkspaceId: HOME_TAB.id },
      lastAccessTime: 2,
      isDormant: false,
      isPinned: true
    }
    pinnedTabsValue = [pinnedFocusedTab]
    normalTabsValue = [HOME_TAB]
    activeTabIdValue = pinnedFocusedTab.id
    const user = userEvent.setup()
    const view = render(
      <TabsProvider initialDefaultTab={null}>
        <WorkspaceControls />
      </TabsProvider>
    )

    await user.click(screen.getByRole('button', { name: 'Open release notes' }))
    const replaceUpdater = [...setPinnedTabsMock.mock.calls]
      .reverse()
      .map(([value]) => value)
      .find((value) => typeof value === 'function') as ((tabs: Tab[]) => Tab[]) | undefined
    expect(replaceUpdater).toBeTypeOf('function')
    pinnedTabsValue = replaceUpdater!(pinnedTabsValue)
    expect(pinnedTabsValue).toEqual([
      expect.objectContaining({ id: pinnedFocusedTab.id, url: '/app/release-notes', isPinned: true })
    ])

    view.rerender(
      <TabsProvider initialDefaultTab={null}>
        <WorkspaceControls />
      </TabsProvider>
    )
    setPinnedTabsMock.mockClear()
    await user.click(screen.getByRole('button', { name: 'Close focused' }))

    await waitFor(() => expect(setPinnedTabsMock).toHaveBeenCalled())
    const closeUpdater = setPinnedTabsMock.mock.calls.at(-1)?.[0] as ((tabs: Tab[]) => Tab[]) | undefined
    expect(closeUpdater).toBeTypeOf('function')
    expect(closeUpdater!(pinnedTabsValue)).toEqual([])
  })

  it('releases the focused route when a Sidebar workspace is selected', async () => {
    navigationLayout = 'sidebar'
    pinnedTabsValue = []

    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <WorkspaceControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('focused:/settings/appearance'))

    fireEvent.click(screen.getByRole('button', { name: 'Open launchpad' }))
    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).not.toHaveTextContent('/settings/appearance'))
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('launchpad:/app/launchpad')
  })

  it('releases the focused route when a regular tab is opened', async () => {
    navigationLayout = 'tabs'
    pinnedTabsValue = []

    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <WorkspaceControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('focused:/settings/appearance'))

    fireEvent.click(screen.getByRole('button', { name: 'Open second chat' }))
    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).not.toHaveTextContent('/settings/appearance'))
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('app:assistants:/app/chat?topicId=second')
  })

  it('reuses the fixed Launchpad workspace and falls back to it when the last app is removed', async () => {
    navigationLayout = 'sidebar'
    pinnedTabsValue = []

    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <WorkspaceControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open launchpad' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open launchpad' }))
    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('launchpad:/app/launchpad'))
    expect((screen.getByTestId('workspace-tabs').textContent ?? '').match(/:launchpad:/g) ?? []).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Close chat workspace' }))
    await waitFor(() => expect(screen.getByTestId('workspace-active')).not.toHaveTextContent('home'))
    expect(screen.getByTestId('workspace-tabs')).not.toHaveTextContent('home:app:assistants')
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent(':launchpad:/app/launchpad')
  })

  it('restores the legacy single-tab state when switching from Sidebar to the combined layout', async () => {
    navigationLayout = 'sidebar'
    pinnedTabsValue = []
    normalTabsValue = [
      { id: 'agent-id', type: 'route', url: '/app/agents', title: 'Agent', lastAccessTime: 3, isDormant: false },
      {
        id: 'launch-id',
        type: 'route',
        url: '/app/launchpad',
        title: 'Launchpad',
        lastAccessTime: 2,
        isDormant: false
      },
      { id: 'chat-id', type: 'route', url: '/app/chat', title: 'Chat', lastAccessTime: 1, isDormant: false }
    ]
    activeTabIdValue = 'agent-id'

    const view = render(
      <TabsProvider initialDefaultTab={null}>
        <WorkspaceControls />
      </TabsProvider>
    )
    await waitFor(() => expect(screen.getByTestId('workspace-layout')).toHaveTextContent('sidebar'))

    navigationLayout = 'both'
    view.rerender(
      <TabsProvider initialDefaultTab={null}>
        <WorkspaceControls />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('workspace-layout')).toHaveTextContent('both'))
    await waitFor(() => expect(screen.getByTestId('tab-bar-tabs')).toHaveTextContent(/^agent-id$/))
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('agent-id:app:agents:')
    expect(screen.getByTestId('workspace-tabs')).not.toHaveTextContent('launch-id')
    expect(screen.getByTestId('workspace-tabs')).not.toHaveTextContent('chat-id')
    expect(screen.getByTestId('workspace-active')).toHaveTextContent('agent-id')

    fireEvent.click(screen.getByRole('button', { name: 'Open second chat' }))
    await waitFor(() => expect(screen.getByTestId('tab-bar-tabs').textContent?.split(',')).toHaveLength(2))
    expect(screen.getByTestId('tab-bar-tabs')).toHaveTextContent('agent-id')
  })

  it('keeps the focused route and its source as visible tabs when switching to the combined layout', async () => {
    navigationLayout = 'sidebar'
    pinnedTabsValue = []

    const view = render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <WorkspaceControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('focused:/settings/appearance'))
    const focusedTabId = screen.getByTestId('workspace-active').textContent ?? ''

    navigationLayout = 'both'
    view.rerender(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <WorkspaceControls />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('workspace-layout')).toHaveTextContent('both'))
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('home:app:assistants:/app/chat')
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent(`${focusedTabId}:focused:/settings/appearance`)
    expect(screen.getByTestId('tab-bar-tabs').textContent?.split(',')).toEqual(['home', focusedTabId])
    expect(screen.getByTestId('workspace-active')).toHaveTextContent(focusedTabId)
  })

  it('releases hidden Sidebar workspaces when switching from tabs to the combined layout', async () => {
    navigationLayout = 'tabs'
    pinnedTabsValue = []
    normalTabsValue = [
      {
        id: 'hidden-chat',
        type: 'route',
        url: '/app/chat',
        title: 'Chat',
        workspaceKey: 'app:assistants',
        isTabBarVisible: false,
        isDormant: true
      },
      {
        id: 'visible-agent',
        type: 'route',
        url: '/app/agents',
        title: 'Agent',
        workspaceKey: 'app:agents',
        isTabBarVisible: true,
        isDormant: false
      }
    ]
    activeTabIdValue = 'visible-agent'

    const view = render(
      <TabsProvider initialDefaultTab={null}>
        <WorkspaceControls />
      </TabsProvider>
    )

    expect(screen.getByTestId('tab-bar-tabs')).toHaveTextContent(/^visible-agent$/)
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('hidden-chat:app:assistants:')
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('visible-agent:app:agents:')

    navigationLayout = 'both'
    view.rerender(
      <TabsProvider initialDefaultTab={null}>
        <WorkspaceControls />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('workspace-layout')).toHaveTextContent('both'))
    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).not.toHaveTextContent('hidden-chat'))
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('visible-agent:app:agents:')
    expect(screen.getByTestId('tab-bar-tabs')).toHaveTextContent(/^visible-agent$/)
  })

  it('reuses a hidden Launchpad workspace after the last visible top tab closes', async () => {
    navigationLayout = 'tabs'
    pinnedTabsValue = []
    normalTabsValue = [
      {
        id: 'visible-chat',
        type: 'route',
        url: '/app/chat',
        title: 'Chat',
        workspaceKey: 'app:assistants',
        isTabBarVisible: true,
        isDormant: false
      },
      {
        id: 'hidden-launchpad',
        type: 'route',
        url: '/app/launchpad',
        title: 'Launchpad',
        workspaceKey: 'launchpad',
        isTabBarVisible: false,
        isDormant: true
      }
    ]
    activeTabIdValue = 'visible-chat'

    render(
      <TabsProvider initialDefaultTab={null}>
        <WorkspaceControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Close active tab' }))

    await waitFor(() => expect(screen.getByTestId('workspace-active')).toHaveTextContent('hidden-launchpad'))
    expect(screen.getByTestId('tab-bar-tabs')).toHaveTextContent(/^hidden-launchpad$/)
    expect(screen.getByTestId('workspace-tabs')).not.toHaveTextContent('visible-chat')
  })

  it('keeps the active focused route when switching from Sidebar to tabs', async () => {
    navigationLayout = 'sidebar'
    pinnedTabsValue = []

    const view = render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <WorkspaceControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    await waitFor(() => expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('focused:/settings/appearance'))
    const focusedTabId = screen.getByTestId('workspace-active').textContent

    navigationLayout = 'tabs'
    view.rerender(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <WorkspaceControls />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('workspace-layout')).toHaveTextContent('tabs'))
    expect(screen.getByTestId('workspace-active')).toHaveTextContent(focusedTabId ?? '')
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('focused:/settings/appearance')
  })

  it('auto-favorites a non-favorite workspace when tabs collapse into Sidebar layout', async () => {
    navigationLayout = 'sidebar'
    pinnedTabsValue = []
    normalTabsValue = [
      { id: 'notes-id', type: 'route', url: '/app/notes', title: 'Notes', lastAccessTime: 1, isDormant: false }
    ]
    activeTabIdValue = 'notes-id'

    render(
      <TabsProvider initialDefaultTab={null}>
        <WorkspaceControls />
      </TabsProvider>
    )

    await waitFor(() => expect(sidebarMocks.ensureFavoritesPinned).toHaveBeenCalledWith([{ type: 'app', id: 'notes' }]))
    expect(screen.getByTestId('workspace-tabs')).toHaveTextContent('notes-id:app:notes:/app/notes')
  })

  it('keeps conversation tab actions isolated while reading the latest tab state', async () => {
    render(
      <TabsProvider initialDefaultTab={HOME_TAB} includePinnedTabs={false}>
        <ConversationTabMutationControls />
        <ConversationTabActionProbe />
      </TabsProvider>
    )
    const initialActionRenders = conversationTabActionRender.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Seed tabs' }))
    await waitFor(() => expect(screen.getByTestId('conversation-tab-active')).toHaveTextContent('unrelated-tab'))
    expect(screen.getByTestId('conversation-tab-snapshot')).toHaveTextContent('topic-a-tab:Topic A')
    expect(conversationTabActionRender).toHaveBeenCalledTimes(initialActionRenders)

    fireEvent.click(screen.getByRole('button', { name: 'Activate home' }))
    await waitFor(() => expect(screen.getByTestId('conversation-tab-active')).toHaveTextContent('home'))
    expect(conversationTabActionRender).toHaveBeenCalledTimes(initialActionRenders)

    fireEvent.click(screen.getByRole('button', { name: 'Rename background topic' }))
    await waitFor(() => expect(screen.getByTestId('conversation-tab-snapshot')).toHaveTextContent('Renamed Topic'))
    expect(conversationTabActionRender).toHaveBeenCalledTimes(initialActionRenders)

    fireEvent.click(screen.getByRole('button', { name: 'Close unrelated tab' }))
    await waitFor(() => expect(screen.getByTestId('conversation-tab-snapshot')).not.toHaveTextContent('unrelated-tab'))
    expect(conversationTabActionRender).toHaveBeenCalledTimes(initialActionRenders)

    fireEvent.click(screen.getByRole('button', { name: 'Close background topic' }))
    await waitFor(() => expect(screen.getByTestId('conversation-tab-snapshot')).not.toHaveTextContent('topic-a-tab'))
    expect(conversationTabActionRender).toHaveBeenCalledTimes(initialActionRenders)
  })

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
      <TabsProvider initialDefaultTab={HOME_TAB}>
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
    expect(setPinnedTabsMock).not.toHaveBeenCalled()
  })

  it('routes an isPinned tab into the persistent pinned list in the main window', async () => {
    render(
      <TabsProvider initialDefaultTab={null}>
        <PinnedTabMaterializer />
      </TabsProvider>
    )

    await waitFor(() => expect(setPinnedTabsMock).toHaveBeenCalled())
  })

  it('keeps a transient mini-app tab visible when pinning is requested programmatically', async () => {
    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <TransientMiniAppPinner />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('transient-tab-ids')).toHaveTextContent('transient-mini-app'))
    expect(setPinnedTabsMock.mock.calls.some(([arg]) => typeof arg === 'function')).toBe(false)
  })

  it('removes a menu-closed pinned tab from the persistent pinned list', async () => {
    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <CloseTabOnMount tabId="files" />
      </TabsProvider>
    )

    // The mocked pinned cache never re-renders, so assert on the persisted write:
    // the pinned list must drop the tab, or it resurrects on restart.
    await waitFor(() => expect(setPinnedTabsMock).toHaveBeenCalled())
    expect(screen.getByTestId('active-tab-id')).toHaveTextContent('home')

    // Mount also fires a one-time pinned-session hydration write, so the close's
    // functional updater isn't necessarily the last call — find it explicitly.
    const updater = setPinnedTabsMock.mock.calls.map((call) => call[0]).find((arg) => typeof arg === 'function')
    expect(typeof updater).toBe('function')
    expect(updater([PINNED_FILES_TAB])).toEqual([])
  })

  it('drops legacy assistant-library pinned tabs when restoring the main tab list', async () => {
    pinnedTabsValue = [LEGACY_LIBRARY_PINNED_TAB, PINNED_FILES_TAB]

    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <TabIds />
      </TabsProvider>
    )

    expect(screen.getByTestId('tab-ids')).toHaveTextContent('files,home')
    await waitFor(() => expect(setPinnedTabsMock).toHaveBeenCalledWith([{ ...PINNED_FILES_TAB, isDormant: true }]))
  })

  // Reviewer B7: OpenClaw's sidebar entry + /app/openclaw route were removed (folded into Code), so a
  // persisted OpenClaw pin must be redirected to /app/code on restore instead of resurrecting a dead
  // route — and the reconciled list written back to the cache.
  it('redirects a persisted OpenClaw pinned tab to the Code page on restore', async () => {
    pinnedTabsValue = [PINNED_OPENCLAW_TAB, PINNED_FILES_TAB]

    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <TabSnapshot />
      </TabsProvider>
    )

    expect(screen.getByTestId('tab-urls')).toHaveTextContent('/app/code,/app/files,/app/chat')
    await waitFor(() =>
      expect(setPinnedTabsMock).toHaveBeenCalledWith([
        { ...PINNED_OPENCLAW_TAB, url: '/app/code', title: '/app/code', isDormant: true },
        { ...PINNED_FILES_TAB, isDormant: true }
      ])
    )
  })

  it('closes active and adjacent tabs atomically when closing a batch', async () => {
    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <BatchCloseControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Seed tabs' }))
    await waitFor(() => expect(screen.getByTestId('tab-ids')).toHaveTextContent('files,home,b,c,d'))

    fireEvent.click(screen.getByRole('button', { name: 'Activate C' }))
    await waitFor(() => expect(screen.getByTestId('active-tab-id')).toHaveTextContent('c'))

    fireEvent.click(screen.getByRole('button', { name: 'Close B and C' }))

    await waitFor(() => expect(screen.getByTestId('tab-ids')).toHaveTextContent('files,home,d'))
    // Chrome-style: the surviving right neighbor takes over the active slot.
    expect(screen.getByTestId('active-tab-id')).toHaveTextContent('d')
  })

  it('activates the designated survivor instead of the nearest neighbor when the active tab is batch-closed', async () => {
    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <BatchCloseControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Seed tabs' }))
    await waitFor(() => expect(screen.getByTestId('tab-ids')).toHaveTextContent('files,home,b,c,d'))

    // Active tab (home) sits left of the designated survivor (c) with the
    // pinned files tab further left — without activateId the nearest-left rule
    // would land on the pinned tab instead of c.
    fireEvent.click(screen.getByRole('button', { name: 'Activate Home' }))
    await waitFor(() => expect(screen.getByTestId('active-tab-id')).toHaveTextContent('home'))

    fireEvent.click(screen.getByRole('button', { name: 'Close others around C' }))

    await waitFor(() => expect(screen.getByTestId('tab-ids')).toHaveTextContent('files,c'))
    expect(screen.getByTestId('active-tab-id')).toHaveTextContent('c')
  })

  it('wakes a dormant survivor when batch close activates it', async () => {
    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <BatchCloseControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Seed tabs' }))
    await waitFor(() => expect(screen.getByTestId('tab-ids')).toHaveTextContent('files,home,b,c,d'))

    fireEvent.click(screen.getByRole('button', { name: 'Hibernate C' }))
    await waitFor(() => expect(screen.getByTestId('dormant-ids')).toHaveTextContent('c'))

    fireEvent.click(screen.getByRole('button', { name: 'Activate Home' }))
    await waitFor(() => expect(screen.getByTestId('active-tab-id')).toHaveTextContent('home'))

    fireEvent.click(screen.getByRole('button', { name: 'Close others around C' }))

    // The dormant survivor must be woken, not just pointed at — a dormant tab
    // is not rendered, so activating without waking would blank the content.
    await waitFor(() => expect(screen.getByTestId('active-tab-id')).toHaveTextContent('c'))
    expect(screen.getByTestId('tab-ids')).toHaveTextContent('files,c')
    expect(screen.getByTestId('dormant-ids')).toHaveTextContent(/^$/)
  })

  it('wakes the active tab when it is unexpectedly dormant', async () => {
    render(
      <TabsProvider initialDefaultTab={HOME_TAB} includePinnedTabs={false}>
        <BatchCloseControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Seed tabs' }))
    fireEvent.click(screen.getByRole('button', { name: 'Activate C' }))
    await waitFor(() => expect(screen.getByTestId('active-tab-id')).toHaveTextContent('c'))

    fireEvent.click(screen.getByRole('button', { name: 'Hibernate C' }))
    await waitFor(() => expect(screen.getByTestId('dormant-ids')).toHaveTextContent('c'))

    fireEvent.click(screen.getByRole('button', { name: 'Activate C' }))
    await waitFor(() => expect(screen.getByTestId('dormant-ids')).toHaveTextContent(/^$/))
  })

  it('falls back to the nearest neighbor when the designated survivor is itself closed', async () => {
    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <BatchCloseControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Seed tabs' }))
    await waitFor(() => expect(screen.getByTestId('tab-ids')).toHaveTextContent('files,home,b,c,d'))

    fireEvent.click(screen.getByRole('button', { name: 'Activate C' }))
    await waitFor(() => expect(screen.getByTestId('active-tab-id')).toHaveTextContent('c'))

    // activateId 'c' is inside the closing set, so it cannot survive. The
    // Chrome-style fallback selects the right neighbor that slides into place.
    fireEvent.click(screen.getByRole('button', { name: 'Close B and C keeping C' }))

    await waitFor(() => expect(screen.getByTestId('tab-ids')).toHaveTextContent('files,home,d'))
    expect(screen.getByTestId('active-tab-id')).toHaveTextContent('d')
  })

  it('falls back to the left neighbor when the active tab is last in the strip', async () => {
    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <BatchCloseControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Seed tabs' }))
    await waitFor(() => expect(screen.getByTestId('tab-ids')).toHaveTextContent('files,home,b,c,d'))

    fireEvent.click(screen.getByRole('button', { name: 'Activate D' }))
    await waitFor(() => expect(screen.getByTestId('active-tab-id')).toHaveTextContent('d'))
    fireEvent.click(screen.getByRole('button', { name: 'Close D' }))

    await waitFor(() => expect(screen.getByTestId('tab-ids')).toHaveTextContent('files,home,b,c'))
    expect(screen.getByTestId('active-tab-id')).toHaveTextContent('c')
  })

  it('wakes a dormant pinned survivor through the pinned store', async () => {
    pinnedTabsValue = [{ ...PINNED_FILES_TAB, isDormant: true }]

    render(
      <TabsProvider initialDefaultTab={HOME_TAB}>
        <BatchCloseControls />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Seed tabs' }))
    await waitFor(() => expect(screen.getByTestId('tab-ids')).toHaveTextContent('files,home,b,c,d'))

    fireEvent.click(screen.getByRole('button', { name: 'Activate Home' }))
    await waitFor(() => expect(screen.getByTestId('active-tab-id')).toHaveTextContent('home'))

    fireEvent.click(screen.getByRole('button', { name: 'Close all normals to Files' }))

    await waitFor(() => expect(screen.getByTestId('active-tab-id')).toHaveTextContent('files'))

    // The pinned store is mocked, so assert on the updater sent to it: the
    // dormant pinned survivor must come back woken.
    const updater = setPinnedTabsMock.mock.calls.at(-1)?.[0] as (prev: Tab[]) => Tab[]
    expect(typeof updater).toBe('function')
    const next = updater([{ ...PINNED_FILES_TAB, isDormant: true }])
    expect(next.find((tab) => tab.id === 'files')?.isDormant).toBe(false)
  })

  it('opens launchpad when closing the only tab', async () => {
    render(
      <TabsProvider initialDefaultTab={HOME_TAB} includePinnedTabs={false}>
        <CloseTabOnMount tabId="home" />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('tab-urls')).toHaveTextContent('/app/launchpad'))
    expect(screen.getByTestId('tab-titles')).toHaveTextContent('Launchpad')
    expect(screen.getByTestId('active-tab-id')).not.toHaveTextContent('home')
  })

  it('does not open launchpad when closing one tab while another remains', async () => {
    render(
      <TabsProvider initialDefaultTab={HOME_TAB} includePinnedTabs={false}>
        <CloseHomeAfterSecondTabOpens />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('tab-ids')).toHaveTextContent('agents'))
    expect(screen.getByTestId('tab-urls')).toHaveTextContent('/app/agents')
    expect(screen.getByTestId('tab-urls')).not.toHaveTextContent('/app/launchpad')
    expect(screen.getByTestId('active-tab-id')).toHaveTextContent('agents')
  })

  it('creates a second tab for an already-open URL when forceNew is set', async () => {
    render(
      <TabsProvider
        initialDefaultTab={{
          id: 'home',
          type: 'route',
          url: '/app/launchpad',
          title: '',
          lastAccessTime: 0,
          isDormant: false
        }}
        includePinnedTabs={false}>
        <ForceNewSameUrlOpener />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('tab-urls')).toHaveTextContent('/app/launchpad,/app/launchpad'))
    const ids = (screen.getByTestId('tab-ids').textContent ?? '').split(',')
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })
})

describe('TabsProvider session restore', () => {
  it('drops transient mini-app tabs whose in-memory descriptor disappears on restart', async () => {
    const codeTab: Tab = {
      id: 'code',
      type: 'route',
      url: '/app/code',
      title: 'Code',
      lastAccessTime: 1,
      isDormant: false
    }
    const transientMiniAppTab: Tab = {
      id: 'deepseek-harness',
      type: 'route',
      url: '/app/mini-app/deepseek-harness-web',
      title: 'DeepSeek Harness',
      metadata: { transientMiniApp: true },
      lastAccessTime: 2,
      isDormant: false
    }
    normalTabsValue = [codeTab, transientMiniAppTab]
    activeTabIdValue = transientMiniAppTab.id

    render(
      <TabsProvider initialDefaultTab={null}>
        <SessionInspector />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent(codeTab.id))
    expect(screen.getByTestId('session-ids')).not.toHaveTextContent(transientMiniAppTab.id)
  })

  it('restores the persisted session and keeps only the active tab awake', async () => {
    const tabA: Tab = { id: 'a', type: 'route', url: '/app/chat', title: '', lastAccessTime: 1, isDormant: false }
    const tabB: Tab = { id: 'b', type: 'route', url: '/app/agents', title: '', lastAccessTime: 2, isDormant: false }
    normalTabsValue = [tabA, tabB]
    activeTabIdValue = 'b'

    render(
      <TabsProvider initialDefaultTab={null}>
        <SessionInspector />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('b'))
    const dump = screen.getByTestId('session-tabs').textContent ?? ''
    expect(dump).toContain('a:dormant')
    expect(dump).toContain('b:awake')
    expect(dump.split(',').filter((tab) => tab.endsWith(':awake'))).toHaveLength(1)
  })

  it('keeps the resolved active tab awake when the persisted active id is stale', async () => {
    // Active id points at a tab that no longer exists in either the pinned or normal set. The
    // resolved active tab (first normal tab) must still be awake, or AppShell renders no TabRouter.
    const tabA: Tab = { id: 'a', type: 'route', url: '/app/chat', title: '', lastAccessTime: 1, isDormant: false }
    const tabB: Tab = { id: 'b', type: 'route', url: '/app/agents', title: '', lastAccessTime: 2, isDormant: false }
    normalTabsValue = [tabA, tabB]
    activeTabIdValue = 'ghost'

    render(
      <TabsProvider initialDefaultTab={null}>
        <SessionInspector />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('a'))
    expect(screen.getByTestId('session-tabs').textContent ?? '').toContain('a:awake')
  })

  it('honors a pinned active tab when no unpinned tabs were open', async () => {
    // Last session had zero normal tabs but the active tab was the pinned "files" tab — restore must
    // reselect it (the default tab stays present but dormant) instead of falling back to default.
    pinnedTabsValue = [{ ...PINNED_FILES_TAB, isDormant: true }]
    normalTabsValue = []
    activeTabIdValue = 'files'

    render(
      <TabsProvider>
        <SessionInspector />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('files'))
    const dump = screen.getByTestId('session-tabs').textContent ?? ''
    expect(dump).toContain('files:awake')
    expect(dump).toContain('home:dormant')
  })

  it('does not restore a persisted session in a detached sub-window', async () => {
    const tabA: Tab = { id: 'a', type: 'route', url: '/app/chat', title: '', lastAccessTime: 1, isDormant: false }
    normalTabsValue = [tabA]
    activeTabIdValue = 'a'

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
    const ids = (screen.getByTestId('session-ids').textContent ?? '').split(',')
    expect(ids).not.toContain('a')
  })

  it('preserves dormant tabs beyond the active-tab LRU budget', async () => {
    const overflow = TAB_LIMITS.softCap + 5
    const many: Tab[] = Array.from({ length: overflow }, (_, i) => ({
      id: `n${i}`,
      type: 'route',
      url: '/app/chat',
      title: '',
      lastAccessTime: i,
      isDormant: false
    }))
    normalTabsValue = many
    activeTabIdValue = 'n0'

    render(
      <TabsProvider initialDefaultTab={null}>
        <SessionInspector />
      </TabsProvider>
    )

    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('n0'))
    const ids = (screen.getByTestId('session-ids').textContent ?? '').split(',').filter((id) => id.startsWith('n'))
    expect(ids).toHaveLength(overflow)
    expect(ids).toContain('n0')
    expect(ids).toContain('n1')
    expect(ids).toContain(`n${overflow - 1}`)
    const dump = screen.getByTestId('session-tabs').textContent ?? ''
    expect(dump.split(',').filter((tab) => tab.endsWith(':awake'))).toEqual(['n0:awake'])
  })

  it('applies the hard fuse across a batch of pinned additions', () => {
    render(
      <TabsProvider>
        <PinnedOverflowSeeder />
      </TabsProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: 'Seed pinned overflow' }))

    const updaters = setPinnedTabsMock.mock.calls.map(([arg]) => arg).filter((arg) => typeof arg === 'function')
    const persisted = updaters.reduce<Tab[]>((tabs, update) => update(tabs), [{ ...PINNED_FILES_TAB, isDormant: true }])
    expect(persisted.some((tab) => tab.isDormant)).toBe(true)
    expect(persisted.filter((tab) => !tab.isDormant)).toHaveLength(TAB_LIMITS.softCap)
    expect(persisted.find((tab) => tab.id === `pinned-${TAB_LIMITS.hardCap}`)?.isDormant).toBe(false)
  })
})

describe('migratePinnedTabs', () => {
  it('drops pinned transient mini-app tabs on restore', () => {
    const transientMiniAppTab: Tab = {
      ...PINNED_FILES_TAB,
      id: 'transient-mini-app',
      url: '/app/mini-app/transient',
      metadata: { transientMiniApp: true }
    }

    const { tabs, changed } = migratePinnedTabs([transientMiniAppTab, PINNED_FILES_TAB])
    expect(changed).toBe(true)
    expect(tabs).toEqual([PINNED_FILES_TAB])
  })

  it('redirects an OpenClaw pin to the Code page and flags the change', () => {
    const { tabs, changed } = migratePinnedTabs([PINNED_OPENCLAW_TAB, PINNED_FILES_TAB])
    expect(changed).toBe(true)
    expect(tabs).toEqual([{ ...PINNED_OPENCLAW_TAB, url: '/app/code', title: '/app/code' }, PINNED_FILES_TAB])
  })

  it('drops the OpenClaw pin instead of duplicating an existing Code pin', () => {
    const { tabs, changed } = migratePinnedTabs([PINNED_CODE_TAB, PINNED_OPENCLAW_TAB])
    expect(changed).toBe(true)
    expect(tabs).toEqual([PINNED_CODE_TAB])
  })

  it('collapses two OpenClaw pins into a single Code pin', () => {
    const { tabs } = migratePinnedTabs([PINNED_OPENCLAW_TAB, { ...PINNED_OPENCLAW_TAB, id: 'openclaw2' }])
    expect(tabs).toEqual([{ ...PINNED_OPENCLAW_TAB, url: '/app/code', title: '/app/code' }])
  })

  it('drops legacy library pins', () => {
    const { tabs, changed } = migratePinnedTabs([LEGACY_LIBRARY_PINNED_TAB, PINNED_FILES_TAB])
    expect(changed).toBe(true)
    expect(tabs).toEqual([PINNED_FILES_TAB])
  })

  it('is a no-op when nothing needs migrating', () => {
    const input = [PINNED_FILES_TAB, PINNED_CODE_TAB]
    const { tabs, changed } = migratePinnedTabs(input)
    expect(changed).toBe(false)
    expect(tabs).toEqual(input)
  })
})
