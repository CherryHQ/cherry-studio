import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  currentMiniAppId: '',
  miniApps: [] as MiniAppType[],
  miniAppShow: false,
  openedKeepAliveMiniApps: [] as MiniAppType[],
  pinned: [] as MiniAppType[],
  openTab: vi.fn(),
  removeCustomMiniApp: vi.fn(),
  setOpenedKeepAliveMiniApps: vi.fn((next: MiniAppType[] | ((prev: MiniAppType[]) => MiniAppType[])) => {
    mocks.openedKeepAliveMiniApps =
      typeof next === 'function'
        ? (next as (prev: MiniAppType[]) => MiniAppType[])(mocks.openedKeepAliveMiniApps)
        : next
  }),
  updateAppStatus: vi.fn()
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/hooks/useMiniApps', () => ({
  useMiniApps: () => ({
    currentMiniAppId: mocks.currentMiniAppId,
    miniApps: mocks.miniApps,
    miniAppShow: mocks.miniAppShow,
    openedKeepAliveMiniApps: mocks.openedKeepAliveMiniApps,
    pinned: mocks.pinned,
    removeCustomMiniApp: mocks.removeCustomMiniApp,
    setOpenedKeepAliveMiniApps: mocks.setOpenedKeepAliveMiniApps,
    updateAppStatus: mocks.updateAppStatus
  })
}))

vi.mock('@renderer/hooks/useTabs', () => ({
  useTabs: () => ({
    openTab: mocks.openTab
  })
}))

vi.mock('@renderer/components/Icons/MiniAppIcon', () => ({
  default: ({ app }: { app: MiniAppType }) => <span data-testid="mini-app-icon">{app.appId}</span>
}))

vi.mock('@renderer/components/IndicatorLight', () => ({
  default: () => <span data-testid="indicator-light" />
}))

vi.mock('@renderer/components/MarqueeText', () => ({
  default: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))

vi.mock('@renderer/components/command', () => ({
  CommandContextMenu: ({
    children,
    extraItems
  }: {
    children: ReactNode
    extraItems?: Array<{ id: string; label: ReactNode; onSelect?: () => void; type: string }>
  }) => (
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

import MiniApp from '../MiniApp'

const createMiniApp = (appId: string): MiniAppType => ({
  appId: appId,
  logo: '',
  name: appId,
  orderKey: appId,
  presetMiniAppId: appId as MiniAppType['presetMiniAppId'],
  status: 'enabled',
  url: `https://${appId}.example.com`
})

describe('MiniApp', () => {
  beforeEach(() => {
    mocks.currentMiniAppId = ''
    mocks.miniApps = []
    mocks.miniAppShow = false
    mocks.openedKeepAliveMiniApps = []
    mocks.pinned = []
    mocks.openTab.mockReset()
    mocks.removeCustomMiniApp.mockReset()
    mocks.setOpenedKeepAliveMiniApps.mockClear()
    mocks.updateAppStatus.mockReset()

    Object.defineProperty(window, 'toast', {
      configurable: true,
      value: {
        error: vi.fn(),
        success: vi.fn(),
        warning: vi.fn()
      }
    })
  })

  it('removes a hidden app from the latest keep-alive list after status update resolves', async () => {
    const appA = createMiniApp('app-a')
    const appB = createMiniApp('app-b')
    const appC = createMiniApp('app-c')
    mocks.miniApps = [appA]
    mocks.openedKeepAliveMiniApps = [appA, appB]
    let resolveHide: (app: MiniAppType) => void = () => {}
    mocks.updateAppStatus.mockReturnValue(
      new Promise<MiniAppType>((resolve) => {
        resolveHide = resolve
      })
    )

    render(<MiniApp app={appA} />)
    fireEvent.click(screen.getByRole('button', { name: 'miniApp.sidebar.hide.title' }))
    mocks.openedKeepAliveMiniApps = [appA, appB, appC]

    await act(async () => {
      resolveHide(appA)
    })

    await waitFor(() => {
      expect(mocks.openedKeepAliveMiniApps.map((app) => app.appId)).toEqual(['app-b', 'app-c'])
    })
    expect(mocks.setOpenedKeepAliveMiniApps).toHaveBeenCalledWith(expect.any(Function))
  })
})
