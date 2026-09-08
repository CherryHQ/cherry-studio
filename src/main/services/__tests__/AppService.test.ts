import { BaseService } from '@main/core/lifecycle'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { setLoginItemSettingsMock, platform, ensureDirMock, atomicWriteFileMock, removeMock, loggerErrorMock } =
  vi.hoisted(() => ({
    setLoginItemSettingsMock: vi.fn(),
    platform: { isDev: false, isLinux: false, isMac: false, isPortable: false, isWin: true },
    ensureDirMock: vi.fn(),
    atomicWriteFileMock: vi.fn(),
    removeMock: vi.fn(),
    loggerErrorMock: vi.fn()
  }))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ debug: vi.fn(), error: loggerErrorMock, info: vi.fn(), warn: vi.fn() })
  }
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('@main/core/platform', () => platform)

vi.mock('@main/utils/file', () => ({
  atomicWriteFile: atomicWriteFileMock,
  ensureDir: ensureDirMock,
  remove: removeMock
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
    ensureDirMock.mockReset()
    atomicWriteFileMock.mockReset()
    removeMock.mockReset()
    loggerErrorMock.mockReset()
    ensureDirMock.mockResolvedValue(undefined)
    atomicWriteFileMock.mockImplementation(async (target: string) => {
      linuxFiles.add(target)
    })
    removeMock.mockImplementation(async (target: string) => {
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

    await vi.waitFor(() => expect(setLoginItemSettingsMock).toHaveBeenCalledOnce())
    expect(setLoginItemSettingsMock).toHaveBeenCalledWith({ openAtLogin: true })
  })

  it('applies launch-on-boot preference changes to the system', async () => {
    const service = new AppService()
    activeServices.push(service)
    await service._doInit()
    await vi.waitFor(() => expect(setLoginItemSettingsMock).toHaveBeenCalledOnce())
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
    await vi.waitFor(() => expect(removeMock).toHaveBeenCalledOnce())
    removeMock.mockClear()

    const writeGate = deferred()
    let writeStarted!: () => void
    const writeStartedPromise = new Promise<void>((resolve) => {
      writeStarted = resolve
    })
    atomicWriteFileMock.mockImplementation(async (target: string) => {
      writeStarted()
      await writeGate.promise
      linuxFiles.add(target)
    })

    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', true)
    await writeStartedPromise
    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', false)
    writeGate.resolve()

    await vi.waitFor(() => expect(removeMock).toHaveBeenCalledOnce())
    expect(linuxFiles.has(desktopFile)).toBe(false)
  })

  it('waits for in-flight Linux updates before stopping and resubscribes on restart', async () => {
    platform.isLinux = true
    platform.isWin = false
    const service = new AppService()
    activeServices.push(service)
    await service._doInit()
    await vi.waitFor(() => expect(removeMock).toHaveBeenCalledOnce())
    removeMock.mockClear()

    const writeGate = deferred()
    let writeStarted!: () => void
    const writeStartedPromise = new Promise<void>((resolve) => {
      writeStarted = resolve
    })
    atomicWriteFileMock.mockImplementation(async (target: string) => {
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
    expect(removeMock).not.toHaveBeenCalled()
    expect(linuxFiles.has(desktopFile)).toBe(true)

    await service._doInit()
    await vi.waitFor(() => expect(removeMock).toHaveBeenCalledOnce())
    expect(linuxFiles.has(desktopFile)).toBe(false)
  })

  it('does not block startup on in-flight Linux reconciliation', async () => {
    platform.isLinux = true
    platform.isWin = false
    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', true)
    const writeGate = deferred()
    let writeStarted!: () => void
    const writeStartedPromise = new Promise<void>((resolve) => {
      writeStarted = resolve
    })
    atomicWriteFileMock.mockImplementation(async (target: string) => {
      writeStarted()
      await writeGate.promise
      linuxFiles.add(target)
    })
    const service = new AppService()
    activeServices.push(service)

    await expect(service._doInit()).resolves.toBeUndefined()
    await writeStartedPromise
    expect(linuxFiles.has(desktopFile)).toBe(false)

    writeGate.resolve()
    await vi.waitFor(() => expect(linuxFiles.has(desktopFile)).toBe(true))
  })

  it('logs reconciler-driven Linux startup failures without blocking initialization', async () => {
    platform.isLinux = true
    platform.isWin = false
    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', true)
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    ensureDirMock.mockRejectedValueOnce(error)
    const service = new AppService()
    activeServices.push(service)

    await expect(service._doInit()).resolves.toBeUndefined()
    await vi.waitFor(() => expect(loggerErrorMock).toHaveBeenCalledWith('Failed to reconcile launch on boot:', error))

    expect(atomicWriteFileMock).not.toHaveBeenCalled()
  })

  describe('setAppLaunchOnBoot', () => {
    it('propagates Linux autostart directory errors', async () => {
      platform.isLinux = true
      platform.isWin = false
      const error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
      ensureDirMock.mockRejectedValueOnce(error)

      await expect(new AppService().setAppLaunchOnBoot(true)).rejects.toBe(error)

      expect(atomicWriteFileMock).not.toHaveBeenCalled()
    })

    it('propagates Linux atomic desktop file write errors', async () => {
      platform.isLinux = true
      platform.isWin = false
      const error = Object.assign(new Error('read-only file system'), { code: 'EROFS' })
      atomicWriteFileMock.mockRejectedValueOnce(error)

      await expect(new AppService().setAppLaunchOnBoot(true)).rejects.toBe(error)
    })

    it('writes the required Linux desktop entry using the application executable', async () => {
      platform.isLinux = true
      platform.isWin = false

      await new AppService().setAppLaunchOnBoot(true)

      expect(ensureDirMock).toHaveBeenCalledWith(autostartDir)
      expect(atomicWriteFileMock).toHaveBeenCalledWith(desktopFile, expect.any(String))
      const desktopContent = atomicWriteFileMock.mock.calls[0][1]
      expect(desktopContent).toContain('Type=Application')
      expect(desktopContent).toContain('Exec=/mock/app.exe_file')
      expect(desktopContent).toContain('X-GNOME-Autostart-enabled=true')
      expect(desktopContent).toContain('Hidden=false')
    })

    it('uses the stable AppImage path in the Linux desktop entry', async () => {
      platform.isLinux = true
      platform.isWin = false
      vi.stubEnv('APPIMAGE', '/opt/CherryStudio.AppImage')

      await new AppService().setAppLaunchOnBoot(true)

      const desktopContent = atomicWriteFileMock.mock.calls[0][1]
      expect(desktopContent).toContain('Exec=/opt/CherryStudio.AppImage')
      expect(desktopContent).not.toContain('Exec=/mock/app.exe_file')
    })

    it('propagates Linux removal errors', async () => {
      platform.isLinux = true
      platform.isWin = false
      const error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
      removeMock.mockRejectedValueOnce(error)

      await expect(new AppService().setAppLaunchOnBoot(false)).rejects.toBe(error)

      expect(removeMock).toHaveBeenCalledWith(desktopFile)
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
