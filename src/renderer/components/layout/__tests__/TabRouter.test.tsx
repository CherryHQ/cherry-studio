// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

// Import the real component from its source path: the `@cherrystudio/ui` barrel
// is globally mocked for renderer tests, but this deeper specifier is not.
import { PageSidePanel } from '@cherrystudio/ui/components/composites/page-side-panel'
import { Combobox } from '@cherrystudio/ui/components/primitives/combobox'
import { Dialog, DialogContent } from '@cherrystudio/ui/components/primitives/dialog'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const knobs = vi.hoisted(() => ({
  renderPage: (() => null) as (url: string) => React.ReactNode
}))

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  subscribe: vi.fn(() => vi.fn())
}))

// PageSidePanel scopes to its owning tab by reading the SAME PortalContainerContext that
// TabRouter's provider sets. PageSidePanel pulls the hook from the deep path while TabRouter
// pulls the provider from the barrel; mock the deep path to the real module so every importer
// resolves to one context instance, then re-export it from the barrel (otherwise the global
// @cherrystudio/ui stub shadows it).
vi.mock('@cherrystudio/ui/components/primitives/portal-container', async (importOriginal) => importOriginal())
vi.mock('@cherrystudio/ui', async () => {
  const { DialogPortalContainerProvider, PortalContainerProvider, usePortalContainer } = await import(
    '@cherrystudio/ui/components/primitives/portal-container'
  )
  return { DialogPortalContainerProvider, PortalContainerProvider, usePortalContainer }
})

vi.mock('@renderer/routeTree.gen', () => ({ routeTree: {} }))

// Stub the router so TabRouter can mount without the real route tree. Each tab's history
// carries its url so the injected page can tell tabs apart, and the provider exposes the
// resolved portal container for the scoping assertions.
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
          data-router-url={router.state.location.href}
          data-has-portal-container={String(container instanceof HTMLElement)}
          data-portal-container-is-body={String(container === document.body)}>
          {knobs.renderPage(router.state.location.href)}
        </div>
      )
    }
  }
})

import { RouteErrorFallback } from '../RouteErrorFallback'
import { TabRouter } from '../TabRouter'

const tab = (id: string, url: string): Tab => ({ id, url, title: url, type: 'route' }) as Tab

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  knobs.renderPage = () => null
  vi.clearAllMocks()
})

describe('TabRouter route error containment wiring', () => {
  it('wires RouteErrorFallback as the router defaultErrorComponent', () => {
    render(<TabRouter tab={tab('a', '/a')} isActive onUrlChange={() => {}} />)

    expect(vi.mocked(createRouter)).toHaveBeenCalledWith(
      expect.objectContaining({ defaultErrorComponent: RouteErrorFallback })
    )
  })
})

describe('TabRouter portal container', () => {
  it('provides the tab root as a scoped portal container, not document.body', async () => {
    render(<TabRouter tab={tab('a', '/a')} isActive onUrlChange={() => {}} />)

    await waitFor(() =>
      expect(screen.getByTestId('router-provider')).toHaveAttribute('data-has-portal-container', 'true')
    )
    expect(screen.getByTestId('router-provider')).toHaveAttribute('data-portal-container-is-body', 'false')
  })
})

describe('TabRouter PageSidePanel portal isolation', () => {
  function Page({ url }: { url: string }) {
    const [open] = React.useState(url === '/b')
    return <PageSidePanel open={open} onClose={() => {}} title={`panel ${url}`} />
  }

  function Shell({ activeId }: { activeId: string }) {
    return (
      <main>
        <TabRouter tab={tab('a', '/a')} isActive={activeId === 'a'} onUrlChange={() => {}} />
        <TabRouter tab={tab('b', '/b')} isActive={activeId === 'b'} onUrlChange={() => {}} />
      </main>
    )
  }

  // The real PortalContainerProvider renders no DOM, so each router-provider's parent IS the
  // owning tab's content root — the element the panel portals into.
  const tabRoot = (url: string) =>
    document.querySelector<HTMLElement>(`[data-router-url="${url}"]`)?.parentElement as HTMLElement

  // Core regression: a background tab's open panel must never surface inside the active tab.
  // Open b's panel while b is active so b captures its own root, then switch to a.
  it('keeps a panel opened on the active tab scoped to that tab after switching away', async () => {
    knobs.renderPage = (url) => <Page url={url} />

    const { rerender } = render(<Shell activeId="b" />)
    const aRoot = tabRoot('/a')
    const bRoot = tabRoot('/b')
    expect(aRoot).toBeInstanceOf(HTMLElement)
    expect(bRoot).toBeInstanceOf(HTMLElement)
    await waitFor(() => expect(bRoot.querySelector('[role="dialog"]')).toBeInTheDocument())

    rerender(<Shell activeId="a" />)

    // b's panel stays in b's now-hidden root; it never migrates to active a.
    expect(bRoot.querySelector('[role="dialog"]')).toBeInTheDocument()
    expect(bRoot.style.display).toBe('none')
    expect(aRoot.querySelector('[role="dialog"]')).not.toBeInTheDocument()
  })

  it('keeps a Dialog opened on the active tab scoped to that tab after switching away', async () => {
    function PageWithDialog({ url }: { url: string }) {
      const [open] = React.useState(url === '/b')
      return (
        <Dialog open={open}>
          <DialogContent data-testid="test-dialog-content">Dialog {url}</DialogContent>
        </Dialog>
      )
    }

    knobs.renderPage = (url) => <PageWithDialog url={url} />

    const { rerender } = render(<Shell activeId="b" />)
    const aRoot = tabRoot('/a')
    const bRoot = tabRoot('/b')
    expect(aRoot).toBeInstanceOf(HTMLElement)
    expect(bRoot).toBeInstanceOf(HTMLElement)

    await waitFor(() => expect(screen.getByTestId('test-dialog-content')).toBeInTheDocument())

    rerender(<Shell activeId="a" />)

    // b's dialog stays in b's now-hidden root; it never migrates to active a.
    expect(bRoot.querySelector('[data-testid="test-dialog-content"]')).toBeInTheDocument()
    expect(bRoot.style.display).toBe('none')
    expect(aRoot.querySelector('[data-testid="test-dialog-content"]')).not.toBeInTheDocument()
  })

  it('keeps a trigger-search Combobox anchored after switching away and back', async () => {
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      if (this.matches('[data-slot="popover-anchor"]'))
        return DOMRect.fromRect({ x: 120, y: 40, width: 260, height: 36 })
      if (this.matches('[role="combobox"]')) return DOMRect.fromRect({ x: 120, y: 40, width: 100, height: 36 })
      return DOMRect.fromRect({ x: 0, y: 0, width: 100, height: 40 })
    })

    function PageWithCombobox({ url }: { url: string }) {
      if (url !== '/b') return null

      return (
        <Combobox
          options={[
            { value: 'alpha', label: 'Alpha' },
            { value: 'beta', label: 'Beta' }
          ]}
          searchPlacement="trigger"
          placeholder="Choose font"
          emptyText="No fonts"
        />
      )
    }

    const anchorWidth = (root: HTMLElement) =>
      root
        .querySelector<HTMLElement>('[data-slot="popover-content"]')
        ?.parentElement?.style.getPropertyValue('--radix-popper-anchor-width')

    try {
      knobs.renderPage = (url) => <PageWithCombobox url={url} />

      const { rerender } = render(<Shell activeId="b" />)
      const bRoot = tabRoot('/b')
      const trigger = screen.getByRole('combobox')

      fireEvent.click(trigger)
      await waitFor(() => expect(anchorWidth(bRoot)).toBe('260px'))

      fireEvent.keyDown(trigger, { key: 'Escape' })
      await waitFor(() => expect(bRoot.querySelector('[data-slot="popover-content"]')).not.toBeInTheDocument())

      rerender(<Shell activeId="a" />)
      rerender(<Shell activeId="b" />)

      fireEvent.click(screen.getByRole('combobox'))
      await waitFor(() => expect(anchorWidth(bRoot)).toBe('260px'))
    } finally {
      rectSpy.mockRestore()
    }
  })
})

describe('TabRouter', () => {
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
