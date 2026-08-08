import type * as LifecycleModule from '@main/core/lifecycle'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setLoginItemSettingsMock } = vi.hoisted(() => ({
  setLoginItemSettingsMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('@main/core/lifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof LifecycleModule>()
  class MockBaseService {
    protected readonly _disposables: Array<{ dispose: () => void } | (() => void)> = []

    protected registerDisposable<T extends { dispose: () => void } | (() => void)>(disposable: T): T {
      this._disposables.push(disposable)
      return disposable
    }
  }
  return { ...actual, BaseService: MockBaseService }
})

vi.mock('@main/core/platform', () => ({
  isDev: false,
  isLinux: false,
  isMac: false,
  isWin: true
}))

vi.mock('electron', () => ({
  app: { setLoginItemSettings: setLoginItemSettingsMock }
}))

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

const { AppService } = await import('../AppService')

type AppServiceInternals = {
  onInit: () => Promise<void> | void
}

describe('AppService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('reconciles the persisted launch-on-boot preference during startup', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', true)
    const service = new AppService() as unknown as AppServiceInternals

    await service.onInit()

    expect(setLoginItemSettingsMock).toHaveBeenCalledOnce()
    expect(setLoginItemSettingsMock).toHaveBeenCalledWith({ openAtLogin: true })
  })

  it('applies launch-on-boot preference changes to the system', async () => {
    const service = new AppService() as unknown as AppServiceInternals
    await service.onInit()
    setLoginItemSettingsMock.mockClear()

    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', true)
    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', false)

    expect(setLoginItemSettingsMock).toHaveBeenNthCalledWith(1, { openAtLogin: true })
    expect(setLoginItemSettingsMock).toHaveBeenNthCalledWith(2, { openAtLogin: false })
  })
})
