import { EventEmitter } from 'events'

import { describe, expect, it, vi } from 'vitest'

const { applicationMock, preferenceServiceMock, platformState } = vi.hoisted(() => {
  const preferenceServiceMock = { get: vi.fn(() => 1.5) }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'PreferenceService') return preferenceServiceMock
      throw new Error(`unexpected service: ${name}`)
    })
  }
  const platformState = { isLinux: false, isMac: false, isWin: false }
  return { applicationMock, preferenceServiceMock, platformState }
})

vi.mock('@application', () => ({ application: applicationMock }))
vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
  }
}))
vi.mock('@main/core/platform', () => ({
  get isLinux() {
    return platformState.isLinux
  },
  get isMac() {
    return platformState.isMac
  },
  get isWin() {
    return platformState.isWin
  }
}))
vi.mock('electron', () => ({
  app: {},
  BrowserWindow: { getFocusedWindow: vi.fn() },
  screen: {}
}))
vi.mock('@main/core/lifecycle', async () => {
  const actual = (await vi.importActual('@main/core/lifecycle')) as Record<string, unknown>
  class StubBase {
    registerDisposable = vi.fn()
  }
  return { ...actual, BaseService: StubBase }
})

import { QuickAssistantService } from '../QuickAssistantService'

describe('QuickAssistantService', () => {
  it('applies the persisted application zoom to a new window and preserves it when resized', () => {
    const service = new QuickAssistantService()
    const webContents = Object.assign(new EventEmitter(), {
      setZoomFactor: vi.fn(),
      setWindowOpenHandler: vi.fn()
    })
    const window = Object.assign(new EventEmitter(), {
      isDestroyed: vi.fn(() => false),
      webContents
    })

    service['setupQuickAssistant'](window as never)

    expect(webContents.setZoomFactor).toHaveBeenLastCalledWith(1.5)

    preferenceServiceMock.get.mockReturnValue(1.8)
    window.emit('will-resize')

    expect(webContents.setZoomFactor).toHaveBeenLastCalledWith(1.8)
  })
  it('reapplies startup zoom after the render frame is ready, reading the current preference', () => {
    const service = new QuickAssistantService()
    const webContents = Object.assign(new EventEmitter(), { setZoomFactor: vi.fn(), setWindowOpenHandler: vi.fn() })
    const window = Object.assign(new EventEmitter(), { isDestroyed: vi.fn(() => false), webContents })
    service['setupQuickAssistant'](window as never)
    webContents.setZoomFactor.mockClear()
    preferenceServiceMock.get.mockReturnValue(2)
    window.emit('ready-to-show')
    expect(webContents.setZoomFactor).toHaveBeenCalledWith(2)
    window.isDestroyed.mockReturnValue(true)
    webContents.setZoomFactor.mockClear()
    window.emit('ready-to-show')
    expect(webContents.setZoomFactor).not.toHaveBeenCalled()
  })
})
