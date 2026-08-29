// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { createSidebarShortcutId, type SidebarShortcutItem } from '@shared/data/preference/preferenceTypes'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSidebarShortcutTarget } from '../../../utils/sidebar'

const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  gatewayOpenSettings: vi.fn(),
  gatewayOpenWorkspace: vi.fn(),
  registryResolve: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  resolutions: [] as any[],
  shortcuts: [] as any[]
}))

vi.mock('@data/hooks/useCache', () => ({ usePersistCache: () => [170, vi.fn()] }))
vi.mock('@data/hooks/usePreference', () => ({ usePreference: () => ['User', vi.fn()] }))
vi.mock('@renderer/hooks/tab', () => ({ useTabs: () => ({ activeTab: { url: '/app/chat' } }) }))
vi.mock('@renderer/hooks/useAvatar', () => ({ default: () => null }))
vi.mock('@renderer/hooks/useSidebarShortcuts', () => ({
  useSidebarShortcuts: () => ({ shortcuts: mocks.shortcuts, remove: mocks.remove, reorder: mocks.reorder })
}))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: vi.fn() }))
vi.mock('../sidebarShortcuts', () => ({
  useResolvedSidebarShortcuts: () => mocks.resolutions,
  useSidebarActivationGateway: () => ({
    openSettings: mocks.gatewayOpenSettings,
    openWorkspace: mocks.gatewayOpenWorkspace
  }),
  useSidebarShortcutRegistry: () => ({ resolve: mocks.registryResolve })
}))
vi.mock('../../layout/ShellTabBarActions', () => ({ SidebarShellActions: () => null }))
vi.mock('../../UserPopup', () => ({ default: { show: vi.fn() } }))
vi.mock('../../Sidebar', () => ({
  getSidebarDisplayWidth: (width: number) => width,
  getSidebarLayout: () => 'full',
  normalizeSidebarWidth: (width: number) => width,
  UserAvatar: () => <span />,
  Sidebar: ({
    entries,
    onEntriesReorder
  }: {
    entries: Array<{
      key: string
      label: string
      disabled?: boolean
      onOpen: () => void
      contextMenuItems: Array<{ id: string; label: string; enabled?: boolean; onSelect: () => void }>
    }>
    onEntriesReorder: (event: { oldIndex: number; newIndex: number }) => void
  }) => (
    <div>
      {entries.map((entry) => (
        <div key={entry.key}>
          <button
            type="button"
            aria-disabled={entry.disabled || undefined}
            onClick={() => !entry.disabled && entry.onOpen()}>
            {entry.label}
          </button>
          {entry.contextMenuItems.map((item) => (
            <button key={item.id} type="button" disabled={item.enabled === false} onClick={item.onSelect}>
              {item.label}
            </button>
          ))}
        </div>
      ))}
      <button type="button" onClick={() => onEntriesReorder({ oldIndex: 0, newIndex: 1 })}>
        reorder
      </button>
    </div>
  )
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import Sidebar from '../Sidebar'

function shortcut(providerId: string, resourceId: string, fallbackLabel?: string): SidebarShortcutItem {
  const target = createSidebarShortcutTarget(providerId, resourceId)
  return { type: 'shortcut', id: createSidebarShortcutId(target), target, fallbackLabel }
}

describe('app Sidebar shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.shortcuts = []
    mocks.resolutions = []
    mocks.registryResolve.mockReturnValue({ activate: mocks.activate })
  })

  it('keeps a missing resource in place, disables activation, and allows removal', () => {
    const missing = shortcut('core.skill', 'missing', 'Lost Skill')
    mocks.shortcuts = [missing]
    mocks.resolutions = [{ status: 'missing', shortcut: missing }]

    render(<Sidebar />)

    expect(screen.getByRole('button', { name: 'Lost Skill' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Lost Skill' }))
    expect(mocks.activate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'launchpad.unpin_from_sidebar' }))
    expect(mocks.remove).toHaveBeenCalledWith(missing.target)
  })

  it('activates through the provider while the gateway owns tab title and new-tab policy', () => {
    const skill = shortcut('core.skill', 'skill-1')
    mocks.shortcuts = [skill]
    mocks.resolutions = [
      {
        status: 'resolved',
        shortcut: skill,
        resource: { label: 'Skill One', renderIcon: () => null, supportsNewTab: true }
      }
    ]
    mocks.activate.mockImplementation(
      (_target: unknown, gateway: { openWorkspace: (destination: { url: string; title: string }) => void }) =>
        gateway.openWorkspace({ url: '/app/resource', title: 'provider fallback' })
    )

    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Skill One' }))
    expect(mocks.gatewayOpenWorkspace).toHaveBeenCalledWith(
      { url: '/app/resource', title: 'Skill One', icon: undefined },
      undefined
    )
    fireEvent.click(screen.getByRole('button', { name: 'common.open_in_new_tab' }))
    expect(mocks.gatewayOpenWorkspace).toHaveBeenLastCalledWith(
      { url: '/app/resource', title: 'Skill One', icon: undefined },
      { inNewTab: true }
    )
  })

  it('persists drag order using shortcut identities, including unresolved rows', () => {
    const first = shortcut('core.skill', 'one')
    const second = shortcut('core.mcp-server', 'two')
    mocks.shortcuts = [first, second]
    mocks.resolutions = [
      { status: 'missing', shortcut: first },
      { status: 'unavailable', shortcut: second }
    ]

    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: 'reorder' }))

    expect(mocks.reorder).toHaveBeenCalledWith([second, first])
  })
})
