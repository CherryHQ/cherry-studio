// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { SidebarAppId } from '@renderer/utils/sidebar'
import type { SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
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

vi.mock('@renderer/components/ProviderAvatar', () => ({
  ProviderAvatarPrimitive: () => <svg aria-hidden="true" />
}))

vi.mock('@renderer/components/Scrollbar', () => ({
  default: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  )
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
          'title.chat': 'Chat',
          'assistants.presets.title': 'Library',
          'code.title': 'Code',
          'files.title': 'Files',
          'knowledge.title': 'Knowledge',
          'launchpad.apps': 'Apps',
          'launchpad.deepseek_harness_shortcut': 'DSH',
          'launchpad.miniApps': 'Mini Apps',
          'launchpad.pin_to_sidebar': 'Add to Sidebar',
          'launchpad.unpin_from_sidebar': 'Remove from Sidebar',
          'miniApp.reorder_failed': 'Failed to reorder mini apps',
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
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.sortableCalls.length = 0
})

describe('LaunchpadPage', () => {
  beforeEach(() => {
    mocks.sidebarFavorites = [appFavorite('assistants')]
    mocks.appOrder = []
    mocks.sortableCalls.length = 0
    mocks.setSidebarFavorites.mockResolvedValue(undefined)
    mocks.setAppOrder.mockResolvedValue(undefined)
  })

  it('renders the launchpad page chrome and app grid', () => {
    render(<LaunchpadPage />)

    const appsHeading = screen.getByRole('heading', { name: 'Apps' })
    const chatButton = screen.getByRole('button', { name: 'Chat' })

    expect(appsHeading.closest('section')?.parentElement).toHaveClass('max-w-180', 'gap-5')
    expect(appsHeading.nextElementSibling).toHaveClass('grid-cols-6', 'justify-items-center', 'gap-2', 'px-2')
    expect(chatButton).toHaveClass('mx-auto', 'w-[92px]')
    expect(screen.getByRole('button', { name: 'Agent' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Knowledge' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Manage' })).not.toBeInTheDocument()
  })

  it('orders app tiles by the launchpad app order, appending the rest canonically', () => {
    // Launchpad app order is independent of the sidebar favorites order.
    mocks.appOrder = ['translate', 'assistants', 'agents']
    mocks.sidebarFavorites = [appFavorite('assistants')]

    render(<LaunchpadPage />)

    const appLabels = screen
      .getAllByRole('button')
      .map((button) => button.textContent)
      .filter((label): label is string => ['Translate', 'Chat', 'Agent', 'Knowledge'].includes(label ?? ''))

    expect(appLabels).toEqual(['Translate', 'Chat', 'Agent', 'Knowledge'])
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
