import { BaseService } from '@main/core/lifecycle'
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setLoginItemSettingsMock, platform, accessMock, mkdirMock, writeFileMock, unlinkMock } = vi.hoisted(() => ({
  setLoginItemSettingsMock: vi.fn(),
  platform: { isDev: false, isLinux: false, isMac: false, isWin: true },
  accessMock: vi.fn(),
  mkdirMock: vi.fn(),
  writeFileMock: vi.fn(),
  unlinkMock: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('@main/core/platform', () => platform)

vi.mock('fs', () => ({
  default: {
    promises: {
      access: accessMock,
      mkdir: mkdirMock,
      writeFile: writeFileMock,
      unlink: unlinkMock
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
let autostartDirExists = false

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
    platform.isWin = true
    autostartDirExists = false
    linuxFiles.clear()
    setLoginItemSettingsMock.mockReset()
    accessMock.mockReset()
    mkdirMock.mockReset()
    writeFileMock.mockReset()
    unlinkMock.mockReset()
    accessMock.mockImplementation(async (target: string) => {
      if ((target === autostartDir && autostartDirExists) || (target === desktopFile && linuxFiles.has(target))) return
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })
    mkdirMock.mockImplementation(async () => {
      autostartDirExists = true
    })
    writeFileMock.mockImplementation(async (target: string) => {
      linuxFiles.add(target)
    })
    unlinkMock.mockImplementation(async (target: string) => {
      linuxFiles.delete(target)
    })
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('reconciles the persisted launch-on-boot preference during startup', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.launch_on_boot', true)
    const service = new AppService()

    await service._doInit()

    expect(setLoginItemSettingsMock).toHaveBeenCalledOnce()
    expect(setLoginItemSettingsMock).toHaveBeenCalledWith({ openAtLogin: true })
  })

  it('applies launch-on-boot preference changes to the system', async () => {
    const service = new AppService()
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
    await service._doInit()

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

    await vi.waitFor(() => expect(unlinkMock).toHaveBeenCalledOnce())
    expect(linuxFiles.has(desktopFile)).toBe(false)
  })

  it('waits for in-flight Linux updates before stopping and resubscribes on restart', async () => {
    platform.isLinux = true
    platform.isWin = false
    const service = new AppService()
    await service._doInit()

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
    expect(unlinkMock).not.toHaveBeenCalled()

    await service._doInit()
    await vi.waitFor(() => expect(unlinkMock).toHaveBeenCalledOnce())
    expect(linuxFiles.has(desktopFile)).toBe(false)
  })
})
