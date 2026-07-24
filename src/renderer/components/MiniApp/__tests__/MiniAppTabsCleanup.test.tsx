// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

// Stateful pinned-tabs mock: the pinned-tab close case needs the persist store
// to actually apply functional updates and re-render, unlike a plain vi.fn().
let initialPinnedTabs: Tab[] = []
vi.mock('@renderer/data/hooks/useCache', async () => {
  const { useState } = await import('react')
  return {
    usePersistCache: () => useState(initialPinnedTabs)
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } })
}))

vi.mock('@renderer/utils/routeTitle', () => ({
  getDefaultRouteTitle: (url: string) => url,
  isPageTitledRoute: (url: string) => url.startsWith('/app/chat'),
  isTopLevelRoute: () => false
}))

vi.mock('@renderer/utils/sidebar', () => ({
  resolveSidebarAppTabEntryUrl: (tab: Tab) => tab.url
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: vi.fn() },
  useIpcOn: vi.fn()
}))

const exitMiniApp = vi.fn()
vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({ exitMiniApp })
}))

import { TabsProvider } from '@renderer/components/layout/TabsProvider'
import { useTabsContext } from '@renderer/hooks/tab'

import MiniAppTabsCleanup from '../MiniAppTabsCleanup'

const routeTab = (id: string, url: string): Tab => ({
  id,
  type: 'route',
  url,
  title: id,
  lastAccessTime: 0,
  isDormant: false
})

function Controls() {
  const { addTab, closeTab, closeTabs, updateTab, setActiveTab, tabs, activeTabId } = useTabsContext()

  return (
    <>
      <button type="button" onClick={() => addTab(routeTab('a1', '/app/mini-app/appA'))}>
        Add A1
      </button>
      <button type="button" onClick={() => addTab(routeTab('a2', '/app/mini-app/appA'))}>
        Add A2
      </button>
      <button type="button" onClick={() => addTab(routeTab('b1', '/app/mini-app/appB'))}>
        Add B1
      </button>
      <button type="button" onClick={() => addTab(routeTab('x1', '/app/files'))}>
        Add Other
      </button>
      <button type="button" onClick={() => closeTab('a1')}>
        Close A1
      </button>
      <button type="button" onClick={() => closeTab('a2')}>
        Close A2
      </button>
      <button type="button" onClick={() => closeTab('b1')}>
        Close B1
      </button>
      <button type="button" onClick={() => closeTab('x1')}>
        Close Other
      </button>
      <button type="button" onClick={() => closeTab('m-pin')}>
        Close Pinned
      </button>
      <button
        type="button"
        onClick={() => {
          // Same-tick sequential closes — the shape cleanupOpenedCustomMiniApp
          // produces when a custom app has several tabs open.
          closeTab('a1')
          closeTab('a2')
        }}>
        Close A1 and A2 same tick
      </button>
      <button type="button" onClick={() => closeTabs(tabs.map((tab) => tab.id))}>
        Close All
      </button>
      <button type="button" onClick={() => updateTab('a1', { url: '/app/files', title: 'Files' })}>
        Rewrite A1 Away
      </button>
      <button type="button" onClick={() => updateTab('a2', { isDormant: true })}>
        Hibernate A2
      </button>
      <button type="button" onClick={() => setActiveTab('a1')}>
        Activate A1
      </button>
      <div data-testid="active-tab-id">{activeTabId}</div>
      <div data-testid="tab-ids">{tabs.map((tab) => tab.id).join(',')}</div>
    </>
  )
}

const renderShell = () =>
  render(
    <TabsProvider>
      <MiniAppTabsCleanup />
      <Controls />
    </TabsProvider>
  )

describe('MiniAppTabsCleanup', () => {
  beforeEach(() => {
    initialPinnedTabs = []
    exitMiniApp.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('exits a mini app when its only tab is explicitly closed', () => {
    renderShell()
    fireEvent.click(screen.getByText('Add A1'))
    fireEvent.click(screen.getByText('Close A1'))

    expect(exitMiniApp).toHaveBeenCalledTimes(1)
    expect(exitMiniApp).toHaveBeenCalledWith('appA')
  })

  it('does not exit anything when a non-mini-app tab is closed', () => {
    renderShell()
    fireEvent.click(screen.getByText('Add A1'))
    fireEvent.click(screen.getByText('Add Other'))
    fireEvent.click(screen.getByText('Close Other'))

    expect(exitMiniApp).not.toHaveBeenCalled()
  })

  it('keeps the app alive while another tab still references it, and exits once the last one closes', () => {
    renderShell()
    fireEvent.click(screen.getByText('Add A1'))
    fireEvent.click(screen.getByText('Add A2'))

    fireEvent.click(screen.getByText('Close A1'))
    expect(exitMiniApp).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Close A1')) // no-op: already closed
    fireEvent.click(screen.getByText('Close B1')) // no-op: never added
    expect(exitMiniApp).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Add A1'))
    fireEvent.click(screen.getByText('Close A1'))
    fireEvent.click(screen.getByText('Close A2'))
    expect(exitMiniApp).toHaveBeenCalledWith('appA')
  })

  it('exits exactly once when both duplicate tabs close in the same tick (third tab present)', () => {
    renderShell()
    fireEvent.click(screen.getByText('Add A1'))
    fireEvent.click(screen.getByText('Add A2'))
    fireEvent.click(screen.getByText('Add Other')) // keeps the window from hitting the close-all fallback path

    fireEvent.click(screen.getByText('Close A1 and A2 same tick'))

    expect(exitMiniApp).toHaveBeenCalledTimes(1)
    expect(exitMiniApp).toHaveBeenCalledWith('appA')
  })

  it('closing a background mini-app tab exits only that app ("close others" shape)', () => {
    renderShell()
    fireEvent.click(screen.getByText('Add A1'))
    fireEvent.click(screen.getByText('Add B1'))
    fireEvent.click(screen.getByText('Activate A1'))

    fireEvent.click(screen.getByText('Close B1'))

    expect(exitMiniApp).toHaveBeenCalledTimes(1)
    expect(exitMiniApp).toHaveBeenCalledWith('appB')
  })

  it('close-all exits only apps referenced by the closed tabs, and the fallback tab appears', () => {
    renderShell()
    fireEvent.click(screen.getByText('Add A1'))
    fireEvent.click(screen.getByText('Add B1'))
    fireEvent.click(screen.getByText('Add Other'))

    fireEvent.click(screen.getByText('Close All'))

    expect(exitMiniApp).toHaveBeenCalledTimes(2)
    expect(exitMiniApp).toHaveBeenCalledWith('appA')
    expect(exitMiniApp).toHaveBeenCalledWith('appB')
    // closing everything replaces the tab strip with the launchpad fallback
    expect(screen.getByTestId('tab-ids').textContent).not.toContain('a1')
    expect(screen.getByTestId('tab-ids').textContent?.length).toBeGreaterThan(0)
  })

  it('navigating a tab away from a mini app (URL rewrite) does not exit it', () => {
    renderShell()
    fireEvent.click(screen.getByText('Add A1'))

    fireEvent.click(screen.getByText('Rewrite A1 Away'))

    expect(exitMiniApp).not.toHaveBeenCalled()
  })

  it('a dormant tab still counts as a reference — closing the other duplicate does not exit', () => {
    renderShell()
    fireEvent.click(screen.getByText('Add A1'))
    fireEvent.click(screen.getByText('Add A2'))
    fireEvent.click(screen.getByText('Hibernate A2'))

    fireEvent.click(screen.getByText('Close A1'))

    expect(exitMiniApp).not.toHaveBeenCalled()
  })

  it('explicitly closing a pinned mini-app tab exits the app', () => {
    initialPinnedTabs = [{ ...routeTab('m-pin', '/app/mini-app/appPinned'), isPinned: true }]
    renderShell()

    fireEvent.click(screen.getByText('Close Pinned'))

    expect(exitMiniApp).toHaveBeenCalledTimes(1)
    expect(exitMiniApp).toHaveBeenCalledWith('appPinned')
  })

  it('renders nothing and stays inert without a TabsProvider', () => {
    const { container } = render(<MiniAppTabsCleanup />)
    expect(container).toBeEmptyDOMElement()
    expect(exitMiniApp).not.toHaveBeenCalled()
  })
})
