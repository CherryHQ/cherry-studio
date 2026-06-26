// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

// Import the real component from its source path: the `@cherrystudio/ui` barrel
// is globally mocked for renderer tests, but this deeper specifier is not.
import { PageSidePanel } from '@cherrystudio/ui/components/composites/page-side-panel'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { createMemoryHistory } from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const knobs = vi.hoisted(() => ({
  isMac: false,
  renderPage: (() => null) as (url: string) => React.ReactNode
}))

const routerMocks = vi.hoisted(() => ({
  portalContainer: {
    current: null as HTMLElement | null
  },
  navigate: vi.fn(),
  subscribe: vi.fn(() => vi.fn())
}))

vi.mock('@renderer/config/constant', () => ({
  get isMac() {
    return knobs.isMac
  }
}))

vi.mock('@cherrystudio/ui', () => ({
  PortalContainerProvider: ({ children, container }: { children: React.ReactNode; container: HTMLElement | null }) => {
    routerMocks.portalContainer.current = container
    return (
      <div
        data-has-portal-container={String(container instanceof HTMLElement)}
        data-portal-container-is-body={String(container === document.body)}
        data-testid="portal-container-provider">
        {children}
      </div>
    )
  },
  usePortalContainer: () => routerMocks.portalContainer.current
}))

vi.mock('@renderer/routeTree.gen', () => ({ routeTree: {} }))

// Stub the router so TabRouter can mount without the real route tree. Each tab's
// history carries its url so the injected page can tell tabs apart, and the
// provider exposes the resolved portal container for the scoping assertions.
vi.mock('@tanstack/react-router', async () => {
  const { usePortalContainer } = await import('@cherrystudio/ui')

  return {
    createMemoryHistory: vi.fn((options: { initialEntries: string[] }) => options),
    createRouter: vi.fn(({ history }: { history: { initialEntries: string[] } }) => ({
      navigate: routerMocks.navigate,
      subscribe: routerMocks.subscribe,
      state: {
        location: {
          href: history.initialEntries[0]
        }
      }
    })),
    RouterProvider: ({ router }: { router: { state: { location: { href: string } } } }) => {
      const container = usePortalContainer()

      return (
        <div
          data-testid="router-provider"
          data-has-portal-container={String(container instanceof HTMLElement)}
          data-portal-container-is-body={String(container === document.body)}>
          {knobs.renderPage(router.state.location.href)}
        </div>
      )
    }
  }
})

import { TabRouter } from '../TabRouter'

const tab = (id: string, url: string): Tab => ({ id, url, title: url, type: 'route' }) as Tab

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

afterEach(() => {
  cleanup()
  knobs.isMac = false
  knobs.renderPage = () => null
  routerMocks.portalContainer.current = null
  vi.clearAllMocks()
})

describe('TabRouter page side panel root', () => {
  it('exposes the scoped root on the active tab subtree outside macOS', () => {
    const { container } = render(<TabRouter tab={tab('a', '/a')} isActive onUrlChange={() => {}} />)
    expect(container.querySelector('[data-page-side-panel-root="true"]')).toBeInTheDocument()
  })

  it('does not expose the scoped root on an inactive tab', () => {
    const { container } = render(<TabRouter tab={tab('a', '/a')} isActive={false} onUrlChange={() => {}} />)
    expect(container.querySelector('[data-page-side-panel-root="true"]')).not.toBeInTheDocument()
  })

  it('does not expose a scoped root on macOS', () => {
    knobs.isMac = true
    const { container } = render(<TabRouter tab={tab('a', '/a')} isActive onUrlChange={() => {}} />)
    expect(container.querySelector('[data-page-side-panel-root="true"]')).not.toBeInTheDocument()
  })
})

describe('TabRouter PageSidePanel portal isolation', () => {
  // Regression for the non-mac scoped portal: a PageSidePanel opened in one tab
  // must not stay visible after switching to another tab.
  it('hides a still-open panel from the previous tab after switching tabs', () => {
    function Page({ url }: { url: string }) {
      const [open] = React.useState(url === '/a')
      return <PageSidePanel open={open} onClose={() => {}} title={`panel ${url}`} />
    }
    knobs.renderPage = (url) => <Page url={url} />

    function Shell({ activeId }: { activeId: string }) {
      return (
        <main>
          <TabRouter tab={tab('a', '/a')} isActive={activeId === 'a'} onUrlChange={() => {}} />
          <TabRouter tab={tab('b', '/b')} isActive={activeId === 'b'} onUrlChange={() => {}} />
        </main>
      )
    }

    const { rerender } = render(<Shell activeId="a" />)

    let roots = document.querySelectorAll('[data-page-side-panel-root="true"]')
    expect(roots).toHaveLength(1)
    const aRoot = roots[0] as HTMLElement
    expect(aRoot.querySelector('[role="dialog"]')).toBeInTheDocument()

    rerender(<Shell activeId="b" />)

    roots = document.querySelectorAll('[data-page-side-panel-root="true"]')
    expect(roots).toHaveLength(1)
    expect(roots[0]).not.toBe(aRoot)

    expect(aRoot.querySelector('[role="dialog"]')).toBeInTheDocument()
    expect(aRoot.style.display).toBe('none')
    expect(roots[0].querySelector('[role="dialog"]')).not.toBeInTheDocument()
  })
})

describe('TabRouter', () => {
  it('provides the tab root as scoped portal containers', async () => {
    render(
      <TabRouter
        tab={{
          id: 'translate-tab',
          type: 'route',
          url: '/app/translate',
          title: 'Translate',
          lastAccessTime: 1,
          isDormant: false
        }}
        isActive
        onUrlChange={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(screen.getByTestId('router-provider')).toHaveAttribute('data-has-portal-container', 'true')
    )
    expect(screen.getByTestId('router-provider')).toHaveAttribute('data-portal-container-is-body', 'false')
    expect(screen.getByTestId('portal-container-provider')).toHaveAttribute('data-has-portal-container', 'true')
    expect(screen.getByTestId('portal-container-provider')).toHaveAttribute('data-portal-container-is-body', 'false')
  })

  it('uses the tab entry URL even when instance metadata points to another key', () => {
    render(
      <TabRouter
        tab={{
          id: 'chat-tab',
          type: 'route',
          url: '/app/chat?topicId=entry-topic',
          title: 'Chat',
          metadata: {
            instanceAppId: 'assistants',
            instanceKey: 'current-topic'
          },
          lastAccessTime: 1,
          isDormant: false
        }}
        isActive
        onUrlChange={vi.fn()}
      />
    )

    expect(createMemoryHistory).toHaveBeenCalledWith({ initialEntries: ['/app/chat?topicId=entry-topic'] })
    expect(routerMocks.navigate).not.toHaveBeenCalled()
  })

  it('uses the tab entry URL when metadata belongs to a different app route', () => {
    render(
      <TabRouter
        tab={{
          id: 'settings-tab',
          type: 'route',
          url: '/settings/provider',
          title: 'Settings',
          metadata: {
            instanceAppId: 'assistants',
            instanceKey: 'old-topic'
          },
          lastAccessTime: 1,
          isDormant: false
        }}
        isActive
        onUrlChange={vi.fn()}
      />
    )

    expect(createMemoryHistory).toHaveBeenCalledWith({ initialEntries: ['/settings/provider'] })
  })

  it('navigates when the tab entry URL changes externally', () => {
    const { rerender } = render(
      <TabRouter
        tab={{
          id: 'chat-tab',
          type: 'route',
          url: '/app/chat?topicId=entry-topic',
          title: 'Chat',
          lastAccessTime: 1,
          isDormant: false
        }}
        isActive
        onUrlChange={vi.fn()}
      />
    )
    routerMocks.navigate.mockClear()

    rerender(
      <TabRouter
        tab={{
          id: 'chat-tab',
          type: 'route',
          url: '/app/chat?topicId=current-topic',
          title: 'Chat',
          metadata: {
            instanceAppId: 'assistants',
            instanceKey: 'current-topic'
          },
          lastAccessTime: 1,
          isDormant: false
        }}
        isActive
        onUrlChange={vi.fn()}
      />
    )

    expect(createMemoryHistory).toHaveBeenCalledTimes(1)
    expect(routerMocks.navigate).toHaveBeenCalledWith({ to: '/app/chat?topicId=current-topic' })
  })
})
