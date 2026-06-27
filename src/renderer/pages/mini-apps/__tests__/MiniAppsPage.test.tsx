import type * as CherryStudioUI from '@cherrystudio/ui'
import type { MiniApp } from '@shared/data/types/miniApp'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MiniAppsPage from '../MiniAppsPage'

const stubApp = (overrides: Partial<MiniApp> & Pick<MiniApp, 'appId' | 'name' | 'url'>): MiniApp => ({
  appId: overrides.appId,
  presetMiniAppId: 'presetMiniAppId' in overrides ? (overrides.presetMiniAppId ?? null) : overrides.appId,
  status: overrides.status ?? 'enabled',
  orderKey: overrides.orderKey ?? 'a0',
  name: overrides.name,
  nameKey: overrides.nameKey,
  url: overrides.url,
  logo: overrides.logo ?? `${overrides.appId}-logo`,
  bordered: overrides.bordered,
  background: overrides.background,
  supportedRegions: overrides.supportedRegions
})

const mocks = vi.hoisted(() => ({
  apps: [] as MiniApp[],
  pinned: [] as MiniApp[],
  openedKeepAliveMiniApps: [] as MiniApp[],
  updateAppStatus: vi.fn().mockResolvedValue(undefined),
  removeCustomMiniApp: vi.fn().mockResolvedValue(undefined),
  openTab: vi.fn(),
  useMiniAppVisibility: vi.fn(() => ({
    visible: [],
    hidden: [],
    swap: vi.fn(),
    reset: vi.fn(),
    hide: vi.fn(),
    show: vi.fn(),
    reorderVisible: vi.fn(),
    reorderHidden: vi.fn()
  }))
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    miniApps: mocks.apps,
    pinned: mocks.pinned,
    openedKeepAliveMiniApps: mocks.openedKeepAliveMiniApps,
    currentMiniAppId: '',
    miniAppShow: false,
    setOpenedKeepAliveMiniApps: vi.fn(),
    updateAppStatus: mocks.updateAppStatus,
    removeCustomMiniApp: mocks.removeCustomMiniApp,
    isLoading: false,
    error: null
  })
}))

vi.mock('@renderer/hooks/tab', () => ({
  useTabs: () => ({
    openTab: mocks.openTab
  })
}))

vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({
    children,
    extraItems
  }: React.PropsWithChildren<{
    extraItems?: Array<{ type: string; id: string; label: string; onSelect?: () => void }>
  }>) => (
    <div>
      {children}
      {extraItems?.map((item) =>
        item.type === 'item' ? (
          <button key={item.id} type="button" onClick={item.onSelect}>
            {item.label}
          </button>
        ) : null
      )}
    </div>
  )
}))

vi.mock('@cherrystudio/ui', async () => {
  const actual = await vi.importActual<typeof CherryStudioUI>('@cherrystudio/ui')

  return {
    ...actual,
    EmptyState: ({ title }: { title: string }) => <div>{title}</div>,
    ContextMenu: ({ children }: React.PropsWithChildren) => <div data-testid="context-menu">{children}</div>,
    ContextMenuTrigger: ({ children }: React.PropsWithChildren<{ asChild?: boolean }>) => (
      <div data-testid="context-menu-trigger">{children}</div>
    ),
    ContextMenuContent: ({ children }: React.PropsWithChildren) => (
      <div data-testid="context-menu-content">{children}</div>
    ),
    ContextMenuItem: ({ children, onSelect }: React.PropsWithChildren<{ onSelect?: () => void }>) => (
      <button data-testid="context-menu-item" type="button" onClick={onSelect}>
        {children}
      </button>
    ),
    ConfirmDialog: ({
      open,
      title,
      description,
      confirmText,
      cancelText,
      onOpenChange,
      onConfirm
    }: {
      open?: boolean
      title: React.ReactNode
      description?: React.ReactNode
      confirmText?: string
      cancelText?: string
      onOpenChange?: (open: boolean) => void
      onConfirm?: () => void | Promise<void>
    }) =>
      open ? (
        <div role="dialog">
          <div>{title}</div>
          <div>{description}</div>
          <button type="button" onClick={() => onOpenChange?.(false)}>
            {cancelText}
          </button>
          <button type="button" onClick={onConfirm}>
            {confirmText}
          </button>
        </div>
      ) : null
  }
})

vi.mock('@renderer/components/app/Navbar', () => ({
  Navbar: ({ children }: React.PropsWithChildren) => <div data-testid="navbar">{children}</div>,
  NavbarCenter: ({ children }: React.PropsWithChildren) => <div>{children}</div>
}))

vi.mock('@renderer/components/Icons/MiniAppIcon', () => ({
  default: ({ app, size }: { app: MiniApp; size: number }) => (
    <img alt={app.name} data-testid={`mini-app-icon-${app.appId}`} height={size} src={app.logo} width={size} />
  )
}))

vi.mock('@renderer/components/MarqueeText', () => ({
  default: ({ children }: React.PropsWithChildren) => <span>{children}</span>
}))

vi.mock('react-spinners/BeatLoader', () => ({
  default: () => <div data-testid="beat-loader" />
}))

vi.mock('../MiniAppSettings/useMiniAppVisibility', () => ({
  useMiniAppVisibility: mocks.useMiniAppVisibility
}))

vi.mock('../MiniAppSettings/MiniAppSettingsPanel', () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="mini-app-settings-panel" /> : null)
}))

vi.mock('../MiniAppSettings/MiniAppListPair', () => ({
  default: () => <div data-testid="mini-app-list-pair" />
}))

vi.mock('../MiniAppSettings/MiniAppDisplaySettings', () => ({
  default: () => <div data-testid="mini-app-display-settings" />
}))

vi.mock('../NewMiniAppPanel', () => ({
  default: ({ open, app }: { open: boolean; app?: MiniApp | null }) =>
    open ? <div data-testid="new-mini-app-panel" data-app-id={app?.appId ?? ''} /> : null
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

describe('MiniAppsPage', () => {
  beforeEach(() => {
    mocks.apps = [
      stubApp({ appId: 'chatgpt', name: 'ChatGPT', url: 'https://chat.openai.com', logo: 'chat-logo' }),
      stubApp({ appId: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', logo: 'gemini-logo' })
    ]
    mocks.pinned = []
    mocks.openedKeepAliveMiniApps = []
    mocks.updateAppStatus.mockClear()
    mocks.removeCustomMiniApp.mockClear()
    mocks.openTab.mockClear()
    mocks.useMiniAppVisibility.mockClear()
    ;(window as unknown as { toast: { success: () => void; error: () => void; warning: () => void } }).toast = {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn()
    }
  })

  it('filters mini apps by search without rendering the old title count row', () => {
    render(<MiniAppsPage />)

    expect(screen.getByText('ChatGPT')).toBeInTheDocument()
    expect(screen.getByText('Gemini')).toBeInTheDocument()
    expect(screen.queryByText('2')).not.toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('common.search'), { target: { value: 'chat' } })

    expect(screen.getByText('ChatGPT')).toBeInTheDocument()
    expect(screen.queryByText('Gemini')).not.toBeInTheDocument()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })

  it('opens the selected mini app without changing the tab contract', () => {
    render(<MiniAppsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT' }))

    expect(mocks.openTab).toHaveBeenCalledWith('/app/mini-app/chatgpt', {
      title: 'ChatGPT',
      icon: 'chat-logo'
    })
  })

  it('keeps context menu actions wired to mini app mutations', async () => {
    mocks.apps = [
      stubApp({
        appId: 'custom',
        name: 'Custom App',
        url: 'https://custom.example.com',
        logo: 'custom-logo',
        presetMiniAppId: null
      })
    ]

    render(<MiniAppsPage />)

    fireEvent.click(screen.getByRole('button', { name: 'miniApp.add_to_launchpad' }))
    await waitFor(() => expect(mocks.updateAppStatus).toHaveBeenCalledWith('custom', 'pinned'))

    fireEvent.click(screen.getByRole('button', { name: 'miniApp.sidebar.hide.title' }))
    await waitFor(() => expect(mocks.updateAppStatus).toHaveBeenCalledWith('custom', 'disabled'))

    fireEvent.click(screen.getByRole('button', { name: 'common.edit' }))
    expect(screen.getByTestId('new-mini-app-panel')).toHaveAttribute('data-app-id', 'custom')

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))
    expect(mocks.removeCustomMiniApp).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toHaveTextContent('settings.miniApps.custom.remove_confirm_title')

    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
    expect(mocks.removeCustomMiniApp).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'common.delete' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'common.delete' }))
    await waitFor(() => expect(mocks.removeCustomMiniApp).toHaveBeenCalledWith('custom'))
  })
})
