// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SidebarFavoriteItem } from '@shared/data/preference/preferenceTypes'
import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'

const calculatorApp: MiniAppType = {
  kind: 'site',
  appId: 'calculator',
  presetMiniAppId: 'calculator',
  status: 'pinned',
  orderKey: 'a0',
  name: 'Calculator',
  url: 'https://calc.example',
  logo: 'calculator-logo'
}

const mocks = vi.hoisted(() => ({
  openTab: vi.fn(),
  updateAppStatus: vi.fn(() => Promise.resolve()),
  removeCustomMiniApp: vi.fn(() => Promise.resolve()),
  setOpenedKeepAliveMiniApps: vi.fn(),
  setSplitOpen: vi.fn(),
  setSplitMiniAppId: vi.fn(),
  setSidebarFavorites: vi.fn(() => Promise.resolve()),
  miniApps: [] as MiniAppType[],
  pinned: [] as MiniAppType[],
  openedKeepAliveMiniApps: [] as MiniAppType[],
  splitMiniAppId: '',
  sidebarFavorites: [{ type: 'app', id: 'assistants' }] as SidebarFavoriteItem[]
}))

vi.mock('@cherrystudio/ui', () => ({
  ConfirmDialog: ({ open }: { open?: boolean }) => (open ? <div role="dialog" /> : null),
  // The hover text is rendered inline so a case can read what the dot means.
  Tooltip: ({ children, content, isDisabled }: { children: ReactNode; content?: ReactNode; isDisabled?: boolean }) => (
    <div>
      {children}
      {!isDisabled && content}
    </div>
  )
}))

// An independently tested child (its own suite next door); the real panel pulls the
// model selector, which needs far more of `@cherrystudio/ui` than this file's stand-in.
// A call-recording boundary: it shows which app it was opened for and can ask to close.
vi.mock('../MiniAppDetailPanel', () => ({
  default: ({ appId, onClose }: { appId: string; onClose?: () => void }) => (
    <div role="dialog" aria-label="mini-app-detail" data-app-id={appId}>
      <button type="button" onClick={onClose}>
        close-detail
      </button>
    </div>
  )
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn()
    })
  }
}))

vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({
    children,
    extraItems
  }: {
    children: ReactNode
    extraItems: Array<{ id: string; label: string; onSelect: () => void }>
  }) => (
    <div>
      {children}
      {extraItems.map((item) => (
        <button key={item.id} type="button" onClick={item.onSelect}>
          {item.label}
        </button>
      ))}
    </div>
  )
}))

vi.mock('@renderer/components/icons/MiniAppIcon', () => ({
  default: ({ app }: { app: MiniAppType }) => <div data-testid={`mini-app-icon-${app.appId}`} />
}))

vi.mock('@renderer/components/IndicatorLight', () => ({
  default: () => <div data-testid="indicator-light" />
}))

vi.mock('@renderer/components/MarqueeText', () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    miniApps: mocks.miniApps,
    pinned: mocks.pinned,
    openedKeepAliveMiniApps: mocks.openedKeepAliveMiniApps,
    currentMiniAppId: '',
    miniAppShow: false,
    splitMiniAppId: mocks.splitMiniAppId,
    setOpenedKeepAliveMiniApps: mocks.setOpenedKeepAliveMiniApps,
    setSplitOpen: mocks.setSplitOpen,
    setSplitMiniAppId: mocks.setSplitMiniAppId,
    updateAppStatus: mocks.updateAppStatus,
    removeCustomMiniApp: mocks.removeCustomMiniApp
  })
}))

vi.mock('@data/hooks/usePreference', () => ({
  usePreference: (key: string) => {
    if (key === 'ui.sidebar.favorites') return [mocks.sidebarFavorites, mocks.setSidebarFavorites]
    return [undefined, vi.fn()]
  }
}))

vi.mock('@renderer/hooks/tab', () => ({
  useTabs: () => ({
    openTab: mocks.openTab
  })
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'

import MiniApp from '../MiniApp'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  MockUseCacheUtils.resetMocks()
  mocks.miniApps = []
  mocks.pinned = []
  mocks.openedKeepAliveMiniApps = []
  mocks.splitMiniAppId = ''
  mocks.sidebarFavorites = [{ type: 'app', id: 'assistants' }]
})

describe('MiniApp launchpad pin menu', () => {
  it.each(['Enter', ' '])('opens the mini app tab with the %j key', (key) => {
    mocks.miniApps = [calculatorApp]

    render(<MiniApp app={calculatorApp} variant="launchpad" />)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Calculator' }), { key })

    expect(mocks.openTab).toHaveBeenCalledWith('/app/mini-app/calculator', {
      title: 'Calculator',
      icon: 'calculator-logo'
    })
  })

  it('adds an enabled mini app to launchpad by pinning status', () => {
    const enabledApp = { ...calculatorApp, status: 'enabled' as const }
    mocks.miniApps = [enabledApp]

    const { container } = render(<MiniApp app={enabledApp} variant="launchpad" />)

    expect(container.querySelector('.mini-app-icon-frame')).not.toHaveClass('overflow-hidden')
    expect(container.querySelector('.mini-app-icon-clip')).toHaveClass('overflow-hidden')
    fireEvent.click(screen.getByRole('button', { name: 'miniApp.add_to_launchpad' }))

    expect(mocks.updateAppStatus).toHaveBeenCalledWith('calculator', 'pinned')
  })

  it('adds a mini app to sidebar favorites', () => {
    const enabledApp = { ...calculatorApp, status: 'enabled' as const }
    mocks.miniApps = [enabledApp]

    render(<MiniApp app={enabledApp} variant="launchpad" />)
    fireEvent.click(screen.getByRole('button', { name: 'miniApp.add_to_sidebar' }))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith([
      { type: 'app', id: 'assistants' },
      { type: 'mini_app', id: 'calculator' }
    ])
  })

  it('clips the launchpad icon without clipping the opened indicator', () => {
    mocks.miniApps = [calculatorApp]
    mocks.openedKeepAliveMiniApps = [calculatorApp]

    const { container } = render(<MiniApp app={calculatorApp} variant="launchpad" />)
    const frame = container.querySelector('.mini-app-icon-frame')
    const iconClip = container.querySelector('.mini-app-icon-clip')
    const indicator = screen.getByTestId('indicator-light')

    expect(frame).toContainElement(indicator)
    expect(iconClip).not.toContainElement(indicator)
  })

  it('removes a mini app from sidebar favorites', () => {
    mocks.sidebarFavorites = [
      { type: 'app', id: 'assistants' },
      { type: 'mini_app', id: 'calculator' },
      { type: 'mini_app', id: 'weather' }
    ]
    mocks.pinned = [calculatorApp]

    render(<MiniApp app={calculatorApp} variant="launchpad" />)
    fireEvent.click(screen.getByRole('button', { name: 'miniApp.remove_from_sidebar' }))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith([
      { type: 'app', id: 'assistants' },
      { type: 'mini_app', id: 'weather' }
    ])
  })

  it('collapses the split pane when the hidden mini app is the one in it', async () => {
    const enabledApp = { ...calculatorApp, status: 'enabled' as const }
    mocks.miniApps = [enabledApp]
    mocks.splitMiniAppId = 'calculator'

    render(<MiniApp app={enabledApp} variant="launchpad" />)
    fireEvent.click(screen.getByRole('button', { name: 'miniApp.sidebar.hide.title' }))
    await waitFor(() => expect(mocks.setOpenedKeepAliveMiniApps).toHaveBeenCalled())

    // Hiding drops the app's webview from the pool, so a split still pointing at
    // it would leave the right pane stuck on its loading mask.
    expect(mocks.setSplitMiniAppId).toHaveBeenCalledWith('')
    expect(mocks.setSplitOpen).toHaveBeenCalledWith(false)
  })

  it('keeps the split pane when the hidden mini app is not the one in it', async () => {
    const enabledApp = { ...calculatorApp, status: 'enabled' as const }
    mocks.miniApps = [enabledApp]
    mocks.splitMiniAppId = 'weather'

    render(<MiniApp app={enabledApp} variant="launchpad" />)
    fireEvent.click(screen.getByRole('button', { name: 'miniApp.sidebar.hide.title' }))
    await waitFor(() => expect(mocks.setOpenedKeepAliveMiniApps).toHaveBeenCalled())

    expect(mocks.setSplitMiniAppId).not.toHaveBeenCalled()
    expect(mocks.setSplitOpen).not.toHaveBeenCalled()
  })

  it('removes a pinned mini app from launchpad by restoring enabled status', () => {
    mocks.pinned = [calculatorApp]

    render(<MiniApp app={calculatorApp} variant="launchpad" />)
    fireEvent.click(screen.getByRole('button', { name: 'miniApp.remove_from_launchpad' }))

    expect(mocks.updateAppStatus).toHaveBeenCalledWith('calculator', 'enabled')
  })
})

describe('MiniApp installed-app menu', () => {
  const installedApp: MiniAppType = {
    appId: 'com.example.mygame',
    presetMiniAppId: null,
    kind: 'app',
    version: '1.0.0',
    nameI18n: { en: 'My Game' },
    aiModelId: null,
    aiQuickModelId: null,
    status: 'pinned',
    orderKey: 'a0',
    name: 'My Game',
    url: 'cherry-miniapp://com.example.mygame/index.html'
  }

  it('offers view-details but neither edit nor delete for an installed app', () => {
    // An installed app's `presetMiniAppId` is null too, so the old condition showed both —
    // and the service layer now refuses them, turning a rule into an error toast.
    mocks.miniApps = [installedApp]

    render(<MiniApp app={installedApp} variant="launchpad" onEditCustom={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'miniApp.detail.open' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'common.edit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'common.delete' })).toBeNull()
  })

  it('still offers edit and delete for a user-added site', () => {
    // Negative control: gating on `kind` must not take the menu away from the rows it
    // was written for. Without this, hiding the items unconditionally also passes.
    const site: MiniAppType = { ...calculatorApp, appId: 'my-site', presetMiniAppId: null }
    mocks.miniApps = [site]

    render(<MiniApp app={site} variant="launchpad" onEditCustom={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'common.edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'common.delete' })).toBeInTheDocument()
  })

  it('opens the detail panel for THIS app from the menu and takes it down on close', () => {
    // The bug this guards: a "View details" entry that exists but is wired to nothing,
    // or a panel that cannot be dismissed — the menu case above proves only the label.
    mocks.miniApps = [installedApp]
    render(<MiniApp app={installedApp} variant="launchpad" />)
    expect(screen.queryByRole('dialog', { name: 'mini-app-detail' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'miniApp.detail.open' }))
    expect(screen.getByRole('dialog', { name: 'mini-app-detail' })).toHaveAttribute('data-app-id', installedApp.appId)

    fireEvent.click(screen.getByRole('button', { name: 'close-detail' }))
    expect(screen.queryByRole('dialog', { name: 'mini-app-detail' })).toBeNull()
  })
})

describe('MiniApp attention badge', () => {
  it('lights the badge on the app the host flagged, and on no other', () => {
    // Two tiles, one flagged: a badge keyed on "any app needs attention" rather than
    // THIS app lights both, and a single-tile case cannot tell the two apart.
    const weatherApp: MiniAppType = { ...calculatorApp, appId: 'weather', presetMiniAppId: 'weather', name: 'Weather' }
    mocks.miniApps = [calculatorApp, weatherApp]
    MockUseCacheUtils.setSharedCacheValue('mini_app.attention', [
      { appId: 'weather', updateVersion: '1.2.0', pendingPermissions: [], updating: null }
    ])

    render(
      <>
        <MiniApp app={calculatorApp} variant="launchpad" />
        <MiniApp app={weatherApp} variant="launchpad" />
      </>
    )

    const badges = screen.getAllByTestId('attention-badge')
    expect(badges).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Weather' })).toContainElement(badges[0])
  })

  it('shows the download wedge instead of the dot while an update lands, and offers no second update', () => {
    mocks.miniApps = [calculatorApp]
    MockUseCacheUtils.setSharedCacheValue('mini_app.attention', [
      {
        appId: calculatorApp.appId,
        updateVersion: '1.2.0',
        pendingPermissions: [],
        updating: { version: '1.2.0', fraction: 0.4 }
      }
    ])
    render(<MiniApp app={calculatorApp} variant="launchpad" />)

    expect(screen.getByTestId('update-progress')).toBeInTheDocument()
    expect(screen.queryByTestId('attention-badge')).toBeNull()
    expect(screen.getByText('miniApp.attention.updating')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'miniApp.menu.updating' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'miniApp.menu.update' })).toBeNull()
  })

  it('says why on hover and offers the action in the menu', async () => {
    // The dot alone is a riddle: hovering the icon names the reason, and the context menu
    // carries the matching action — an update item, a grant item, or both.
    mocks.miniApps = [calculatorApp]
    MockUseCacheUtils.setSharedCacheValue('mini_app.attention', [
      { appId: calculatorApp.appId, updateVersion: '1.2.0', pendingPermissions: ['storage.clear'], updating: null }
    ])
    render(<MiniApp app={calculatorApp} variant="launchpad" />)

    expect(screen.getByText('miniApp.attention.update')).toBeInTheDocument()
    expect(screen.getByText('miniApp.attention.pending')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'miniApp.menu.update' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'miniApp.menu.grant_pending' })).toBeInTheDocument()
  })
})
