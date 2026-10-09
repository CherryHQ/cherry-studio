// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSidebarShortcutId, type SidebarShortcutItem } from '@shared/data/preference/preferenceTypes'

import { createSidebarShortcutTarget } from '../../../utils/sidebar'
import type * as ShellTabBarActionsModule from '../../layout/ShellTabBarActions'
import type * as SidebarConstantsModule from '../../Sidebar/constants'
import type * as SidebarFooterModule from '../../Sidebar/SidebarFooter'

const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  openSettingsTab: vi.fn(),
  registryResolve: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  resolutions: [] as any[],
  sidebarWidth: 170,
  shortcuts: [] as any[],
  showUpdatePopup: vi.fn()
}))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: () => [mocks.sidebarWidth, vi.fn()],
  useCache: () => [{ available: false, downloaded: false, info: null }, vi.fn()]
}))
vi.mock('@data/hooks/usePreference', () => ({ usePreference: () => ['User', vi.fn()] }))
vi.mock('@renderer/hooks/useAvatar', () => ({ default: () => null }))
vi.mock('@renderer/hooks/useMiniAppPopup', () => ({ useMiniAppPopup: () => ({ openSmartMiniApp: vi.fn() }) }))
vi.mock('@renderer/hooks/useOpenReleaseNotes', () => ({ useOpenReleaseNotes: () => vi.fn() }))
vi.mock('@renderer/hooks/useSidebarShortcuts', () => ({
  useSidebarShortcuts: () => ({ shortcuts: mocks.shortcuts, remove: mocks.remove, reorder: mocks.reorder })
}))
vi.mock('../sidebarShortcuts', () => ({
  useSidebarNavigationSnapshot: () => ({ url: '/' }),
  useResolvedSidebarShortcuts: () => mocks.resolutions,
  useSidebarShortcutActivation: () => mocks.activate,
  useSidebarShortcutRegistry: () => ({ resolve: mocks.registryResolve })
}))
vi.mock('../../UserAccountPanel', () => ({
  UserAccountPanel: ({ onRequestClose }: { onRequestClose?: () => void }) => (
    <button type="button" data-testid="account-menu" onClick={onRequestClose}>
      account-menu
    </button>
  )
}))
vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: (...args: unknown[]) => mocks.openSettingsTab(...args)
}))
vi.mock('../../layout/ShellTabBarActions', async () => {
  const actual = await vi.importActual<typeof ShellTabBarActionsModule>('../../layout/ShellTabBarActions')

  return {
    AppUpdateButton: () => (
      <button type="button" aria-label="Install update" onClick={mocks.showUpdatePopup}>
        update
      </button>
    ),
    SidebarSettingsButton: actual.SidebarSettingsButton
  }
})
vi.mock('../../Sidebar', async () => {
  const constants = await vi.importActual<typeof SidebarConstantsModule>('../../Sidebar/constants')
  const { SidebarFooter } = await vi.importActual<typeof SidebarFooterModule>('../../Sidebar/SidebarFooter')

  return {
    getSidebarDisplayWidth: constants.getSidebarDisplayWidth,
    getSidebarLayout: constants.getSidebarLayout,
    normalizeSidebarWidth: constants.normalizeSidebarWidth,
    Sidebar: ({
      width = 170,
      entries,
      isFloating = false,
      onEntriesReorder,
      onHoverChange,
      actions,
      renderUserTrigger,
      user,
      userAction
    }: {
      width?: number
      entries: Array<{
        key: string
        label: string
        disabled?: boolean
        onOpen: () => void
        contextMenuItems: Array<{ id: string; label: string; enabled?: boolean; onSelect: () => void }>
      }>
      isFloating?: boolean
      onEntriesReorder: (event: { oldIndex: number; newIndex: number }) => void
      onHoverChange?: (visible: boolean) => void
      actions?: ReactNode | ((layout: 'full' | 'icon', onOverlayOpenChange?: (open: boolean) => void) => ReactNode)
      renderUserTrigger?: (trigger: ReactElement) => ReactElement
      user?: { name: string; avatar?: string; onClick?: () => void }
      userAction?: ReactNode | ((layout: 'full' | 'icon', onOverlayOpenChange?: (open: boolean) => void) => ReactNode)
    }) => {
      const shellLayout = constants.getSidebarLayout(width)
      // The real dock passes its visible band through. A hidden dock's flyout is a full sheet.
      const footerLayout = !isFloating && shellLayout === 'icon' ? 'icon' : 'full'

      return (
        <div
          data-testid={isFloating ? 'floating-sidebar' : 'docked-sidebar'}
          onMouseEnter={() => onHoverChange?.(true)}>
          <div data-testid="sidebar-footer-user">
            <SidebarFooter
              layout={footerLayout}
              actions={actions}
              user={user}
              userAction={userAction}
              renderUserTrigger={renderUserTrigger}
            />
          </div>
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
    }
  }
})
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

describe('app Sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.shortcuts = []
    mocks.resolutions = []
    mocks.sidebarWidth = 170
    mocks.registryResolve.mockReturnValue({ activate: mocks.activate })
    mocks.reorder.mockResolvedValue(undefined)
  })

  it('opens and closes the anchored account menu from the footer identity', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()

    await user.click(within(screen.getByTestId('sidebar-footer-user')).getByRole('button', { name: 'User' }))
    expect(screen.getByTestId('account-menu')).toBeVisible()
    expect(screen.getByLabelText('sidebar.account_menu')).toBeVisible()

    await user.click(screen.getByTestId('account-menu'))
    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()
  })

  it('does not reopen the account menu after resizing the sidebar to hidden', async () => {
    const user = userEvent.setup()
    const view = render(<Sidebar />)

    await user.click(within(screen.getByTestId('sidebar-footer-user')).getByRole('button', { name: 'User' }))
    expect(screen.getByTestId('account-menu')).toBeVisible()

    mocks.sidebarWidth = 0
    view.rerender(<Sidebar />)
    fireEvent.mouseEnter(screen.getByTestId('docked-sidebar'))

    expect(screen.getByTestId('floating-sidebar')).toBeVisible()
    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()
  })

  it('keeps settings and update actions independent from the account menu', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    const footer = screen.getByTestId('sidebar-footer-user')

    await user.click(within(footer).getByRole('button', { name: 'settings.title' }))
    await user.click(within(footer).getByRole('button', { name: 'Install update' }))

    expect(mocks.openSettingsTab).toHaveBeenCalledOnce()
    expect(mocks.showUpdatePopup).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()
  })

  it('renders the full footer layout through the production Help action', () => {
    render(<Sidebar />)
    const footer = screen.getByTestId('sidebar-footer-user')

    expect(within(footer).getByRole('button', { name: 'help.title' })).toHaveTextContent('help.title')
    expect(within(footer).getByRole('button', { name: 'settings.title' })).toHaveTextContent('settings.title')
  })

  it('propagates full and icon footer layouts to Settings and Help outside the account row', () => {
    mocks.sidebarWidth = 170
    const view = render(<Sidebar />)
    const footer = screen.getByTestId('sidebar-footer-user')
    const settings = within(footer).getByRole('button', { name: 'settings.title' })
    const help = within(footer).getByRole('button', { name: 'help.title' })
    const account = within(footer).getByRole('button', { name: 'User' })
    const update = within(footer).getByRole('button', { name: 'Install update' })
    // The trigger mock wraps the identity button, so the account row is the ancestor that also holds the update control.
    let accountRow: HTMLElement | null = account
    while (accountRow && !accountRow.contains(update)) accountRow = accountRow.parentElement

    expect(settings).toHaveTextContent('settings.title')
    expect(help).toHaveTextContent('help.title')
    expect(help.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(help.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(accountRow).toContainElement(update)
    expect(accountRow).not.toContainElement(settings)
    expect(accountRow).not.toContainElement(help)

    mocks.sidebarWidth = 50
    view.rerender(<Sidebar />)

    const iconFooter = screen.getByTestId('sidebar-footer-user')
    const iconSettings = within(iconFooter).getByRole('button', { name: 'settings.title' })
    const iconHelp = within(iconFooter).getByRole('button', { name: 'help.title' })

    expect(iconSettings).not.toHaveTextContent('settings.title')
    expect(iconHelp).not.toHaveTextContent('help.title')
    expect(within(iconFooter).getByRole('button', { name: 'User' })).toBeVisible()
    expect(within(iconFooter).queryByRole('button', { name: 'Install update' })).not.toBeInTheDocument()
  })

  it('places help above settings in the compact sidebar footer', () => {
    mocks.sidebarWidth = 50
    render(<Sidebar />)

    const footer = screen.getByTestId('sidebar-footer-user')
    const actions = within(footer)
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
    expect(actions.filter((label) => label === 'help.title' || label === 'settings.title')).toEqual([
      'help.title',
      'settings.title'
    ])
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
