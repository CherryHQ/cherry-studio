// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tabs = [{ id: 'home', type: 'route', url: '/home', title: 'Home' }]

async function renderAppShell(isMac: boolean) {
  vi.resetModules()
  vi.doMock('@renderer/config/constant', () => ({ isMac }))
  vi.doMock('@renderer/databases', () => ({}))
  vi.doMock('@renderer/hooks/useMacTransparentWindow', () => ({
    default: () => false
  }))
  vi.doMock('@renderer/hooks/useTabs', () => ({
    useTabs: () => ({
      tabs,
      activeTabId: 'home',
      setActiveTab: vi.fn(),
      closeTab: vi.fn(),
      updateTab: vi.fn(),
      addTab: vi.fn(),
      reorderTabs: vi.fn(),
      pinTab: vi.fn(),
      unpinTab: vi.fn()
    })
  }))
  vi.doMock('@renderer/utils/routeTitle', () => ({
    getDefaultRouteTitle: (url: string) => url
  }))
  vi.doMock('@renderer/components/app/Sidebar', () => ({
    default: () => <aside data-testid="sidebar" />
  }))
  vi.doMock('@renderer/components/MiniApp/MiniAppTabsPool', () => ({
    default: () => <div data-testid="mini-app-pool" />
  }))
  vi.doMock('../AppShellTabBar', () => ({
    AppShellTabBar: () => <header data-testid="tab-bar" />
  }))
  vi.doMock('../TabRouter', () => ({
    TabRouter: ({ isActive }: { isActive: boolean }) => (
      <section data-testid="tab-router">
        {!isMac && isActive ? <div data-page-side-panel-root="true" data-testid="scoped-root" /> : null}
      </section>
    )
  }))

  const { AppShell } = await import('../AppShell')
  render(<AppShell />)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.resetModules()
})

describe('AppShell page side panel root', () => {
  it('scopes the page side panel root to the tab content area, excluding app chrome, outside macOS', async () => {
    await renderAppShell(false)

    const root = document.querySelector('[data-page-side-panel-root="true"]')
    expect(root).toBeInTheDocument()
    expect(root).not.toContainElement(screen.getByTestId('tab-bar'))
    expect(root).not.toContainElement(screen.getByTestId('sidebar'))
    expect(screen.getByTestId('tab-router')).toContainElement(root as HTMLElement)
  })

  it('does not mark a scoped page side panel root on macOS', async () => {
    await renderAppShell(true)

    expect(document.querySelector('[data-page-side-panel-root="true"]')).not.toBeInTheDocument()
  })
})
