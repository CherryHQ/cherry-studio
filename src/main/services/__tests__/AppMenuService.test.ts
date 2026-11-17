import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  applicationMock,
  menuMock,
  browserWindowMock,
  shellMock,
  appMock,
  windowManagerMock,
  preferenceServiceMock,
  openSettingsInMainWindowMock,
  commandServiceMock
} = vi.hoisted(() => {
  const preferenceServiceMock = {
    get: vi.fn(),
    subscribeChange: vi.fn(() => ({ dispose: vi.fn() }))
  }
  const openSettingsInMainWindowMock = vi.fn()
  const commandServiceMock = {
    execute: vi.fn()
  }
  const windowManagerMock = {
    getWindowsByType: vi.fn(() => []),
    getWindowId: vi.fn(),
    getWindowType: vi.fn()
  }

  return {
    preferenceServiceMock,
    openSettingsInMainWindowMock,
    commandServiceMock,
    windowManagerMock,
    applicationMock: {
      get: vi.fn((name: string) => {
        if (name === 'PreferenceService') return preferenceServiceMock
        if (name === 'CommandService') return commandServiceMock
        if (name === 'WindowManager') {
          return windowManagerMock
        }
        return undefined
      })
    },
    menuMock: {
      buildFromTemplate: vi.fn((template: MenuItemConstructorOptions[]) => ({ template })),
      setApplicationMenu: vi.fn()
    },
    browserWindowMock: { getFocusedWindow: vi.fn(() => null) },
    shellMock: {
      openExternal: vi.fn()
    },
    appMock: {
      name: 'Cherry Studio',
      getLocale: vi.fn(() => 'en-US'),
      on: vi.fn(),
      off: vi.fn()
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
  BrowserWindow: browserWindowMock,
  Menu: menuMock,
  shell: shellMock
}))

vi.mock('@main/services/mainWindowNavigation', () => ({
  openSettingsInMainWindow: openSettingsInMainWindowMock
}))

import { WindowType } from '@main/core/window/types'

import { AppMenuService } from '../AppMenuService'

const latestTemplate = () => menuMock.buildFromTemplate.mock.calls.at(-1)?.[0] as MenuItemConstructorOptions[]

const REAL_PLATFORM = process.platform

describe('AppMenuService', () => {
  let service: AppMenuService

  beforeEach(() => {
    vi.clearAllMocks()
    // AppMenuService is darwin-only; pin the platform so platform-gated
    // accelerators resolve identically on every CI runner.
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    preferenceServiceMock.get.mockReturnValue(undefined)
    service = new AppMenuService()
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true })
  })

  it('opens settings from the native app menu', async () => {
    await (service as any).onInit()

    const appSubmenu = latestTemplate().flatMap(
      (item) => (item.submenu as MenuItemConstructorOptions[] | undefined) ?? []
    )
    const settingsItem = appSubmenu.find((item) => item.label === 'Settings')

    settingsItem?.click?.(undefined as never, undefined, undefined as never)

    expect(commandServiceMock.execute).toHaveBeenCalledWith('app.settings.open', undefined)
  })

  it('opens the About settings route from the native app menu', async () => {
    await (service as any).onInit()

    const appSubmenu = latestTemplate().flatMap(
      (item) => (item.submenu as MenuItemConstructorOptions[] | undefined) ?? []
    )
    const aboutItem = appSubmenu.find((item) => String(item.label).startsWith('About '))

    aboutItem?.click?.(undefined as never, undefined, undefined as never)

    expect(openSettingsInMainWindowMock).toHaveBeenCalledWith('/settings/about')
  })

  it('moves the window-close accelerator off CommandOrControl+W so the tab bar can claim it', async () => {
    await (service as any).onInit()

    const fileSubmenu = latestTemplate()[1].submenu as MenuItemConstructorOptions[]
    const closeItem = fileSubmenu.find((item) => item.role === 'close')

    // A native accelerator outranks the renderer keydown, so leaving the default
    // here would keep Cmd+W closing the window instead of running tab.close.
    expect(closeItem).toMatchObject({ role: 'close', accelerator: 'CommandOrControl+Shift+W' })
  })

  it('restores Command+W to close a focused light window, then reserves it for tabs in the main window', async () => {
    await (service as any).onInit()
    const focus = appMock.on.mock.calls.find(([event]) => event === 'browser-window-focus')?.[1]
    // WindowManager keys its registry by managed UUID: focus must be resolved
    // through the BrowserWindow instance, never Electron's numeric window ID.
    windowManagerMock.getWindowId.mockImplementation((window: { id: number }) => `managed-${window.id}`)
    windowManagerMock.getWindowType.mockImplementation((id: string) =>
      id === 'managed-2' ? WindowType.QuickAssistant : id === 'managed-1' ? WindowType.Main : undefined
    )

    focus({}, { id: 2 })
    expect(windowManagerMock.getWindowId).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }))
    expect((latestTemplate()[1].submenu as MenuItemConstructorOptions[])[0]).toMatchObject({
      role: 'close',
      accelerator: 'CommandOrControl+W'
    })
    focus({}, { id: 1 })
    expect((latestTemplate()[1].submenu as MenuItemConstructorOptions[])[0]).toMatchObject({
      role: 'close',
      accelerator: 'CommandOrControl+Shift+W'
    })
  })

  it('executes zoom commands for the clicked window', async () => {
    await (service as any).onInit()

    const window = { id: 1 } as BrowserWindow
    const viewSubmenu = latestTemplate().flatMap(
      (item) => (item.submenu as MenuItemConstructorOptions[] | undefined) ?? []
    )
    const zoomInItem = viewSubmenu.find((item) => item.label === 'Zoom In')
    const zoomOutItem = viewSubmenu.find((item) => item.label === 'Zoom Out')
    const zoomResetItem = viewSubmenu.find((item) => item.label === 'Actual Size')

    zoomInItem?.click?.(undefined as never, window, undefined as never)
    zoomOutItem?.click?.(undefined as never, window, undefined as never)
    zoomResetItem?.click?.(undefined as never, window, undefined as never)

    expect(commandServiceMock.execute).toHaveBeenCalledWith('app.zoom.in', window)
    expect(commandServiceMock.execute).toHaveBeenCalledWith('app.zoom.out', window)
    expect(commandServiceMock.execute).toHaveBeenCalledWith('app.zoom.reset', window)
  })
})
