// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { SidebarAppId } from '@renderer/utils/sidebar'
import type { SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pinnedMiniApps: [] as any[],
  openedMiniApps: [] as any[],
  reorderMiniAppsByStatus: vi.fn(() => Promise.resolve()),
  setSidebarFavorites: vi.fn(() => Promise.resolve()),
  sidebarFavorites: [{ type: 'app', id: 'assistants' }] as SidebarFavoriteItem[],
  setAppOrder: vi.fn(() => Promise.resolve()),
  appOrder: [] as SidebarAppId[],
  sortableCalls: [] as any[]
}))

vi.mock('@cherrystudio/ui', () => ({
  Sortable: ({ items, itemKey, renderItem, ...props }: any) => {
    mocks.sortableCalls.push({ items, itemKey, renderItem, ...props })
    const getKey = typeof itemKey === 'function' ? itemKey : (item: any) => item[itemKey]

    return (
      <div data-testid={`sortable-${String(itemKey)}`}>
        {items.map((item: any) => (
          <div key={getKey(item)}>{renderItem(item, { dragging: false, overlay: false })}</div>
        ))}
      </div>
    )
  }
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'feature.paintings.default_provider') return ['zhipu', vi.fn()]
    if (key === 'ui.launchpad.app_order') return [mocks.appOrder, mocks.setAppOrder]
    return [mocks.sidebarFavorites, mocks.setSidebarFavorites]
  }
}))

vi.mock('@renderer/components/icons/SvgIcon', () => ({
  OpenClawSidebarIcon: (props: React.ComponentProps<'svg'>) => <svg aria-hidden="true" {...props} />
}))

vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({
    children,
    extraItems
  }: {
    children: ReactNode
    extraItems?: Array<{ type: string; id: string; label: string; enabled?: boolean; onSelect?: () => void }>
  }) => (
    <div>
      {children}
      {extraItems?.map((item) =>
        item.type === 'item' ? (
          <button
            data-testid={`menu-${item.id}`}
            disabled={item.enabled === false}
            key={item.id}
            onClick={item.onSelect}
            type="button">
            {item.label}
          </button>
        ) : null
      )}
    </div>
  )
}))

vi.mock('@renderer/components/MiniApp/MiniApp', () => ({
  default: ({ app, onOpen }: { app: { appId: string; name: string }; onOpen?: (app: any) => void }) => (
    <button type="button" onClick={() => onOpen?.(app)}>
      {app.name}
    </button>
  )
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  )
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    openedKeepAliveMiniApps: mocks.openedMiniApps,
    pinned: mocks.pinnedMiniApps,
    reorderMiniAppsByStatus: mocks.reorderMiniAppsByStatus
  })
}))

vi.mock('@renderer/i18n/label', () => ({
  getSidebarIconLabelKey: (key: SidebarAppId) =>
    ({
      assistants: 'Chat',
      agents: 'Agent',
      store: 'Library',
      paintings: 'Paintings',
      translate: 'Translate',
      mini_app: 'Mini Apps',
      knowledge: 'Knowledge',
      files: 'Files',
      code_tools: 'Code',
      notes: 'Notes',
      openclaw: 'OpenClaw'
    })[key]
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) => {
      const label =
        {
          'agent.sidebar_title': 'Agent',
          'agent.session.group.conversation': 'Chat',
          'assistants.presets.title': 'Library',
          'code.title': 'Code',
          'files.title': 'Files',
          'knowledge.title': 'Knowledge',
          'launchpad.apps': 'Apps',
          'launchpad.miniApps': 'Mini Apps',
          'launchpad.pin_to_sidebar': 'Add to Sidebar',
          'launchpad.unpin_from_sidebar': 'Remove from Sidebar',
          'miniApp.title': 'Mini Apps',
          'notes.title': 'Notes',
          'openclaw.title': 'OpenClaw',
          'paintings.title': 'Paintings',
          'title.launchpad': 'Launchpad',
          'translate.title': 'Translate'
        }[key] ??
        options?.defaultValue ??
        key

      return label.replace('{{name}}', options?.name ?? 'Agent')
    }
  })
}))

import LaunchpadPage from '../LaunchpadPage'

const appFavorite = (id: SidebarAppId): SidebarFavoriteItem => ({ type: 'app', id })
const miniAppFavorite = (id: string): SidebarFavoriteItem => ({ type: 'mini_app', id })

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.sortableCalls.length = 0
})

describe('LaunchpadPage', () => {
  beforeEach(() => {
    mocks.pinnedMiniApps = []
    mocks.openedMiniApps = []
    mocks.sidebarFavorites = [appFavorite('assistants')]
    mocks.appOrder = []
    mocks.sortableCalls.length = 0
    mocks.setSidebarFavorites.mockResolvedValue(undefined)
    mocks.setAppOrder.mockResolvedValue(undefined)
    mocks.reorderMiniAppsByStatus.mockResolvedValue(undefined)
  })

  it('renders the launchpad page chrome and app grid', () => {
    render(<LaunchpadPage />)

    expect(screen.getByRole('heading', { name: 'Apps' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Chat' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Knowledge' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument()
  })

  it('keeps the launchpad grid at the original compact density', () => {
    mocks.pinnedMiniApps = [
      {
        appId: 'calculator',
        name: 'Calculator',
        logo: 'calc-logo',
        url: 'https://example.com',
        presetMiniAppId: 'calculator',
        status: 'pinned',
        orderKey: ''
      }
    ]

    render(<LaunchpadPage />)

    const appsHeading = screen.getByRole('heading', { name: 'Apps' })
    const appsGrid = appsHeading.nextElementSibling
    const miniAppsGrid = screen.getByRole('heading', { name: 'Mini Apps' }).nextElementSibling
    const content = appsHeading.closest('section')?.parentElement

    expect(content).toHaveClass('max-w-180', 'gap-5')
    expect(appsGrid).toHaveClass('grid-cols-6', 'justify-items-center', 'gap-2', 'px-2')
    expect(appsGrid).not.toHaveClass('gap-x-14', 'gap-y-8')
    expect(miniAppsGrid).toHaveClass('grid-cols-6', 'justify-items-center', 'gap-2', 'px-2')
    expect(screen.getByRole('button', { name: 'Chat' })).toHaveClass('mx-auto', 'w-[92px]')
    expect(screen.getByRole('button', { name: 'Calculator' }).parentElement).toHaveClass(
      'mx-auto',
      'w-[92px]',
      'justify-center'
    )
  })

  it('orders app tiles by the launchpad app order, appending the rest canonically', () => {
    // Launchpad app order is independent of the sidebar favorites order.
    mocks.appOrder = ['translate', 'assistants', 'agents']
    mocks.sidebarFavorites = [appFavorite('assistants')]

    render(<LaunchpadPage />)

    const appLabels = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((label): label is string =>
        [
          'Translate',
          'Chat',
          'Agent',
          'Paintings',
          'Library',
          'Mini Apps',
          'Knowledge',
          'Files',
          'Code',
          'Notes',
          'OpenClaw'
        ].includes(label ?? '')
      )

    expect(appLabels.slice(0, 4)).toEqual(['Translate', 'Chat', 'Agent', 'Paintings'])
  })

  it('sorts every app tile and persists to the launchpad app order, not the sidebar favorites', () => {
    mocks.appOrder = ['translate', 'assistants', 'agents']

    render(<LaunchpadPage />)

    const systemSortable = mocks.sortableCalls.find((call) => call.itemKey === 'id')

    // Every renderable app is in a single sortable (stored order first, canonical rest).
    expect(systemSortable.items.map((item: { id: string }) => item.id).slice(0, 3)).toEqual([
      'translate',
      'assistants',
      'agents'
    ])

    act(() => {
      systemSortable.onSortEnd({ oldIndex: 0, newIndex: 2 })
    })

    const [persisted] = mocks.setAppOrder.mock.calls.at(-1) as unknown as [SidebarAppId[]]
    expect(persisted.slice(0, 3)).toEqual(['assistants', 'agents', 'translate'])
    expect(persisted).toHaveLength(systemSortable.items.length)
    expect(mocks.setSidebarFavorites).not.toHaveBeenCalled()
  })

  it('navigates apps inside the current launchpad tab', async () => {
    const user = userEvent.setup()

    render(<LaunchpadPage />)

    await user.click(screen.getByRole('button', { name: 'Knowledge' }))

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/knowledge' })
  })

  it('suppresses only the dragged launchpad item click', () => {
    render(<LaunchpadPage />)

    const systemSortable = mocks.sortableCalls.find((call) => call.itemKey === 'id')
    act(() => {
      systemSortable.onDragStart({ active: { id: 'knowledge' } })
    })

    fireEvent.click(screen.getByRole('button', { name: 'Knowledge' }))
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }))

    expect(mocks.navigate).toHaveBeenCalledTimes(1)
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/chat' })
  })

  it('opens chat and agent apps fresh in the current tab', async () => {
    const user = userEvent.setup()

    render(<LaunchpadPage />)

    await user.click(screen.getByRole('button', { name: 'Chat' }))
    await user.click(screen.getByRole('button', { name: 'Agent' }))

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/chat' })
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/agents' })
  })

  it('navigates concrete mini apps inside the current launchpad tab', async () => {
    const user = userEvent.setup()
    mocks.pinnedMiniApps = [
      {
        appId: 'calculator',
        name: 'Calculator',
        logo: 'calc-logo',
        url: 'https://example.com',
        presetMiniAppId: 'calculator',
        status: 'pinned',
        orderKey: ''
      }
    ]

    render(<LaunchpadPage />)

    await user.click(screen.getByRole('button', { name: 'Calculator' }))

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/mini-app/calculator' })
  })

  it('sorts every pinned mini app by order key and persists to order keys, not favorites', () => {
    const calculator = {
      appId: 'calculator',
      name: 'Calculator',
      logo: 'calc-logo',
      url: 'https://example.com',
      presetMiniAppId: 'calculator',
      status: 'pinned',
      orderKey: 'a'
    }
    const docs = {
      appId: 'docs',
      name: 'Docs',
      logo: 'docs-logo',
      url: 'https://docs.example.com',
      presetMiniAppId: 'docs',
      status: 'pinned',
      orderKey: 'b'
    }
    // Order-key order is 'a' < 'b', regardless of the array order passed in.
    mocks.pinnedMiniApps = [docs, calculator]
    mocks.sidebarFavorites = [appFavorite('assistants')]

    render(<LaunchpadPage />)

    const miniAppSortable = mocks.sortableCalls.find((call) => call.itemKey === 'appId')

    expect(miniAppSortable.items.map((app: { appId: string }) => app.appId)).toEqual(['calculator', 'docs'])

    act(() => {
      miniAppSortable.onSortEnd({ oldIndex: 0, newIndex: 1 })
    })

    // The launchpad persists mini app order to the shared order key (independent of
    // the sidebar favorites), never writing `ui.sidebar.favorites`.
    expect(mocks.reorderMiniAppsByStatus).toHaveBeenCalledWith('pinned', [
      expect.objectContaining({ appId: 'docs' }),
      expect.objectContaining({ appId: 'calculator' })
    ])
    expect(mocks.setSidebarFavorites).not.toHaveBeenCalled()
  })

  it('holds the dropped mini app order optimistically before the data refetches', () => {
    const calculator = {
      appId: 'calculator',
      name: 'Calculator',
      logo: 'calc-logo',
      url: 'https://example.com',
      presetMiniAppId: 'calculator',
      status: 'pinned',
      orderKey: 'a'
    }
    const docs = {
      appId: 'docs',
      name: 'Docs',
      logo: 'docs-logo',
      url: 'https://docs.example.com',
      presetMiniAppId: 'docs',
      status: 'pinned',
      orderKey: 'b'
    }
    mocks.pinnedMiniApps = [calculator, docs]

    render(<LaunchpadPage />)

    act(() => {
      const miniAppSortable = mocks.sortableCalls.find((call) => call.itemKey === 'appId')
      miniAppSortable.onSortEnd({ oldIndex: 0, newIndex: 1 })
    })

    // Upstream `pinned` has NOT changed (no refetch yet); the sortable still shows
    // the dropped order from local optimistic state, so the tile never snaps back.
    const latestMiniAppSortable = mocks.sortableCalls.filter((call) => call.itemKey === 'appId').at(-1)
    expect(latestMiniAppSortable.items.map((app: { appId: string }) => app.appId)).toEqual(['docs', 'calculator'])
  })

  it('replaces the optimistic mini app order when the refreshed pinned set changes', async () => {
    const calculator = {
      appId: 'calculator',
      name: 'Calculator',
      logo: 'calc-logo',
      url: 'https://example.com',
      presetMiniAppId: 'calculator',
      status: 'pinned',
      orderKey: 'a'
    }
    const docs = {
      appId: 'docs',
      name: 'Docs',
      logo: 'docs-logo',
      url: 'https://docs.example.com',
      presetMiniAppId: 'docs',
      status: 'pinned',
      orderKey: 'b'
    }
    const weather = {
      appId: 'weather',
      name: 'Weather',
      logo: 'weather-logo',
      url: 'https://weather.example.com',
      presetMiniAppId: 'weather',
      status: 'pinned',
      orderKey: 'c'
    }
    mocks.pinnedMiniApps = [calculator, docs]

    const { rerender } = render(<LaunchpadPage />)

    act(() => {
      const miniAppSortable = mocks.sortableCalls.find((call) => call.itemKey === 'appId')
      miniAppSortable.onSortEnd({ oldIndex: 0, newIndex: 1 })
    })

    mocks.pinnedMiniApps = [docs, weather]
    rerender(<LaunchpadPage />)

    await waitFor(() => {
      const latestMiniAppSortable = mocks.sortableCalls.filter((call) => call.itemKey === 'appId').at(-1)
      expect(latestMiniAppSortable.items.map((app: { appId: string }) => app.appId)).toEqual(['docs', 'weather'])
    })
    expect(screen.queryByRole('button', { name: 'Calculator' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Weather' })).toBeInTheDocument()
  })

  it('preserves the dropped mini app items reference when refresh returns the same objects in the same order', async () => {
    const calculator = {
      appId: 'calculator',
      name: 'Calculator',
      logo: 'calc-logo',
      url: 'https://example.com',
      presetMiniAppId: 'calculator',
      status: 'pinned',
      orderKey: 'a'
    }
    const docs = {
      appId: 'docs',
      name: 'Docs',
      logo: 'docs-logo',
      url: 'https://docs.example.com',
      presetMiniAppId: 'docs',
      status: 'pinned',
      orderKey: 'b'
    }
    mocks.pinnedMiniApps = [calculator, docs]

    const { rerender } = render(<LaunchpadPage />)

    act(() => {
      const miniAppSortable = mocks.sortableCalls.find((call) => call.itemKey === 'appId')
      miniAppSortable.onSortEnd({ oldIndex: 0, newIndex: 1 })
    })

    const optimisticItems = mocks.sortableCalls.filter((call) => call.itemKey === 'appId').at(-1).items
    docs.orderKey = 'a'
    calculator.orderKey = 'b'
    mocks.pinnedMiniApps = [docs, calculator]
    rerender(<LaunchpadPage />)

    await waitFor(() => {
      const latestMiniAppSortable = mocks.sortableCalls.filter((call) => call.itemKey === 'appId').at(-1)
      expect(latestMiniAppSortable.items).toBe(optimisticItems)
    })
  })

  it('adopts fresh mini app objects when the order is unchanged', async () => {
    const calculator = {
      appId: 'calculator',
      name: 'Calculator',
      logo: 'calc-logo',
      url: 'https://example.com',
      presetMiniAppId: 'calculator',
      status: 'pinned',
      orderKey: 'a'
    }
    mocks.pinnedMiniApps = [calculator]

    const { rerender } = render(<LaunchpadPage />)

    expect(screen.getByRole('button', { name: 'Calculator' })).toBeInTheDocument()

    mocks.pinnedMiniApps = [{ ...calculator, name: 'Calculator Pro' }]
    rerender(<LaunchpadPage />)

    expect(await screen.findByRole('button', { name: 'Calculator Pro' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Calculator' })).not.toBeInTheDocument()
  })

  it('makes every pinned mini app sortable regardless of sidebar favorites', () => {
    const calculator = {
      appId: 'calculator',
      name: 'Calculator',
      logo: 'calc-logo',
      url: 'https://example.com',
      presetMiniAppId: 'calculator',
      status: 'pinned',
      orderKey: 'a'
    }
    const docs = {
      appId: 'docs',
      name: 'Docs',
      logo: 'docs-logo',
      url: 'https://docs.example.com',
      presetMiniAppId: 'docs',
      status: 'pinned',
      orderKey: 'b'
    }
    // Only calculator is pinned to the sidebar; docs is launchpad-pinned only —
    // both are still sortable in the launchpad.
    mocks.pinnedMiniApps = [calculator, docs]
    mocks.sidebarFavorites = [appFavorite('assistants'), miniAppFavorite('calculator')]

    render(<LaunchpadPage />)

    const miniAppSortable = mocks.sortableCalls.find((call) => call.itemKey === 'appId')

    expect(miniAppSortable.items.map((app: { appId: string }) => app.appId)).toEqual(['calculator', 'docs'])
    expect(screen.getByRole('button', { name: 'Calculator' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Docs' })).toBeInTheDocument()
  })

  it('shows only launchpad-pinned mini apps, excluding opened-but-unpinned ones', () => {
    const calculator = {
      appId: 'calculator',
      name: 'Calculator',
      logo: 'calc-logo',
      url: 'https://example.com',
      presetMiniAppId: 'calculator',
      status: 'pinned',
      orderKey: 'a'
    }
    const scratch = {
      appId: 'scratch',
      name: 'Scratch',
      logo: 'scratch-logo',
      url: 'https://scratch.example.com',
      presetMiniAppId: 'scratch',
      status: 'enabled',
      orderKey: 'b'
    }
    mocks.pinnedMiniApps = [calculator]
    // scratch is opened (e.g. via the sidebar) but not added to the launchpad —
    // launchpad membership must stay independent of what is merely opened.
    mocks.openedMiniApps = [calculator, scratch]

    render(<LaunchpadPage />)

    // Launchpad membership is driven by pinned status, not by what is merely opened.
    expect(screen.getByRole('button', { name: 'Calculator' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Scratch' })).not.toBeInTheDocument()
  })

  it('hides the mini apps section when only opened-but-unpinned apps exist', () => {
    const scratch = {
      appId: 'scratch',
      name: 'Scratch',
      logo: 'scratch-logo',
      url: 'https://scratch.example.com',
      presetMiniAppId: 'scratch',
      status: 'enabled',
      orderKey: 'b'
    }
    mocks.pinnedMiniApps = []
    mocks.openedMiniApps = [scratch]

    render(<LaunchpadPage />)

    expect(screen.queryByRole('heading', { name: 'Mini Apps' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Scratch' })).not.toBeInTheDocument()
  })

  it('adds an app icon to the sidebar from the context menu', async () => {
    const user = userEvent.setup()

    render(<LaunchpadPage />)

    expect(screen.getByTestId('menu-launchpad.unpin-from-sidebar.assistants')).toHaveTextContent('Remove from Sidebar')
    expect(screen.getByTestId('menu-launchpad.unpin-from-sidebar.assistants')).toBeDisabled()
    expect(screen.getByTestId('menu-launchpad.pin-to-sidebar.knowledge')).toHaveTextContent('Add to Sidebar')

    await user.click(screen.getByTestId('menu-launchpad.pin-to-sidebar.knowledge'))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith([appFavorite('assistants'), appFavorite('knowledge')])
  })

  it('removes an existing sidebar app icon from the context menu', async () => {
    const user = userEvent.setup()
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('knowledge')]

    render(<LaunchpadPage />)

    expect(screen.getByTestId('menu-launchpad.unpin-from-sidebar.knowledge')).toHaveTextContent('Remove from Sidebar')

    await user.click(screen.getByTestId('menu-launchpad.unpin-from-sidebar.knowledge'))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith([appFavorite('assistants')])
  })
})
