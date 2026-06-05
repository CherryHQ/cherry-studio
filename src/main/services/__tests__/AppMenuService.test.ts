import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  applicationMock,
  menuMock,
  shellMock,
  appMock,
  preferenceServiceMock,
  settingsWindowServiceMock,
  commandServiceMock
} = vi.hoisted(() => {
  const preferenceServiceMock = {
    get: vi.fn(),
    subscribeChange: vi.fn(() => ({ dispose: vi.fn() }))
  }
  const settingsWindowServiceMock = {
    open: vi.fn()
  }
  const commandServiceMock = {
    execute: vi.fn()
  }

  return {
    preferenceServiceMock,
    settingsWindowServiceMock,
    commandServiceMock,
    applicationMock: {
      get: vi.fn((name: string) => {
        if (name === 'PreferenceService') return preferenceServiceMock
        if (name === 'SettingsWindowService') return settingsWindowServiceMock
        if (name === 'CommandService') return commandServiceMock
        if (name === 'WindowManager') {
          return { getWindowsByType: vi.fn(() => []) }
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
})

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

    expect(commandServiceMock.execute).toHaveBeenCalledWith('app.settings.open', undefined)
  })

  it('opens the About settings route from the native app menu', async () => {
    await (service as any).onInit()

    const appSubmenu = latestTemplate()[0].submenu as MenuItemConstructorOptions[]
    const aboutItem = appSubmenu.find((item) => String(item.label).startsWith('About '))

    aboutItem?.click?.(undefined as never, undefined as never, undefined as never)

    expect(settingsWindowServiceMock.open).toHaveBeenCalledWith('/settings/about')
  })

  it('uses default zoom accelerators and wires them to zoom handling', async () => {
    await (service as any).onInit()

    const window = { id: 1 } as BrowserWindow
    const viewSubmenu = latestTemplate()[3].submenu as MenuItemConstructorOptions[]
    const zoomInItem = viewSubmenu.find((item) => item.accelerator === 'CommandOrControl+=')
    const zoomOutItem = viewSubmenu.find((item) => item.accelerator === 'CommandOrControl+-')
    const zoomResetItem = viewSubmenu.find((item) => item.accelerator === 'CommandOrControl+0')

    expect(zoomInItem).toBeTruthy()
    expect(zoomOutItem).toBeTruthy()
    expect(zoomResetItem).toBeTruthy()

    zoomInItem?.click?.(undefined as never, window, undefined as never)
    zoomOutItem?.click?.(undefined as never, window, undefined as never)
    zoomResetItem?.click?.(undefined as never, window, undefined as never)

    expect(commandServiceMock.execute).toHaveBeenCalledWith('app.zoom.in', window)
    expect(commandServiceMock.execute).toHaveBeenCalledWith('app.zoom.out', window)
    expect(commandServiceMock.execute).toHaveBeenCalledWith('app.zoom.reset', window)
  })

  it('preserves native role menu items', async () => {
    await (service as any).onInit()

    const editSubmenu = latestTemplate()[2].submenu as MenuItemConstructorOptions[]
    const copyItem = editSubmenu.find((item) => item.role === 'copy')
    const quitItem = (latestTemplate()[0].submenu as MenuItemConstructorOptions[]).find((item) => item.role === 'quit')

    expect(copyItem).toMatchObject({ role: 'copy', label: 'Copy' })
    expect(quitItem).toMatchObject({ role: 'quit', label: 'Quit Cherry Studio' })
  })
})
