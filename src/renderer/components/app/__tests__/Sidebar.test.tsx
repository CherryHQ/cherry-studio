// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { createSidebarShortcutId, type SidebarShortcutItem } from '@shared/data/preference/preferenceTypes'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
      <ol aria-label="shortcuts">
        {entries.map((entry) => (
          <li key={entry.key} aria-label={entry.label}>
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
          </li>
        ))}
      </ol>
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

function renderedShortcutLabels(): Array<string | null> {
  return within(screen.getByRole('list', { name: 'shortcuts' }))
    .getAllByRole('listitem')
    .map((item) => item.getAttribute('aria-label'))
}

describe('app Sidebar shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.shortcuts = []
    mocks.resolutions = []
    mocks.registryResolve.mockReturnValue({ activate: mocks.activate })
    mocks.reorder.mockResolvedValue(undefined)
  })

  it('keeps a missing resource in place, disables activation, and allows removal', () => {
    const missing = shortcut('core.knowledge-base', 'missing', 'Lost Knowledge Base')
    mocks.shortcuts = [missing]
    mocks.resolutions = [{ status: 'missing', shortcut: missing }]

    render(<Sidebar />)

    expect(screen.getByRole('button', { name: 'Lost Knowledge Base' })).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Lost Knowledge Base' }))
    expect(mocks.activate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'launchpad.unpin_from_sidebar' }))
    expect(mocks.remove).toHaveBeenCalledWith(missing.target)
  })

  it('disables removing the last built-in app shortcut', () => {
    const assistant = shortcut('core.app', 'assistants')
    mocks.shortcuts = [assistant]
    mocks.resolutions = [
      { status: 'resolved', shortcut: assistant, resource: { label: 'Chat', renderIcon: () => null } }
    ]

    render(<Sidebar />)

    expect(screen.getByRole('button', { name: 'launchpad.unpin_from_sidebar' })).toBeDisabled()
  })

  it('allows removing the assistant when another built-in app remains', () => {
    const assistant = shortcut('core.app', 'assistants')
    const knowledge = shortcut('core.app', 'knowledge')
    mocks.shortcuts = [assistant, knowledge]
    mocks.resolutions = [
      { status: 'resolved', shortcut: assistant, resource: { label: 'Chat', renderIcon: () => null } },
      { status: 'resolved', shortcut: knowledge, resource: { label: 'Knowledge', renderIcon: () => null } }
    ]

    render(<Sidebar />)
    const assistantItem = screen.getByRole('listitem', { name: 'Chat' })
    fireEvent.click(within(assistantItem).getByRole('button', { name: 'launchpad.unpin_from_sidebar' }))

    expect(mocks.remove).toHaveBeenCalledWith(assistant.target)
  })

  it('activates through the provider while the gateway owns tab title and new-tab policy', () => {
    const knowledgeBase = shortcut('core.knowledge-base', 'base-1')
    mocks.shortcuts = [knowledgeBase]
    mocks.resolutions = [
      {
        status: 'resolved',
        shortcut: knowledgeBase,
        resource: { label: 'Knowledge Base One', renderIcon: () => null, supportsNewTab: true }
      }
    ]
    mocks.activate.mockImplementation(
      (_target: unknown, gateway: { openWorkspace: (destination: { url: string; title: string }) => void }) =>
        gateway.openWorkspace({ url: '/app/resource', title: 'provider fallback' })
    )

    render(<Sidebar />)

    fireEvent.click(screen.getByRole('button', { name: 'Knowledge Base One' }))
    expect(mocks.gatewayOpenWorkspace).toHaveBeenCalledWith(
      { url: '/app/resource', title: 'Knowledge Base One', icon: undefined },
      undefined
    )
    fireEvent.click(screen.getByRole('button', { name: 'common.open_in_new_tab' }))
    expect(mocks.gatewayOpenWorkspace).toHaveBeenLastCalledWith(
      { url: '/app/resource', title: 'Knowledge Base One', icon: undefined },
      { inNewTab: true }
    )
  })

  it('keeps the dropped order visible until the preference write confirms it', async () => {
    const first = shortcut('core.knowledge-base', 'one', 'One')
    const second = shortcut('core.topic', 'two', 'Two')
    const firstResolution = { status: 'missing', shortcut: first }
    const secondResolution = { status: 'unavailable', shortcut: second }
    let finishReorder: () => void = vi.fn()
    mocks.reorder.mockReturnValue(
      new Promise<void>((resolve) => {
        finishReorder = resolve
      })
    )
    mocks.shortcuts = [first, second]
    mocks.resolutions = [firstResolution, secondResolution]

    const { rerender } = render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: 'reorder' }))

    expect(renderedShortcutLabels()).toEqual(['Two', 'One'])
    expect(mocks.reorder).toHaveBeenCalledWith([second, first])

    mocks.shortcuts = [second, first]
    mocks.resolutions = [secondResolution, firstResolution]
    rerender(<Sidebar />)
    act(() => finishReorder())

    await waitFor(() => expect(renderedShortcutLabels()).toEqual(['Two', 'One']))
  })

  it('restores the persisted order when a drag write fails', async () => {
    const first = shortcut('core.knowledge-base', 'one', 'One')
    const second = shortcut('core.topic', 'two', 'Two')
    mocks.reorder.mockRejectedValue(new Error('write failed'))
    mocks.shortcuts = [first, second]
    mocks.resolutions = [
      { status: 'missing', shortcut: first },
      { status: 'unavailable', shortcut: second }
    ]

    render(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: 'reorder' }))

    expect(renderedShortcutLabels()).toEqual(['Two', 'One'])
    await waitFor(() => expect(renderedShortcutLabels()).toEqual(['One', 'Two']))
  })
})
