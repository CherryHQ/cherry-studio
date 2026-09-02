import type * as CherryStudioUI from '@cherrystudio/ui'
import type * as UseCacheModule from '@data/hooks/useCache'
import type * as MiniAppPresets from '@shared/data/presets/miniApps'
import type { MiniApp, SiteMiniApp } from '@shared/data/types/miniApp'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MiniAppsPage from '../MiniAppsPage'

const stubApp = (overrides: Partial<SiteMiniApp> & Pick<SiteMiniApp, 'appId' | 'name' | 'url'>): MiniApp => ({
  kind: 'site',
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
  allApps: [] as MiniApp[],
  pinned: [] as MiniApp[],
  openedKeepAliveMiniApps: [] as MiniApp[],
  updateAppStatus: vi.fn().mockResolvedValue(undefined),
  removeCustomMiniApp: vi.fn().mockResolvedValue(undefined),
  openTab: vi.fn(),
  request: vi.fn().mockResolvedValue(null),
  toastError: vi.fn(),
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
    appEdition: 'global',
    allApps: mocks.allApps,
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

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))

vi.mock('@renderer/services/toast', () => ({
  toast: { error: mocks.toastError, success: vi.fn() }
}))

// Partial: the installed tile reads `useSharedCacheValue` from the same module.
vi.mock('@data/hooks/useCache', async (importOriginal) => ({
  ...(await importOriginal<typeof UseCacheModule>()),
  useCache: () => ['/opt/cherry/resources']
}))

// The shipped catalog is empty this release; the offer section needs entries to render.
vi.mock('@shared/data/presets/miniApps', async (importOriginal) => ({
  ...(await importOriginal<typeof MiniAppPresets>()),
  BUILTIN_MINI_APPS: [
    { appId: 'com.cherrystudio.miniapp.notes', name: { en: 'Notes' }, icon: 'icon.webp' },
    { appId: 'com.cherrystudio.miniapp.draw', name: { en: 'Draw' }, icon: 'icon.webp' }
  ]
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

vi.mock('@renderer/components/Navbar', () => ({
  Navbar: ({ children }: React.PropsWithChildren) => <div data-testid="navbar">{children}</div>,
  NavbarCenter: ({ children }: React.PropsWithChildren) => <div>{children}</div>
}))

vi.mock('@renderer/components/icons/MiniAppIcon', () => ({
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

vi.mock('../InstallMiniAppPanel', () => ({
  default: ({ builtinAppId, onClose }: { builtinAppId?: string; onClose?: () => void }) => (
    <div data-testid="install-mini-app-panel" data-builtin-app-id={builtinAppId}>
      <button type="button" onClick={onClose}>
        close-install
      </button>
    </div>
  )
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } })
}))

describe('MiniAppsPage', () => {
  beforeEach(() => {
    mocks.apps = [
      stubApp({ appId: 'chatgpt', name: 'ChatGPT', url: 'https://chat.openai.com', logo: 'chat-logo' }),
      stubApp({ appId: 'gemini', name: 'Gemini', url: 'https://gemini.google.com', logo: 'gemini-logo' })
    ]
    mocks.allApps = []
    mocks.pinned = []
    mocks.openedKeepAliveMiniApps = []
    mocks.updateAppStatus.mockClear()
    mocks.removeCustomMiniApp.mockClear()
    mocks.openTab.mockClear()
    mocks.request.mockReset().mockResolvedValue(null)
    mocks.toastError.mockClear()
    mocks.useMiniAppVisibility.mockClear()
    ;(window as unknown as { toast: { success: () => void; error: () => void; warning: () => void } }).toast = {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn()
    }
  })

  it('filters mini apps by search', () => {
    render(<MiniAppsPage />)

    expect(screen.getByText('ChatGPT')).toBeInTheDocument()
    expect(screen.getByText('Gemini')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('common.search'), { target: { value: 'chat' } })

    expect(screen.getByText('ChatGPT')).toBeInTheDocument()
    expect(screen.queryByText('Gemini')).not.toBeInTheDocument()
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

  it('adds a launchpad entry that opens the add dialog in create mode', () => {
    render(<MiniAppsPage />)
    // The install panel has no toolbar entry of its own any more: packages are a tab of
    // the add dialog, and only a builtin tile mounts the standalone panel.
    expect(screen.queryByRole('button', { name: 'miniApp.install.title' })).toBeNull()
    expect(screen.queryByTestId('new-mini-app-panel')).toBeNull()

    const addEntries = screen.getAllByRole('button', { name: 'miniApp.add.title' })
    expect(addEntries).toHaveLength(2)

    fireEvent.click(addEntries[1])
    expect(screen.getByTestId('new-mini-app-panel')).toHaveAttribute('data-app-id', '')
  })

  it('requests an install preview for a dropped .miniapp package', async () => {
    const fileApi = window.api.file as typeof window.api.file & { getPathForFile: (file: File) => string }
    const nativeFile = new File(['package'], 'example.miniapp')
    const convertedFile = new File(['package'], 'example.miniapp')
    fileApi.getPathForFile = vi.fn((file) => (file === nativeFile ? '/tmp/example.miniapp' : ''))
    const { container } = render(<MiniAppsPage />)
    const page = container.querySelector('[data-ui="mini-apps.view"]')
    const item = { kind: 'file', type: '', getAsFile: () => convertedFile }

    fireEvent.dragEnter(page!, { dataTransfer: { files: [], items: [item], types: ['Files'], dropEffect: 'none' } })
    expect(await screen.findByRole('status')).toHaveTextContent('miniApp.install.drop_here')

    fireEvent.drop(page!, {
      dataTransfer: { files: [nativeFile], items: [item], types: ['Files'], dropEffect: 'none' }
    })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith('mini_app.install.preview_file', {
        filePath: '/tmp/example.miniapp'
      })
    })
    expect(fileApi.getPathForFile).toHaveBeenCalledWith(nativeFile)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('rejects drops that are not exactly one .miniapp package', async () => {
    const fileApi = window.api.file as typeof window.api.file & { getPathForFile: (file: File) => string }
    fileApi.getPathForFile = vi.fn(() => '/tmp/notes.txt')
    const { container } = render(<MiniAppsPage />)
    const page = container.querySelector('[data-ui="mini-apps.view"]')

    fireEvent.drop(page!, {
      dataTransfer: { files: [new File(['notes'], 'notes.txt')], types: ['Files'], dropEffect: 'none' }
    })

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('miniApp.install.drop_invalid'))
    expect(fileApi.getPathForFile).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalledWith('mini_app.install.preview_file', expect.anything())
  })

  it('leaves file drag handling to the add dialog while it is open', () => {
    const fileApi = window.api.file as typeof window.api.file & { getPathForFile: (file: File) => string }
    fileApi.getPathForFile = vi.fn(() => '/tmp/example.miniapp')
    const { container } = render(<MiniAppsPage />)
    const page = container.querySelector('[data-ui="mini-apps.view"]')
    const file = new File(['package'], 'example.miniapp')
    const dataTransfer = { files: [file], types: ['Files'], dropEffect: 'none' }

    fireEvent.click(screen.getAllByRole('button', { name: 'miniApp.add.title' })[0])
    fireEvent.dragEnter(page!, { dataTransfer })
    fireEvent.drop(page!, { dataTransfer })

    expect(screen.queryByRole('status')).toBeNull()
    expect(fileApi.getPathForFile).not.toHaveBeenCalled()
    expect(mocks.request).not.toHaveBeenCalledWith('mini_app.install.preview_file', expect.anything())
  })

  it('offers an uninstalled builtin, and routes it to consent rather than open', () => {
    mocks.apps = []
    mocks.allApps = []
    render(<MiniAppsPage />)

    expect(screen.getByText('miniApp.builtin.not_installed')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Notes' }))

    // The id goes to the CONSENT flow (the panel requests `preview_builtin` itself);
    // the installed tile's handler would open a tab for an app with no files on disk.
    expect(screen.getByTestId('install-mini-app-panel')).toHaveAttribute(
      'data-builtin-app-id',
      'com.cherrystudio.miniapp.notes'
    )
    expect(mocks.openTab).not.toHaveBeenCalled()
  })

  it('drops installed builtins from the offer', () => {
    // `stubApp` defaults `presetMiniAppId` to `appId`, which is what the installer
    // writes for an official package — the real predicate, not a stand-in.
    const installed = ['com.cherrystudio.miniapp.notes', 'com.cherrystudio.miniapp.draw'].map((appId) =>
      stubApp({ appId, name: appId, url: `cherry-miniapp://${appId}/index.html` })
    )
    mocks.apps = installed
    mocks.allApps = installed

    render(<MiniAppsPage />)

    // BOTH catalog entries installed, or the section stays up for the remaining offer
    // and the assertion tests the fixture, not the filter.
    expect(screen.queryByText('miniApp.builtin.not_installed')).toBeNull()
  })

  it('does not re-offer an installed builtin the user disabled', () => {
    // `allApps` is the load-bearing choice: `miniApps` omits disabled rows, so a
    // disabled official app would be re-offered an install that must fail on its id.
    const hidden = ['com.cherrystudio.miniapp.notes', 'com.cherrystudio.miniapp.draw'].map((appId) =>
      stubApp({ appId, name: appId, url: `cherry-miniapp://${appId}/index.html`, status: 'disabled' })
    )
    mocks.apps = []
    mocks.allApps = hidden

    render(<MiniAppsPage />)

    expect(screen.queryByText('miniApp.builtin.not_installed')).toBeNull()
  })
})
