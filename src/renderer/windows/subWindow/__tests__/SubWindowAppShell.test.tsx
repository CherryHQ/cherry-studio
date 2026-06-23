// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const tabs = [{ id: 'home', type: 'route', url: '/home', title: 'Home' }]

async function renderSubWindowAppShell(isMac: boolean) {
  vi.resetModules()
  vi.doMock('@renderer/config/constant', () => ({ isMac }))
  vi.doMock('@renderer/databases', () => ({}))
  vi.doMock('@renderer/hooks/useWindowInitData', () => ({
    useWindowInitData: () => null
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
      openTab: vi.fn(),
      pinTab: vi.fn(),
      unpinTab: vi.fn()
    })
  }))
  vi.doMock('@renderer/utils/routeTitle', () => ({
    getDefaultRouteTitle: (url: string) => url,
    isPageTitledRoute: () => false
  }))
  vi.doMock('../SubWindowTitleBar', () => ({
    SubWindowTitleBar: () => <header data-testid="sub-window-title-bar" />
  }))
  vi.doMock('@renderer/components/layout/TabRouter', () => ({
    TabRouter: ({ isActive }: { isActive: boolean }) => (
      <section data-testid="tab-router">
        {!isMac && isActive ? <div data-page-side-panel-root="true" data-testid="scoped-root" /> : null}
      </section>
    )
  }))
  vi.doMock('@renderer/components/MiniApp/MiniAppTabsPool', () => ({
    default: () => <div data-testid="mini-app-pool" />
  }))

  const { SubWindowAppShell } = await import('../SubWindowAppShell')
  render(<SubWindowAppShell />)
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.resetModules()
})

describe('SubWindowAppShell page side panel root', () => {
  it('scopes the page side panel root to the tab content area, excluding app chrome, outside macOS', async () => {
    await renderSubWindowAppShell(false)

    const root = document.querySelector('[data-page-side-panel-root="true"]')
    expect(root).toBeInTheDocument()
    expect(root).not.toContainElement(screen.getByTestId('sub-window-title-bar'))
    expect(screen.getByTestId('tab-router')).toContainElement(root as HTMLElement)
  })

  it('does not mark a scoped page side panel root on macOS', async () => {
    await renderSubWindowAppShell(true)

    expect(document.querySelector('[data-page-side-panel-root="true"]')).not.toBeInTheDocument()
  })
})
