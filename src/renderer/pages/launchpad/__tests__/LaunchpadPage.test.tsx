// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { SidebarBuiltinFavorite } from '@shared/data/preference/preferenceTypes'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  pinnedMiniApps: [] as any[],
  openedMiniApps: [] as any[],
  reorderMiniAppsByStatus: vi.fn(() => Promise.resolve()),
  setSidebarFavorites: vi.fn(() => Promise.resolve()),
  sidebarFavorites: ['assistants'] as string[],
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
    return [mocks.sidebarFavorites, mocks.setSidebarFavorites]
  }
}))

vi.mock('@renderer/components/Icons/SvgIcon', () => ({
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
  getSidebarIconLabelKey: (key: SidebarBuiltinFavorite) =>
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
          'launchpad.pin_to_sidebar': 'Pin to sidebar',
          'launchpad.unpin_from_sidebar': 'Unpin from sidebar',
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

const appFavorite = (id: SidebarBuiltinFavorite): string => id
const miniAppFavorite = (id: string): string => id

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
    mocks.sortableCalls.length = 0
    mocks.setSidebarFavorites.mockResolvedValue(undefined)
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

  it('renders fixed sidebar apps first and unpinned apps in default order', () => {
    mocks.sidebarFavorites = [appFavorite('translate'), appFavorite('assistants'), appFavorite('agents')]

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

  it('sorts only fixed sidebar apps and preserves mini app favorite ids', () => {
    mocks.sidebarFavorites = [
      appFavorite('translate'),
      appFavorite('assistants'),
      appFavorite('agents'),
      miniAppFavorite('calculator')
    ]

    render(<LaunchpadPage />)

    const systemSortable = mocks.sortableCalls.find((call) => call.itemKey === 'id')

    expect(systemSortable.items.map((item: { id: string }) => item.id)).toEqual(['translate', 'assistants', 'agents'])

    systemSortable.onSortEnd({ oldIndex: 0, newIndex: 2 })

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith([
      appFavorite('assistants'),
      appFavorite('agents'),
      appFavorite('translate'),
      miniAppFavorite('calculator')
    ])
  })

  it('navigates apps inside the current launchpad tab', async () => {
    const user = userEvent.setup()

    render(<LaunchpadPage />)

    await user.click(screen.getByRole('button', { name: 'Knowledge' }))

    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/knowledge' })
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

  it('sorts pinned mini apps through the mini app order API', () => {
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
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('mini_app')]

    render(<LaunchpadPage />)

    const miniAppSortable = mocks.sortableCalls.find((call) => call.itemKey === 'appId')

    expect(miniAppSortable.items.map((app: { appId: string }) => app.appId)).toEqual(['calculator', 'docs'])

    miniAppSortable.onSortEnd({ oldIndex: 0, newIndex: 1 })

    expect(mocks.reorderMiniAppsByStatus).toHaveBeenCalledWith('pinned', [docs, calculator])
    expect(mocks.setSidebarFavorites).not.toHaveBeenCalled()
  })

  it('shows opened-only mini apps without including them in pinned sortable persistence', () => {
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
    mocks.openedMiniApps = [calculator, scratch]

    render(<LaunchpadPage />)

    const miniAppSortable = mocks.sortableCalls.find((call) => call.itemKey === 'appId')

    expect(miniAppSortable.items.map((app: { appId: string }) => app.appId)).toEqual(['calculator'])
    expect(screen.getByRole('button', { name: 'Calculator' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Scratch' })).toBeInTheDocument()
  })

  it('pins an app icon to the sidebar from the context menu', async () => {
    const user = userEvent.setup()

    render(<LaunchpadPage />)

    expect(screen.getByTestId('menu-launchpad.unpin-from-sidebar.assistants')).toHaveTextContent('Unpin from sidebar')
    expect(screen.getByTestId('menu-launchpad.unpin-from-sidebar.assistants')).toBeDisabled()

    await user.click(screen.getByTestId('menu-launchpad.pin-to-sidebar.knowledge'))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith([appFavorite('assistants'), appFavorite('knowledge')])
  })

  it('unpins an existing sidebar app icon from the context menu', async () => {
    const user = userEvent.setup()
    mocks.sidebarFavorites = [appFavorite('assistants'), appFavorite('knowledge')]

    render(<LaunchpadPage />)

    expect(screen.getByTestId('menu-launchpad.unpin-from-sidebar.knowledge')).toHaveTextContent('Unpin from sidebar')

    await user.click(screen.getByTestId('menu-launchpad.unpin-from-sidebar.knowledge'))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith([appFavorite('assistants')])
  })
})
