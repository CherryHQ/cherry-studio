import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type ReactType from 'react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { POPUP_EXIT_MS, popupService } from '@renderer/services/popup'

const mocks = vi.hoisted(() => ({
  appEdition: 'cn' as 'cn' | 'global',
  openSettingsTab: vi.fn(),
  setTheme: vi.fn(),
  themeMode: 'system' as 'light' | 'dark' | 'system',
  ipcRequest: vi.fn(
    async (route: string): Promise<unknown> =>
      route === 'cherry_cloud.status.get' ? { phase: 'signed-out', displayName: null } : undefined
  ),
  statusListener: null as ((status: { phase: string; displayName: string | null }) => void) | null
}))

type PopoverContextValue = {
  open: boolean
  onOpenChange?: (open: boolean) => void
}

type DialogContextValue = {
  onOpenChange?: (open: boolean) => void
}

vi.mock('@cherrystudio/ui', () => {
  const React = require('react') as typeof ReactType
  const PopoverContext = React.createContext<PopoverContextValue>({ open: false })
  const DialogContext = React.createContext<DialogContextValue>({})

  return {
    Avatar: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="avatar" {...props}>
        {children}
      </div>
    ),
    AvatarImage: ({ src, ...props }: { src?: string; [key: string]: unknown }) => (
      <img data-testid="avatar-image" src={src} alt="" {...props} />
    ),
    Button: ({ children, loading, ...props }: { children?: ReactNode; loading?: boolean; [key: string]: unknown }) => (
      <button type="button" aria-busy={loading || undefined} disabled={loading || undefined} {...props}>
        {children}
      </button>
    ),
    ColFlex: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="col-flex" {...props}>
        {children}
      </div>
    ),
    ConfirmDialog: ({
      cancelText,
      confirmLoading,
      confirmText,
      content,
      description,
      onConfirm,
      onOpenChange,
      open,
      title
    }: {
      cancelText?: string
      confirmLoading?: boolean
      confirmText?: string
      content?: ReactNode
      description?: ReactNode
      onConfirm?: () => void | Promise<void>
      onOpenChange?: (open: boolean) => void
      open?: boolean
      title?: ReactNode
    }) =>
      open ? (
        <div role="dialog" aria-label={String(title)}>
          <h2>{title}</h2>
          {description}
          {content}
          <button type="button" onClick={() => onOpenChange?.(false)}>
            {cancelText}
          </button>
          <button
            type="button"
            aria-busy={confirmLoading || undefined}
            disabled={confirmLoading}
            onClick={async () => {
              await onConfirm?.()
              onOpenChange?.(false)
            }}>
            {confirmText}
          </button>
        </div>
      ) : null,
    Dialog: ({
      children,
      open,
      onOpenChange
    }: {
      children?: ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) =>
      open ? (
        <DialogContext value={{ onOpenChange }}>
          <div data-testid="dialog">{children}</div>
        </DialogContext>
      ) : null,
    DialogContent: ({
      children,
      closeOnOverlayClick,
      onEscapeKeyDown,
      ...props
    }: {
      children?: ReactNode
      closeOnOverlayClick?: boolean
      onEscapeKeyDown?: (event: KeyboardEvent) => void
      [key: string]: unknown
    }) => {
      const context = React.use(DialogContext)
      void closeOnOverlayClick
      return (
        <div
          data-testid="dialog-content"
          onKeyDownCapture={(event) => {
            if (event.key !== 'Escape') return
            onEscapeKeyDown?.(event.nativeEvent)
            if (!event.nativeEvent.defaultPrevented) context.onOpenChange?.(false)
          }}
          {...props}>
          {children}
        </div>
      )
    },
    DialogHeader: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="dialog-header" {...props}>
        {children}
      </div>
    ),
    DialogTitle: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <h2 data-testid="dialog-title" {...props}>
        {children}
      </h2>
    ),
    EmojiAvatar: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="emoji-avatar" {...props}>
        {children}
      </div>
    ),
    Input: (props: { [key: string]: unknown }) => <input {...props} />,
    Popover: ({
      children,
      open = false,
      onOpenChange
    }: {
      children?: ReactNode
      open?: boolean
      onOpenChange?: (open: boolean) => void
    }) => <PopoverContext value={{ open, onOpenChange }}>{children}</PopoverContext>,
    PopoverContent: ({
      children,
      align,
      sideOffset,
      ...props
    }: {
      children?: ReactNode
      align?: string
      sideOffset?: number
      [key: string]: unknown
    }) => {
      const context = React.use(PopoverContext)
      void align
      void sideOffset

      return context.open ? (
        <div data-testid="popover-content" {...props}>
          {children}
        </div>
      ) : null
    },
    PopoverTrigger: ({ children }: { children: ReactNode; asChild?: boolean }) => {
      const context = React.use(PopoverContext)
      // The real trigger opens the popover on click; wire that here so tests can
      // reach the file-upload / emoji controls inside PopoverContent.
      return (
        <div data-testid="popover-trigger" onClick={() => context.onOpenChange?.(true)}>
          {children}
        </div>
      )
    },
    RowFlex: ({ children, ...props }: { children?: ReactNode; [key: string]: unknown }) => (
      <div data-testid="row-flex" {...props}>
        {children}
      </div>
    ),
    SegmentedControl: ({
      options,
      value,
      onValueChange,
      ...props
    }: {
      options: Array<{ value: string; label: ReactNode }>
      value?: string
      onValueChange?: (value: string) => void
      [key: string]: unknown
    }) => (
      <div role="radiogroup" {...props}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={option.value === value}
            onClick={() => onValueChange?.(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    ),
    Tooltip: ({ children }: { children?: ReactNode; content?: ReactNode }) => children
  }
})

// This suite renders the real popup through the store + host, so opt out of the global mock.
vi.mock('@renderer/services/popup', async (importOriginal) => await importOriginal())

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: (_event: string, listener: (status: { phase: string; displayName: string | null }) => void) => {
    mocks.statusListener = listener
  }
}))

vi.mock('@renderer/utils/appEdition', () => ({
  getAppEdition: () => mocks.appEdition
}))

vi.mock('@renderer/services/mainWindowNavigation', () => ({
  openSettingsTab: mocks.openSettingsTab
}))

vi.mock('@renderer/hooks/useTheme', () => ({
  useTheme: () => ({ settedTheme: mocks.themeMode, setTheme: mocks.setTheme })
}))

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: vi.fn()
  },
  useTranslation: () => ({
    t: (key: string, options?: { displayName?: string }) => {
      if (key === 'settings.appearance.title') return 'Appearance'
      if (key === 'settings.provider.cherry_cloud.title') return 'Localized Cherry Cloud'
      if (key === 'settings.provider.cherry_cloud.logout_confirm_title') return 'Log out?'
      if (key === 'settings.provider.cherry_cloud.logout_confirm_account') {
        return `Signed in as ${options?.displayName}`
      }
      if (key === 'settings.provider.cherry_cloud.logout_confirm_description') {
        return "You'll need to sign in again to keep using Cherry Cloud."
      }
      return key
    }
  })
}))

import { PopupHost } from '@renderer/components/PopupHost'

import UserPopup from '../UserPopup'

function showUserPopup(onKeyDown?: ReactType.KeyboardEventHandler<HTMLDivElement>) {
  render(
    <div onKeyDown={onKeyDown}>
      <PopupHost />
    </div>
  )

  // show() adds an entry to the popup store and synchronously notifies PopupHost;
  // wrap it so the resulting useSyncExternalStore re-render runs inside act().
  act(() => {
    void UserPopup.show()
  })
}

describe('UserPopup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    mocks.appEdition = 'cn'
    mocks.themeMode = 'system'
    mocks.statusListener = null
    mocks.ipcRequest.mockImplementation(async (route: string) =>
      route === 'cherry_cloud.status.get' ? { phase: 'signed-out', displayName: null } : undefined
    )
  })

  afterEach(() => {
    // Unmount the host before draining so settling leftover entries triggers no React
    // update on a still-mounted host, then flush the shared singleton store. Fake timers
    // fire the exit phase synchronously (no wall-clock wait).
    cleanup()
    vi.useFakeTimers()
    for (const entry of [...popupService.getSnapshot()]) {
      popupService.settle(entry.instanceId, {})
    }
    vi.advanceTimersByTime(POPUP_EXIT_MS)
    vi.useRealTimers()
  })

  it('renders image avatars with object-cover cropping', async () => {
    const avatar = 'file:///tmp/wide-avatar.png'
    MockUsePreferenceUtils.setPreferenceValue('app.user.avatar', avatar)

    showUserPopup()

    const image = await screen.findByTestId('avatar-image')
    expect(image).toHaveClass('object-cover')
    expect(image).toHaveAttribute('src', avatar)
  })

  it('opens personal information settings from the identity avatar or name', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('app.user.name', 'Yinsen')
    showUserPopup()

    const identity = await screen.findByRole('button', { name: 'settings.general.user_name.label' })
    expect(within(identity).getByTestId('avatar-image')).toBeVisible()
    expect(within(identity).getByText('Yinsen')).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'settings.general.user_name.label' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.avatar' })).not.toBeInTheDocument()

    await user.click(within(identity).getByTestId('avatar-image'))

    expect(mocks.openSettingsTab).toHaveBeenCalledWith('/settings/usage')
    await waitFor(() => expect(screen.queryByTestId('dialog')).not.toBeInTheDocument())
  })

  it('opens settings and closes the account popup from the Settings row', async () => {
    const user = userEvent.setup()
    showUserPopup()

    const settings = await screen.findByRole('button', { name: 'common.settings' })
    expect(settings.parentElement).toHaveClass('gap-0.5', 'pt-1')
    expect(settings.parentElement).not.toHaveClass('mt-0.5')
    expect(screen.getByRole('button', { name: 'settings.general.user_name.label' }).parentElement).toHaveClass('pb-1')
    expect(settings.parentElement?.parentElement).toHaveClass('w-56', 'p-1.5')
    expect(screen.getByRole('button', { name: 'settings.general.user_name.label' })).not.toHaveClass(
      'hover:bg-transparent'
    )

    await user.click(settings)

    expect(mocks.openSettingsTab).toHaveBeenCalledWith()
    await waitFor(() => expect(screen.queryByTestId('dialog')).not.toBeInTheDocument())
  })

  it('changes the existing theme from the account popup appearance control', async () => {
    const user = userEvent.setup()
    showUserPopup()

    const themeControl = await screen.findByRole('radiogroup', { name: 'Appearance' })
    expect(within(themeControl).getByRole('radio', { name: 'settings.theme.system' })).toHaveAttribute(
      'aria-checked',
      'true'
    )

    await user.click(within(themeControl).getByRole('radio', { name: 'settings.theme.dark' }))

    expect(mocks.setTheme).toHaveBeenCalledWith('dark')
  })

  it('starts and cancels Cherry Studio browser authorization', async () => {
    const user = userEvent.setup()
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'cherry_cloud.status.get') return { phase: 'signed-out', displayName: null }
      if (route === 'cherry_cloud.login.start') return { phase: 'authorizing', displayName: null }
      if (route === 'cherry_cloud.login.cancel') return { phase: 'signed-out', displayName: null }
      return undefined
    })
    showUserPopup()

    const loginButton = await screen.findByRole('button', { name: 'settings.provider.cherry_cloud.login' })
    expect(loginButton).toHaveClass('w-full')
    expect(loginButton.parentElement).toBe(screen.getByRole('button', { name: 'common.settings' }).parentElement)
    const appearance = screen.getByRole('radiogroup', { name: 'Appearance' })
    expect(appearance.compareDocumentPosition(loginButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.click(loginButton)

    expect(mocks.ipcRequest).toHaveBeenCalledWith('cherry_cloud.login.start')
    expect(screen.getByRole('status')).toHaveTextContent('settings.provider.cherry_cloud.signing_in')
    const cancelButton = screen.getByRole('button', { name: 'common.cancel' })
    expect(cancelButton).toBeEnabled()
    expect(cancelButton.parentElement).toBe(screen.getByRole('button', { name: 'common.settings' }).parentElement)

    await user.click(cancelButton)

    expect(mocks.ipcRequest).toHaveBeenCalledWith('cherry_cloud.login.cancel')
    expect(await screen.findByRole('button', { name: 'settings.provider.cherry_cloud.login' })).toBeEnabled()
  })

  it('keeps identity in the header and renders the localized Cherry Cloud subtitle', async () => {
    showUserPopup()

    expect(await screen.findByText('Localized Cherry Cloud')).toBeVisible()
    expect(screen.queryByText('Cherry Cloud')).not.toBeInTheDocument()
    const nameButton = screen.getByRole('button', { name: 'settings.general.user_name.label' })
    const loginButton = screen.getByRole('button', { name: 'settings.provider.cherry_cloud.login' })
    expect(nameButton).not.toHaveTextContent('settings.general.user_name.label')
    expect(loginButton).toHaveClass('w-full', 'min-h-7')
    expect(loginButton.parentElement).toBe(screen.getByRole('button', { name: 'common.settings' }).parentElement)
    expect(
      screen.getByRole('radiogroup', { name: 'Appearance' }).compareDocumentPosition(loginButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('shows the signed-in account when browser authorization completes', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setPreferenceValue('app.user.name', 'Yinsen')
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'cherry_cloud.status.get') return { phase: 'signed-out', displayName: null }
      if (route === 'cherry_cloud.login.start') return { phase: 'authorizing', displayName: null }
      return undefined
    })
    showUserPopup()

    await user.click(await screen.findByRole('button', { name: 'settings.provider.cherry_cloud.login' }))
    act(() => mocks.statusListener?.({ phase: 'signed-in', displayName: '189****1942' }))

    expect(screen.getByText('Yinsen')).toBeVisible()
    expect(await screen.findByRole('status')).toHaveTextContent(/^189\*\*\*\*1942$/)
    expect(screen.getByRole('button', { name: 'settings.provider.cherry_cloud.logout' })).toBeEnabled()
    expect(screen.queryByText('Localized Cherry Cloud')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.cancel' })).not.toBeInTheDocument()
  })

  it('keeps the Cherry Cloud login action below appearance in the global edition', async () => {
    mocks.appEdition = 'global'
    showUserPopup()

    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledWith('cherry_cloud.status.get'))

    const loginButton = await screen.findByRole('button', { name: 'settings.provider.cherry_cloud.login' })
    expect(loginButton).toBeVisible()
    expect(
      screen.getByRole('radiogroup', { name: 'Appearance' }).compareDocumentPosition(loginButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('keeps the Cherry Cloud session when logout confirmation is cancelled', async () => {
    const user = userEvent.setup()
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'cherry_cloud.status.get') return { phase: 'signed-in', displayName: 'Sora' }
      return undefined
    })
    showUserPopup()

    const logoutButton = await screen.findByRole('button', { name: 'settings.provider.cherry_cloud.logout' })
    expect(screen.getByRole('status')).toHaveTextContent(/^Sora$/)
    // The persistent row stays neutral; destructive styling is reserved for the confirmation action.
    expect(logoutButton).not.toHaveClass('text-destructive')
    await user.click(logoutButton)

    const confirmDialog = screen.getByRole('dialog', { name: 'Log out?' })
    expect(confirmDialog).toHaveTextContent('Signed in as Sora')
    expect(confirmDialog).toHaveTextContent("You'll need to sign in again to keep using Cherry Cloud.")
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('cherry_cloud.session.revoke')
    await user.click(within(confirmDialog).getByRole('button', { name: 'common.cancel' }))

    expect(screen.queryByRole('dialog', { name: 'Log out?' })).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/^Sora$/)
    expect(screen.getByRole('button', { name: 'settings.provider.cherry_cloud.logout' })).toBeEnabled()
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('cherry_cloud.session.revoke')
  })

  it('revokes the current Cherry Cloud session only after logout is confirmed', async () => {
    const user = userEvent.setup()
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'cherry_cloud.status.get') return { phase: 'signed-in', displayName: 'Sora' }
      if (route === 'cherry_cloud.session.revoke') return { phase: 'signed-out', displayName: null }
      return undefined
    })
    showUserPopup()

    await user.click(await screen.findByRole('button', { name: 'settings.provider.cherry_cloud.logout' }))
    const confirmDialog = screen.getByRole('dialog', { name: 'Log out?' })
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('cherry_cloud.session.revoke')
    await user.click(within(confirmDialog).getByRole('button', { name: 'settings.provider.cherry_cloud.logout' }))

    expect(mocks.ipcRequest).toHaveBeenCalledWith('cherry_cloud.session.revoke')
    expect(await screen.findByRole('button', { name: 'settings.provider.cherry_cloud.login' })).toBeEnabled()
  })

  it('offers a retry when the Cloud account status cannot be loaded', async () => {
    let statusAttempts = 0
    mocks.ipcRequest.mockImplementation(async (route: string) => {
      if (route === 'cherry_cloud.status.get') {
        statusAttempts += 1
        if (statusAttempts === 1) throw new Error('service unavailable')
        return { phase: 'signed-in', displayName: 'Sora' }
      }
      return undefined
    })
    showUserPopup()

    expect(await screen.findByRole('alert')).toHaveTextContent('error.http.503')
    const retryButton = screen.getByRole('button', { name: 'common.retry' })
    expect(retryButton.parentElement).toBe(screen.getByRole('button', { name: 'common.settings' }).parentElement)
    await userEvent.click(retryButton)

    expect(await screen.findByRole('status')).toHaveTextContent('Sora')
    expect(statusAttempts).toBe(2)
  })
})
