// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

// Import the real component from its source path: the `@cherrystudio/ui` barrel
// is globally mocked for renderer tests, but this deeper specifier is not.
import { PageSidePanel } from '@cherrystudio/ui/components/composites/page-side-panel'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { cleanup, render } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const knobs = vi.hoisted(() => ({
  isMac: false,
  renderPage: (() => null) as (url: string) => React.ReactNode
}))

vi.mock('@renderer/config/constant', () => ({
  get isMac() {
    return knobs.isMac
  }
}))

vi.mock('@renderer/routeTree.gen', () => ({ routeTree: {} }))

// Stub the router so TabRouter can mount without the real route tree. Each tab's
// history carries its url so the injected page can tell tabs apart.
vi.mock('@tanstack/react-router', () => ({
  createMemoryHistory: ({ initialEntries }: { initialEntries: string[] }) => ({ __url: initialEntries?.[0] ?? '/' }),
  createRouter: ({ history }: { history: { __url: string } }) => ({
    __url: history.__url,
    subscribe: () => () => {},
    navigate: vi.fn(),
    state: { location: { href: history.__url } }
  }),
  RouterProvider: ({ router }: { router: { __url: string } }) => knobs.renderPage(router.__url)
}))

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
