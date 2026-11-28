// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { useNavigate } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// Import the real component from its source path: the `@cherrystudio/ui` barrel
// is globally mocked for renderer tests, but this deeper specifier is not.
import { PageSidePanel } from '@cherrystudio/ui/components/composites/page-side-panel'
import { Combobox } from '@cherrystudio/ui/components/primitives/combobox'
import { Dialog, DialogContent } from '@cherrystudio/ui/components/primitives/dialog'
import { TabsContext, type TabsContextValue, useIsActiveTab } from '@renderer/hooks/tab'
import type { Tab } from '@shared/data/cache/cacheValueTypes'

const knobs = vi.hoisted(() => ({
  renderPage: (() => null) as (url: string) => React.ReactNode,
  pending: undefined as Promise<void> | undefined
}))

// PageSidePanel scopes to its owning tab by reading the SAME PortalContainerContext that
// TabRouter's provider sets. PageSidePanel pulls the hook from the deep path while TabRouter
// pulls the provider from the barrel; mock the deep path to the real module so every importer
// resolves to one context instance, then re-export it from the barrel (otherwise the global
// @cherrystudio/ui stub shadows it).
vi.mock('@cherrystudio/ui/components/primitives/portal-container', async (importOriginal) => importOriginal())
vi.mock('@cherrystudio/ui', async () => {
  const { DialogPortalContainerProvider, PortalContainerProvider, usePortalContainer } =
    await import('@cherrystudio/ui/components/primitives/portal-container')
  return { DialogPortalContainerProvider, PortalContainerProvider, usePortalContainer }
})

vi.mock('@renderer/routeTree.gen', async () => {
  const { createRootRoute, createRoute, useLocation } = await import('@tanstack/react-router')
  const { usePortalContainer } = await import('@cherrystudio/ui')
  function Page() {
    const { href } = useLocation()
    const container = usePortalContainer()
    return (
      <div
        data-testid="router-provider"
        data-router-url={href}
        data-has-portal-container={String(container instanceof HTMLElement)}
        data-portal-container-is-body={String(container === document.body)}>
        {knobs.renderPage(href)}
      </div>
    )
  }
  const root = createRootRoute()
  const routes = ['/a', '/b', '/app/chat', '/app/agents', '/app/mini-app/$appId'].map((path) =>
    createRoute({
      getParentRoute: () => root,
      path,
      component: Page,
      validateSearch: (search) => search,
      beforeLoad: () => (path === '/app/agents' ? knobs.pending : undefined)
    })
  )
  return { routeTree: root.addChildren(routes) }
})

import { TabRouter } from '../TabRouter'

const tab = (id: string, url: string, overrides: Partial<Tab> = {}): Tab => ({
  id,
  url,
  title: url,
  type: 'route',
  ...overrides
})

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView = vi.fn()
  window.scrollTo = vi.fn()
})

afterEach(() => {
  cleanup()
  knobs.renderPage = () => null
  knobs.pending = undefined
  vi.clearAllMocks()
})

describe('TabRouter PageSidePanel portal isolation', () => {
  function Page({ url }: { url: string }) {
    const [open] = React.useState(url === '/b')
    return <PageSidePanel open={open} onClose={() => {}} title={`panel ${url}`} />
  }

  function Shell({ activeId }: { activeId: string }) {
    return (
      <main>
        <section aria-label="Tab A">
          <TabRouter tab={tab('a', '/a')} isActive={activeId === 'a'} onUrlChange={() => {}} />
        </section>
        <section aria-label="Tab B">
          <TabRouter tab={tab('b', '/b')} isActive={activeId === 'b'} onUrlChange={() => {}} />
        </section>
      </main>
    )
  }

  // The content root exists even before a hidden tab's router has loaded its page.
  const tabRoot = (url: string) =>
    screen.getByLabelText(url === '/a' ? 'Tab A' : 'Tab B').firstElementChild as HTMLElement

  // Core regression: a background tab's open panel must never surface inside the active tab.
  // Open b's panel while b is active so b captures its own root, then switch to a.
  it('keeps a panel opened on the active tab scoped to that tab after switching away', async () => {
    knobs.renderPage = (url) => <Page url={url} />

    const { rerender } = render(<Shell activeId="b" />)
    await waitFor(() => expect(tabRoot('/a')).toBeInstanceOf(HTMLElement))
    await waitFor(() => expect(tabRoot('/b')).toBeInstanceOf(HTMLElement))
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
    await waitFor(() => expect(tabRoot('/a')).toBeInstanceOf(HTMLElement))
    await waitFor(() => expect(tabRoot('/b')).toBeInstanceOf(HTMLElement))
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
    const rectSpy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
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
      await waitFor(() => expect(tabRoot('/b')).toBeInstanceOf(HTMLElement))
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
  it('keeps internal navigation interactive while its tab URL is being persisted', async () => {
    function NavigatePage() {
      const navigate = useNavigate()
      return (
        <button type="button" onClick={() => void navigate({ to: '/app/chat' })}>
          Navigate internally
        </button>
      )
    }
    knobs.renderPage = () => <NavigatePage />
    const onUrlChange = vi.fn()
    const { rerender } = render(<TabRouter tab={tab('route-tab', '/a')} isActive onUrlChange={onUrlChange} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Navigate internally' }))
    await waitFor(() => expect(screen.getByTestId('router-provider')).toHaveAttribute('data-router-url', '/app/chat'))
    expect(screen.queryByTestId('tab-route-transition-cover')).not.toBeInTheDocument()
    rerender(<TabRouter tab={tab('route-tab', '/app/chat')} isActive onUrlChange={onUrlChange} />)
    expect(screen.queryByTestId('tab-route-transition-cover')).not.toBeInTheDocument()
  })

  it('shows the latest external-store value after a hidden tab becomes visible', async () => {
    let targetLanguage = 'en'
    const listeners = new Set<() => void>()
    const subscribe = (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
    const getSnapshot = () => targetLanguage

    function TargetLanguage() {
      const value = React.useSyncExternalStore(subscribe, getSnapshot)
      const [revision, setRevision] = React.useState(0)
      return (
        <>
          <button type="button" onClick={() => setRevision((value) => value + 1)}>
            Rerender reader
          </button>
          <p role="status" data-revision={revision}>
            Target language: {value}
          </p>
        </>
      )
    }

    knobs.renderPage = () => <TargetLanguage />
    const currentTab = tab('store-tab', '/a')
    const onUrlChange = vi.fn()
    const { rerender } = render(<TabRouter tab={currentTab} isActive onUrlChange={onUrlChange} />)

    expect(await screen.findByRole('status')).toHaveTextContent('Target language: en')
    fireEvent.click(screen.getByRole('button', { name: 'Rerender reader' }))
    expect(screen.getByRole('status')).toHaveAttribute('data-revision', '1')

    rerender(<TabRouter tab={currentTab} isActive={false} onUrlChange={onUrlChange} />)
    act(() => {
      targetLanguage = 'ko'
      listeners.forEach((listener) => listener())
    })
    rerender(<TabRouter tab={currentTab} isActive onUrlChange={onUrlChange} />)

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Target language: ko'))
  })

  it('uses the tab entry URL as the initial history entry', async () => {
    render(
      <TabRouter
        tab={tab('chat-tab', '/app/chat?topicId=entry-topic', {
          title: 'Chat',
          lastAccessTime: 1,
          isDormant: false
        })}
        isActive
        onUrlChange={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(screen.getByTestId('router-provider')).toHaveAttribute('data-router-url', '/app/chat?topicId=entry-topic')
    )
  })

  it('navigates when the tab entry URL changes externally', async () => {
    const { rerender } = render(
      <TabRouter
        tab={tab('chat-tab', '/app/chat?topicId=entry-topic', {
          title: 'Chat',
          lastAccessTime: 1,
          isDormant: false
        })}
        isActive
        onUrlChange={vi.fn()}
      />
    )
    await screen.findByTestId('router-provider')

    rerender(
      <TabRouter
        tab={tab('chat-tab', '/app/chat?topicId=current-topic', {
          title: 'Chat',
          lastAccessTime: 1,
          isDormant: false
        })}
        isActive
        onUrlChange={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(screen.getByTestId('router-provider')).toHaveAttribute(
        'data-router-url',
        '/app/chat?topicId=current-topic'
      )
    )
  })

  it('navigates from a bound session to an external Agent entry', async () => {
    const { rerender } = render(
      <TabRouter
        tab={tab('agents-tab', '/app/agents?sessionId=directory-session', {
          title: 'Work',
          lastAccessTime: 1,
          isDormant: false
        })}
        isActive
        onUrlChange={vi.fn()}
      />
    )
    await screen.findByTestId('router-provider')

    rerender(
      <TabRouter
        tab={tab('agents-tab', '/app/agents?agentId=agent-1', {
          title: 'Code Reviewer',
          lastAccessTime: 1,
          isDormant: false
        })}
        isActive
        onUrlChange={vi.fn()}
      />
    )

    await waitFor(() =>
      expect(screen.getByTestId('router-provider')).toHaveAttribute('data-router-url', '/app/agents?agentId=agent-1')
    )
  })

  it('quietly covers the outgoing page while an external retarget is unresolved', async () => {
    const { rerender } = render(
      <TabRouter tab={tab('route-tab', '/app/mini-app/claude')} isActive onUrlChange={() => {}} />
    )

    await screen.findByTestId('router-provider')
    let resolve!: () => void
    knobs.pending = new Promise<void>((done) => {
      resolve = done
    })

    rerender(<TabRouter tab={tab('route-tab', '/app/agents')} isActive onUrlChange={() => {}} />)

    expect(screen.getByTestId('tab-route-transition-cover')).toHaveClass('bg-card')
    expect(screen.queryByText('Loading destination')).not.toBeInTheDocument()

    await act(async () => resolve())
    await waitFor(() => expect(screen.queryByTestId('tab-route-transition-cover')).not.toBeInTheDocument())
    expect(screen.getByTestId('router-provider')).toHaveAttribute('data-router-url', '/app/agents')
  })
})

describe('TabRouter primary route keep-alive', () => {
  function RouteStateProbe({ label }: { label: string }) {
    const [count, setCount] = React.useState(0)
    const isActiveTab = useIsActiveTab()
    return (
      <div data-testid={`probe-${label}`} data-active-tab={String(isActiveTab)} data-count={count}>
        <button type="button" onClick={() => setCount((c) => c + 1)}>
          Increment {label}
        </button>
      </div>
    )
  }

  it('keeps /app/chat and /app/agents mounted via Activity and restores slot URL on bare revisit', async () => {
    knobs.renderPage = (url) => {
      if (url.startsWith('/app/chat')) return <RouteStateProbe label="chat" />
      if (url.startsWith('/app/agents')) return <RouteStateProbe label="agents" />
      return null
    }
    const onUrlChange = vi.fn()
    const { container, rerender } = render(
      <TabRouter tab={tab('main-tab', '/app/chat?topicId=t1')} isActive onUrlChange={onUrlChange} />
    )

    const chatIncButton = await screen.findByRole('button', { name: 'Increment chat' })
    fireEvent.click(chatIncButton)
    expect(screen.getByTestId('probe-chat')).toHaveAttribute('data-count', '1')

    rerender(<TabRouter tab={tab('main-tab', '/app/agents?sessionId=s1')} isActive onUrlChange={onUrlChange} />)
    const agentsIncButton = await screen.findByRole('button', { name: 'Increment agents' })
    fireEvent.click(agentsIncButton)
    expect(screen.getByTestId('probe-agents')).toHaveAttribute('data-count', '1')

    // Chat slot remains mounted with preserved state and display:none
    const chatSlotRoot = container.querySelector('[data-testid="probe-chat"]')?.closest('[class*="relative"]') as
      | HTMLElement
      | undefined
    expect(chatSlotRoot?.style.display).toBe('none')

    // Bare `/app/chat` click restores `/app/chat?topicId=t1` without recreating state or flashing cover
    onUrlChange.mockClear()
    rerender(<TabRouter tab={tab('main-tab', '/app/chat')} isActive onUrlChange={onUrlChange} />)

    await waitFor(() => expect(onUrlChange).toHaveBeenCalledWith('/app/chat?topicId=t1'))
    expect(screen.queryByTestId('tab-route-transition-cover')).not.toBeInTheDocument()
    expect(screen.getByTestId('probe-chat')).toHaveAttribute('data-count', '1')
    expect(chatSlotRoot?.style.display).not.toBe('none')
  })

  it('isolates useIsActiveTab() and PageSidePanel portals across keep-alive route slots in the same tab', async () => {
    function SlotPage({ url }: { url: string }) {
      const isChat = url.startsWith('/app/chat')
      const [open] = React.useState(isChat)
      return (
        <>
          <RouteStateProbe label={isChat ? 'chat' : 'agents'} />
          {open && <PageSidePanel open onClose={() => {}} title={`panel ${url}`} />}
        </>
      )
    }

    knobs.renderPage = (url) => <SlotPage url={url} />
    const renderWithTabs = (url: string) => {
      const current = tab('main-tab', url)
      const value = { tabs: [current], activeTabId: 'main-tab', activeTab: current } as unknown as TabsContextValue
      return (
        <TabsContext value={value}>
          <TabRouter tab={current} isActive onUrlChange={() => {}} />
        </TabsContext>
      )
    }

    const { container, rerender } = render(renderWithTabs('/app/chat?topicId=t1'))
    await waitFor(() => expect(screen.getByTestId('probe-chat')).toHaveAttribute('data-active-tab', 'true'))
    await waitFor(() => expect(container.querySelector('[role="dialog"]')).toBeInTheDocument())

    rerender(renderWithTabs('/app/agents?sessionId=s1'))
    await waitFor(() => expect(screen.getByTestId('probe-agents')).toHaveAttribute('data-active-tab', 'true'))
    expect(screen.getByTestId('probe-chat')).toHaveAttribute('data-active-tab', 'false')

    const agentsSlotRoot = screen.getByTestId('probe-agents').closest('[class*="relative"]') as HTMLElement
    const chatSlotRoot = screen.getByTestId('probe-chat').closest('[class*="relative"]') as HTMLElement
    expect(chatSlotRoot.style.display).toBe('none')
    expect(chatSlotRoot.querySelector('[role="dialog"]')).toBeInTheDocument()
    expect(agentsSlotRoot.querySelector('[role="dialog"]')).not.toBeInTheDocument()
  })

  it('navigates an already-mounted keep-alive slot when given an explicit target query URL', async () => {
    knobs.renderPage = (url) => <div data-testid="page-url">{url}</div>
    const { rerender } = render(
      <TabRouter tab={tab('main-tab', '/app/chat?topicId=t1')} isActive onUrlChange={() => {}} />
    )
    await waitFor(() => expect(screen.getByTestId('page-url')).toHaveTextContent('/app/chat?topicId=t1'))

    rerender(<TabRouter tab={tab('main-tab', '/app/agents?sessionId=s1')} isActive onUrlChange={() => {}} />)
    await screen.findByText('/app/agents?sessionId=s1')

    rerender(<TabRouter tab={tab('main-tab', '/app/chat?topicId=t2')} isActive onUrlChange={() => {}} />)
    await waitFor(() => expect(screen.getByText('/app/chat?topicId=t2')).toBeInTheDocument())
  })
})
