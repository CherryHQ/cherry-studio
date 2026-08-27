import { BaseService } from '@main/core/lifecycle'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { setLoginItemSettingsMock, platform, mkdirMock, writeFileMock, rmMock } = vi.hoisted(() => ({
  setLoginItemSettingsMock: vi.fn(),
  platform: { isDev: false, isLinux: false, isMac: false, isPortable: false, isWin: true },
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
  rmMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('@main/core/platform', () => platform)

vi.mock('fs', () => ({
  default: {
    promises: {
      mkdir: mkdirMock,
      writeFile: writeFileMock,
      rm: rmMock
    }
  }
}))

vi.mock('electron', () => ({
  app: { setLoginItemSettings: setLoginItemSettingsMock }
}))

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

const { AppService } = await import('../AppService')

const autostartDir = '/mock/sys.appdata.autostart'
const desktopFile = path.join(autostartDir, 'cherry-studio.desktop')
const linuxFiles = new Set<string>()
const activeServices: BaseService[] = []

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('AppService', () => {
  beforeEach(() => {
    BaseService.resetInstances()
    platform.isDev = false
    platform.isLinux = false
    platform.isMac = false
    platform.isPortable = false
    platform.isWin = true
    linuxFiles.clear()
    setLoginItemSettingsMock.mockReset()
    mkdirMock.mockReset()
    writeFileMock.mockReset()
    rmMock.mockReset()
    mkdirMock.mockResolvedValue(undefined)
    writeFileMock.mockImplementation(async (target: string) => {
      linuxFiles.add(target)
    })
    rmMock.mockImplementation(async (target: string) => {
      linuxFiles.delete(target)
    })
    MockMainPreferenceServiceUtils.resetMocks()
  })

  afterEach(async () => {
    for (const service of activeServices.splice(0)) {
      await service._doStop()
    }
    vi.unstubAllEnvs()
  })

  it('reconciles the persisted launch-on-boot preference during startup', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', true)
    const service = new AppService()
    activeServices.push(service)

    await service._doInit()

    expect(setLoginItemSettingsMock).toHaveBeenCalledOnce()
    expect(setLoginItemSettingsMock).toHaveBeenCalledWith({ openAtLogin: true })
  })

  it('applies launch-on-boot preference changes to the system', async () => {
    const service = new AppService()
    activeServices.push(service)
    await service._doInit()
    setLoginItemSettingsMock.mockClear()

    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', true)
    await vi.waitFor(() => expect(setLoginItemSettingsMock).toHaveBeenCalledOnce())

    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', false)
    await vi.waitFor(() => expect(setLoginItemSettingsMock).toHaveBeenCalledTimes(2))
    expect(setLoginItemSettingsMock).toHaveBeenCalledWith({ openAtLogin: true })
    expect(setLoginItemSettingsMock).toHaveBeenNthCalledWith(2, { openAtLogin: false })
  })

  it('serializes Linux updates and converges to the latest preference', async () => {
    platform.isLinux = true
    platform.isWin = false
    const service = new AppService()
    activeServices.push(service)
    await service._doInit()
    rmMock.mockClear()

    const writeGate = deferred()
    let writeStarted!: () => void
    const writeStartedPromise = new Promise<void>((resolve) => {
      writeStarted = resolve
    })
    writeFileMock.mockImplementation(async (target: string) => {
      writeStarted()
      await writeGate.promise
      linuxFiles.add(target)
    })

    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', true)
    await writeStartedPromise
    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', false)
    writeGate.resolve()

    await vi.waitFor(() => expect(rmMock).toHaveBeenCalledOnce())
    expect(linuxFiles.has(desktopFile)).toBe(false)
  })

  it('waits for in-flight Linux updates before stopping and resubscribes on restart', async () => {
    platform.isLinux = true
    platform.isWin = false
    const service = new AppService()
    activeServices.push(service)
    await service._doInit()
    rmMock.mockClear()

    const writeGate = deferred()
    let writeStarted!: () => void
    const writeStartedPromise = new Promise<void>((resolve) => {
      writeStarted = resolve
    })
    writeFileMock.mockImplementation(async (target: string) => {
      writeStarted()
      await writeGate.promise
      linuxFiles.add(target)
    })

    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', true)
    await writeStartedPromise
    let stopped = false
    const stopPromise = service._doStop().then(() => {
      stopped = true
    })
    await Promise.resolve()
    expect(stopped).toBe(false)

    writeGate.resolve()
    await stopPromise
    expect(linuxFiles.has(desktopFile)).toBe(true)

    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', false)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(rmMock).not.toHaveBeenCalled()
    expect(linuxFiles.has(desktopFile)).toBe(true)

    await service._doInit()
    await vi.waitFor(() => expect(rmMock).toHaveBeenCalledOnce())
    expect(linuxFiles.has(desktopFile)).toBe(false)
  })

  describe('setAppLaunchOnBoot', () => {
    it('propagates Linux autostart directory errors', async () => {
      platform.isLinux = true
      platform.isWin = false
      const error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
      mkdirMock.mockRejectedValueOnce(error)

      await expect(new AppService().setAppLaunchOnBoot(true)).rejects.toBe(error)

      expect(writeFileMock).not.toHaveBeenCalled()
    })

    it('propagates Linux desktop file write errors', async () => {
      platform.isLinux = true
      platform.isWin = false
      const error = Object.assign(new Error('read-only file system'), { code: 'EROFS' })
      writeFileMock.mockRejectedValueOnce(error)

      await expect(new AppService().setAppLaunchOnBoot(true)).rejects.toBe(error)
    })

    it('uses forceful removal while propagating other Linux removal errors', async () => {
      platform.isLinux = true
      platform.isWin = false
      const error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
      rmMock.mockRejectedValueOnce(error)

      await expect(new AppService().setAppLaunchOnBoot(false)).rejects.toBe(error)

      expect(rmMock).toHaveBeenCalledWith(desktopFile, { force: true })
    })

    it('registers the stable launcher for Windows portable builds', async () => {
      platform.isPortable = true
      vi.stubEnv('PORTABLE_EXECUTABLE_FILE', 'D:\\Apps\\Cherry Studio Portable.exe')

      await new AppService().setAppLaunchOnBoot(true)

      expect(setLoginItemSettingsMock).toHaveBeenCalledWith({
        openAtLogin: true,
        path: 'D:\\Apps\\Cherry Studio Portable.exe',
        args: []
      })
    })

    it('uses Electron defaults for installed Windows builds', async () => {
      vi.stubEnv('PORTABLE_EXECUTABLE_FILE', 'D:\\Apps\\Cherry Studio Portable.exe')

      await new AppService().setAppLaunchOnBoot(false)

      expect(setLoginItemSettingsMock).toHaveBeenCalledWith({ openAtLogin: false })
    })

    it('uses Electron defaults on macOS', async () => {
      platform.isMac = true
      platform.isWin = false

      await new AppService().setAppLaunchOnBoot(true)

      expect(setLoginItemSettingsMock).toHaveBeenCalledWith({ openAtLogin: true })
    })
  })
})
