import type { MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, menuMock, shellMock, appMock, preferenceServiceMock, settingsWindowServiceMock } = vi.hoisted(
  () => {
    const preferenceServiceMock = {
      get: vi.fn(),
      subscribeChange: vi.fn(() => ({ dispose: vi.fn() }))
    }
    const settingsWindowServiceMock = {
      openUsingPreference: vi.fn()
    }

    return {
      preferenceServiceMock,
      settingsWindowServiceMock,
      applicationMock: {
        get: vi.fn((name: string) => {
          if (name === 'PreferenceService') return preferenceServiceMock
          if (name === 'SettingsWindowService') return settingsWindowServiceMock
          if (name === 'WindowManager') {
            return { getAllWindows: vi.fn(() => []) }
          }
          return undefined
        })
      },
      menuMock: {
        buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({ template })),
        setApplicationMenu: vi.fn()
      },
      shellMock: {
        openExternal: vi.fn()
      },
      appMock: {
        name: 'Cherry Studio',
        getLocale: vi.fn(() => 'en-US')
      }
    }
  }
)

vi.mock('@application', () => ({
  application: applicationMock
}))

vi.mock('@main/core/lifecycle', () => {
  class MockBaseService {
    protected readonly _disposables: Array<{ dispose: () => void } | (() => void)> = []

    protected registerDisposable<T extends { dispose: () => void } | (() => void)>(disposable: T): T {
      this._disposables.push(disposable)
      return disposable
    }
  }

  return {
    BaseService: MockBaseService,
    Conditional: () => (target: unknown) => target,
    Injectable: () => (target: unknown) => target,
    onPlatform: () => () => true,
    ServicePhase: () => (target: unknown) => target,
    Phase: { WhenReady: 'whenReady' }
  }
})

vi.mock('@main/utils/zoom', () => ({
  handleZoomFactor: vi.fn()
}))

vi.mock('electron', () => ({
  app: appMock,
  Menu: menuMock,
  shell: shellMock
}))

import { AppMenuService } from '../AppMenuService'

const latestTemplate = () => menuMock.buildFromTemplate.mock.calls.at(-1)?.[0] as MenuItemConstructorOptions[]

describe('AppMenuService', () => {
  let service: AppMenuService

  beforeEach(() => {
    vi.clearAllMocks()
    preferenceServiceMock.get.mockReturnValue(undefined)
    service = new AppMenuService()
  })

  it('registers the settings menu accelerator through the native app menu', async () => {
    await (service as any).onInit()

    const appSubmenu = latestTemplate()[0].submenu as MenuItemConstructorOptions[]
    const settingsItem = appSubmenu.find((item) => item.label === 'Settings')

    expect(settingsItem).toMatchObject({
      accelerator: 'CommandOrControl+,'
    })

    settingsItem?.click?.(undefined as never, undefined as never, undefined as never)

    expect(settingsWindowServiceMock.openUsingPreference).toHaveBeenCalledWith('/settings/provider')
  })
})
