// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const calculatorApp: MiniAppType = {
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
  setSidebarFavorites: vi.fn(() => Promise.resolve()),
  miniApps: [] as MiniAppType[],
  pinned: [] as MiniAppType[],
  openedKeepAliveMiniApps: [] as MiniAppType[],
  sidebarFavorites: ['assistants'] as string[]
}))

vi.mock('@cherrystudio/ui', () => ({
  ConfirmDialog: ({ open }: { open?: boolean }) => (open ? <div role="dialog" /> : null)
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

vi.mock('@renderer/components/Icons/MiniAppIcon', () => ({
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
    setOpenedKeepAliveMiniApps: mocks.setOpenedKeepAliveMiniApps,
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

import MiniApp from '../MiniApp'

beforeEach(() => {
  window.toast = {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn()
  } as unknown as typeof window.toast
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mocks.miniApps = []
  mocks.pinned = []
  mocks.openedKeepAliveMiniApps = []
  mocks.sidebarFavorites = ['assistants']
})

describe('MiniApp launchpad pin menu', () => {
  it('adds an enabled mini app to launchpad by pinning status', () => {
    const enabledApp = { ...calculatorApp, status: 'enabled' as const }
    mocks.miniApps = [enabledApp]

    render(<MiniApp app={enabledApp} variant="launchpad" />)
    fireEvent.click(screen.getByRole('button', { name: 'miniApp.add_to_launchpad' }))

    expect(mocks.updateAppStatus).toHaveBeenCalledWith('calculator', 'pinned')
  })

  it('adds a mini app to sidebar favorites', () => {
    const enabledApp = { ...calculatorApp, status: 'enabled' as const }
    mocks.miniApps = [enabledApp]

    render(<MiniApp app={enabledApp} variant="launchpad" />)
    fireEvent.click(screen.getByRole('button', { name: 'miniApp.add_to_sidebar' }))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith(['assistants', 'calculator'])
  })

  it('removes a mini app from sidebar favorites', () => {
    mocks.sidebarFavorites = ['assistants', 'calculator', 'weather']
    mocks.pinned = [calculatorApp]

    render(<MiniApp app={calculatorApp} variant="launchpad" />)
    fireEvent.click(screen.getByRole('button', { name: 'miniApp.remove_from_sidebar' }))

    expect(mocks.setSidebarFavorites).toHaveBeenCalledWith(['assistants', 'weather'])
  })

  it('removes a pinned mini app from launchpad by restoring enabled status', () => {
    mocks.pinned = [calculatorApp]

    render(<MiniApp app={calculatorApp} variant="launchpad" />)
    fireEvent.click(screen.getByRole('button', { name: 'miniApp.remove_from_launchpad' }))

    expect(mocks.updateAppStatus).toHaveBeenCalledWith('calculator', 'enabled')
  })
})
