// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSidebarShortcutId, type SidebarShortcutItem } from '@shared/data/preference/preferenceTypes'

import { createSidebarShortcutTarget } from '../../../utils/sidebar'
import type * as SidebarConstantsModule from '../../Sidebar/constants'
import type * as SidebarFooterModule from '../../Sidebar/SidebarFooter'

const mocks = vi.hoisted(() => ({
  isMac: false,
  hasUnread: false,
  activate: vi.fn(),
  edition: 'cn' as 'cn' | 'global',
  registryResolve: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
  resolutions: [] as any[],
  sidebarWidth: 170,
  subscribePromptSeen: true,
  shortcuts: [] as any[],
  showUpdatePopup: vi.fn(),
  openSettingsTab: vi.fn()
}))

vi.unmock('@cherrystudio/ui')

vi.mock(import('@renderer/utils/platform'), async (importOriginal) => ({
  ...(await importOriginal()),
  get isMac() {
    return mocks.isMac
  }
}))

vi.mock('@renderer/utils/appEdition', () => ({ getAppEdition: () => mocks.edition }))

vi.mock('@data/hooks/useCache', () => ({
  usePersistCache: (key: string) => [
    key === 'ui.cherry_cloud.subscribe_prompt_seen' ? mocks.subscribePromptSeen : mocks.sidebarWidth,
    vi.fn()
  ],
  useCache: () => [{ available: false, downloaded: false, info: null }, vi.fn()]
}))
vi.mock('@data/hooks/usePreference', () => ({ usePreference: () => ['User', vi.fn()] }))
vi.mock('@renderer/hooks/useAvatar', () => ({ default: () => null }))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openSettingsTab: mocks.openSettingsTab }))
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
  UserAccountPanel: ({ onRequestClose, children }: { onRequestClose?: () => void; children?: ReactNode }) => (
    <>
      <button type="button" data-testid="account-menu" onClick={onRequestClose}>
        account-menu
      </button>
      {children}
    </>
  )
}))
vi.mock('../../layout/ShellTabBarActions', () => ({
  AppUpdateButton: () => (
    <button type="button" aria-label="Install update" onClick={mocks.showUpdatePopup}>
      update
    </button>
  )
}))
vi.mock('../../NotificationCenter', () => ({
  useNotificationCenter: () => ({ hasUnread: mocks.hasUnread })
}))

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
      user?: { name: string; avatar?: string; indicator?: ReactNode; onClick?: () => void }
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
    mocks.hasUnread = false
    vi.clearAllMocks()
    mocks.isMac = false
    mocks.shortcuts = []
    mocks.resolutions = []
    mocks.sidebarWidth = 170
    mocks.subscribePromptSeen = true
    mocks.registryResolve.mockReturnValue({ activate: mocks.activate })
    mocks.reorder.mockResolvedValue(undefined)
  })

  it.each([50, 170, 0])('dismisses the account menu on window blur at sidebar width %s', async (width) => {
    mocks.sidebarWidth = width
    const user = userEvent.setup()
    render(<Sidebar />)
    if (width === 0) fireEvent.mouseEnter(screen.getByTestId('docked-sidebar'))
    const sidebar = screen.getByTestId(width === 0 ? 'floating-sidebar' : 'docked-sidebar')
    await user.click(within(sidebar).getByRole('button', { name: 'User' }))
    expect(screen.getByLabelText('sidebar.account_menu')).toBeVisible()
    fireEvent.blur(within(screen.getByLabelText('sidebar.account_menu')).getAllByRole('button')[0])
    expect(screen.getByLabelText('sidebar.account_menu')).toBeVisible()
    fireEvent.blur(window)
    expect(screen.queryByLabelText('sidebar.account_menu')).not.toBeInTheDocument()
    fireEvent.focus(window)
    expect(screen.queryByLabelText('sidebar.account_menu')).not.toBeInTheDocument()
  })

  it.each([
    { isMac: false, isFullscreen: false, width: 170 },
    { isMac: false, isFullscreen: false, width: 50 },
    { isMac: false, isFullscreen: false, width: 0 },
    { isMac: true, isFullscreen: true, width: 170 },
    { isMac: true, isFullscreen: true, width: 50 },
    { isMac: true, isFullscreen: true, width: 0 }
  ])(
    'opens settings directly on macOS=$isMac fullscreen=$isFullscreen at sidebar width $width',
    async ({ isMac, isFullscreen, width }) => {
      mocks.isMac = isMac
      mocks.sidebarWidth = width
      const user = userEvent.setup()
      render(<Sidebar isFullscreen={isFullscreen} />)
      if (width === 0) fireEvent.mouseEnter(screen.getByTestId('docked-sidebar'))
      const sidebar = screen.getByTestId(width === 0 ? 'floating-sidebar' : 'docked-sidebar')
      const settings = within(sidebar).getByRole('button', { name: 'settings.title' })

      expect(settings).toBeVisible()
      await user.click(settings)

      expect(mocks.openSettingsTab).toHaveBeenCalledWith()
      expect(screen.queryByLabelText('sidebar.account_menu')).not.toBeInTheDocument()
    }
  )

  it('shows the same standalone settings action as other platforms when macOS enters fullscreen', () => {
    mocks.isMac = true
    const view = render(<Sidebar />)
    expect(screen.queryByRole('button', { name: 'settings.title' })).not.toBeInTheDocument()

    view.rerender(<Sidebar isFullscreen />)
    expect(screen.getByRole('button', { name: 'settings.title' })).toBeVisible()

    view.rerender(<Sidebar />)
    expect(screen.queryByRole('button', { name: 'settings.title' })).not.toBeInTheDocument()
  })

  it('shows unread state on the account trigger without clearing it when opening the menu', async () => {
    mocks.hasUnread = true
    const user = userEvent.setup()
    const view = render(<Sidebar />)
    expect(screen.getByRole('button', { name: 'User' })).toHaveAccessibleDescription('notification.center.unread')
    await user.click(screen.getByRole('button', { name: 'User' }))
    expect(screen.getByTestId('account-menu')).toBeVisible()
    expect(screen.getByRole('button', { name: 'User' })).toHaveAccessibleDescription('notification.center.unread')
    mocks.hasUnread = false
    view.rerender(<Sidebar />)
    expect(screen.getByRole('button', { name: 'User' })).not.toHaveAttribute('aria-describedby')
  })

  it('opens and closes the anchored account menu from the sidebar identity', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()

    await user.click(within(screen.getByTestId('sidebar-footer-user')).getByRole('button', { name: 'User' }))
    expect(screen.getByTestId('account-menu')).toBeVisible()
    expect(screen.getByLabelText('sidebar.account_menu')).toBeVisible()

    await user.click(screen.getByTestId('account-menu'))
    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()
  })

  it('keeps pointer focus on the avatar and focuses the first account action for keyboard access', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)
    const avatar = screen.getByRole('button', { name: 'User' })

    await user.click(avatar)
    expect(screen.getByTestId('account-menu')).toBeVisible()
    expect(avatar).toHaveFocus()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument())
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.getByTestId('account-menu')).toHaveFocus())
  })

  it('marks the account avatar until a Subscribe touchpoint has been used', async () => {
    mocks.subscribePromptSeen = false
    vi.mocked(window.api.ipcApi.request).mockImplementation(async (route) =>
      route === 'cherry_cloud.account.get'
        ? {
            ok: true,
            data: {
              status: { phase: 'signed-out', accountId: null, displayName: null, scopeId: 'out', revision: 1 },
              reason: 'initial',
              account: { freshness: 'unknown', error: null },
              models: { freshness: 'unknown', error: null },
              plans: { freshness: 'unknown', error: null }
            }
          }
        : { ok: true, data: undefined }
    )
    const { unmount } = render(<Sidebar />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'User' })).toHaveAccessibleDescription(
        'settings.subscription.go_to_subscribe'
      )
    )

    unmount()
    mocks.subscribePromptSeen = true
    render(<Sidebar />)

    expect(screen.getByRole('button', { name: 'User' })).not.toHaveAccessibleDescription()
  })

  it('does not mark the account avatar in the global edition', async () => {
    mocks.subscribePromptSeen = false
    mocks.edition = 'global'
    vi.mocked(window.api.ipcApi.request).mockImplementation(async (route) =>
      route === 'cherry_cloud.account.get'
        ? {
            ok: true,
            data: {
              status: { phase: 'signed-out', accountId: null, displayName: null, scopeId: 'out', revision: 1 },
              reason: 'initial',
              account: { freshness: 'unknown', error: null },
              models: { freshness: 'unknown', error: null },
              plans: { freshness: 'unknown', error: null }
            }
          }
        : { ok: true, data: undefined }
    )

    try {
      render(<Sidebar />)
      // A signed-out status would light the dot in the China edition as soon as it resolves.
      await act(() => new Promise((resolve) => setTimeout(resolve, 50)))

      expect(screen.queryByRole('status', { name: 'settings.subscription.go_to_subscribe' })).not.toBeInTheDocument()
    } finally {
      mocks.edition = 'cn'
    }
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

  it('clears a previous hover reveal when hiding the sidebar again', () => {
    mocks.sidebarWidth = 0
    const view = render(<Sidebar />)
    fireEvent.mouseEnter(screen.getByTestId('docked-sidebar'))
    expect(screen.getByTestId('floating-sidebar')).toBeVisible()

    mocks.sidebarWidth = 200
    view.rerender(<Sidebar />)
    mocks.sidebarWidth = 0
    view.rerender(<Sidebar />)

    expect(screen.queryByTestId('floating-sidebar')).not.toBeInTheDocument()
    fireEvent.mouseEnter(screen.getByTestId('docked-sidebar'))
    expect(screen.getByTestId('floating-sidebar')).toBeVisible()
  })

  it('keeps the update action independent from the account menu', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByRole('button', { name: 'Install update' }))

    expect(mocks.showUpdatePopup).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('account-menu')).not.toBeInTheDocument()
  })

  it.each([170, 50, 0])('moves help into the account menu at sidebar width %s', async (width) => {
    mocks.sidebarWidth = width
    const user = userEvent.setup()
    render(<Sidebar />)
    if (width === 0) fireEvent.mouseEnter(screen.getByTestId('docked-sidebar'))
    const sidebar = screen.getByTestId(width === 0 ? 'floating-sidebar' : 'docked-sidebar')

    expect(screen.queryByRole('button', { name: 'help.title' })).not.toBeInTheDocument()

    await user.click(within(sidebar).getByRole('button', { name: 'User' }))
    const accountMenu = screen.getByLabelText('sidebar.account_menu')
    await user.click(within(accountMenu).getByRole('button', { name: 'help.title' }))

    expect(screen.getByRole('button', { name: 'help.whats_new' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'help.guide' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'settings.about.feedback.diagnostics.title' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'help.feedback' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'settings.doctor.entry.title' })).toBeVisible()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: 'help.whats_new' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('sidebar.account_menu')).toBeVisible()
    expect(within(accountMenu).getByRole('button', { name: 'help.title' })).toHaveFocus()

    await user.click(within(accountMenu).getByRole('button', { name: 'help.title' }))
    await user.click(screen.getByRole('button', { name: 'help.whats_new' }))
    await waitFor(() => expect(screen.queryByLabelText('sidebar.account_menu')).not.toBeInTheDocument())
  })

  it('closes both menus and gives focus to the feedback dialog', async () => {
    const user = userEvent.setup()
    render(<Sidebar />)

    await user.click(screen.getByRole('button', { name: 'User' }))
    await user.click(screen.getByRole('button', { name: 'help.title' }))
    await user.click(screen.getByRole('button', { name: 'help.feedback' }))

    const dialog = await screen.findByRole('dialog', { name: 'settings.about.feedback.dialog.title' })
    expect(screen.queryByLabelText('sidebar.account_menu')).not.toBeInTheDocument()
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: /settings.about.feedback.diagnostics.title/ })).toHaveFocus()
    )
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
