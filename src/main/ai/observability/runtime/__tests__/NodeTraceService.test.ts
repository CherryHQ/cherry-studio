import { beforeEach, describe, expect, it, vi } from 'vitest'

const { applicationMock, ipcMainMock, preferenceServiceMock } = vi.hoisted(() => {
  const preferenceServiceMock = {
    get: vi.fn(() => false)
  }
  const applicationMock = {
    get: vi.fn((name: string) => {
      if (name === 'PreferenceService') return preferenceServiceMock
      throw new Error(`unexpected service: ${name}`)
    })
  }
  const ipcMainMock = {
    handle: vi.fn()
  }
  return { applicationMock, ipcMainMock, preferenceServiceMock }
})

vi.mock('@application', () => ({ application: applicationMock }))
vi.mock('electron', () => ({ ipcMain: ipcMainMock }))

vi.mock('@main/core/lifecycle', async () => {
  const actual = (await vi.importActual('@main/core/lifecycle')) as Record<string, unknown>
  class StubBase {
    protected ipcHandle = vi.fn()
    protected registerDisposable = vi.fn(<T>(disposable: T) => disposable)
  }
  return { ...actual, BaseService: StubBase }
})

import { NodeTraceService } from '../NodeTraceService'

describe('NodeTraceService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    preferenceServiceMock.get.mockReturnValue(false)
    // patchIpcMainHandle() reassigns ipcMain.handle and the stubbed
    // registerDisposable never reverts it, so reset to a fresh fn per test.
    ipcMainMock.handle = vi.fn()
  })

  it('does not register standalone trace window IPC handlers', async () => {
    const service = new NodeTraceService()

    await (service as any).onInit()

    expect((service as any).ipcHandle).not.toHaveBeenCalled()
  })

  it('still patches IPC handlers for trace context when developer mode is enabled', async () => {
    preferenceServiceMock.get.mockReturnValue(true)
    const service = new NodeTraceService()
    const originalHandle = ipcMainMock.handle

    await (service as any).onInit()

    expect((service as any).registerDisposable).toHaveBeenCalledTimes(1)
    // patchIpcMainHandle() must have replaced ipcMain.handle with its wrapper.
    expect(ipcMainMock.handle).not.toBe(originalHandle)
  })

  it('leaves ipcMain.handle untouched when developer mode is disabled', async () => {
    const service = new NodeTraceService()
    const originalHandle = ipcMainMock.handle

    await (service as any).onInit()

    expect(ipcMainMock.handle).toBe(originalHandle)
  })
})
