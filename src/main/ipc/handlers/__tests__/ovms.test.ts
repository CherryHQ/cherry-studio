import { IpcError } from '@shared/ipc/errors/IpcError'
import { ovmsErrorCodes } from '@shared/ipc/errors/ovms'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetOptionalMock, getCpuNameMock, runInstallScriptMock, platform } = vi.hoisted(() => ({
  appGetOptionalMock: vi.fn(),
  getCpuNameMock: vi.fn(),
  runInstallScriptMock: vi.fn(),
  platform: { isWin: true }
}))

vi.mock('@application', () => ({ application: { getOptional: appGetOptionalMock } }))
vi.mock('@main/core/platform', () => ({
  get isWin() {
    return platform.isWin
  }
}))
vi.mock('@main/utils/system', () => ({ getCpuName: getCpuNameMock }))
vi.mock('@main/utils/processRunner', () => ({ runInstallScript: runInstallScriptMock }))

import { ovmsHandlers } from '../ovms'

const ovmsManager = {
  addModel: vi.fn(),
  stopAddModel: vi.fn(),
  getOvmsStatus: vi.fn(),
  runOvms: vi.fn(),
  stopOvms: vi.fn()
}
const ctx = { senderId: 'w1' }

beforeEach(() => {
  vi.clearAllMocks()
  platform.isWin = true
  appGetOptionalMock.mockReturnValue(ovmsManager)
})

describe('ovmsHandlers', () => {
  it('is_supported is true on Windows with an Intel CPU', async () => {
    getCpuNameMock.mockReturnValue('Intel(R) Core(TM) i7')
    expect(await ovmsHandlers['ovms.is_supported'](undefined, ctx)).toBe(true)
  })

  it('is_supported is false off Windows (never needs the service)', async () => {
    platform.isWin = false
    getCpuNameMock.mockReturnValue('Intel(R) Core(TM) i7')
    expect(await ovmsHandlers['ovms.is_supported'](undefined, ctx)).toBe(false)
  })

  it('install_binary runs the install script', async () => {
    await ovmsHandlers['ovms.install_binary'](undefined, ctx)
    expect(runInstallScriptMock).toHaveBeenCalledWith('install-ovms.js')
  })

  it('add_model forwards the object fields as positional args to OvmsManager', async () => {
    ovmsManager.addModel.mockResolvedValue({ success: true })
    await ovmsHandlers['ovms.add_model']({ modelName: 'm', modelId: 'i', modelSource: 's', task: 't' }, ctx)
    expect(ovmsManager.addModel).toHaveBeenCalledWith('m', 'i', 's', 't')
  })

  it('get_status / start / stop / cancel_add_model delegate to the service', async () => {
    ovmsManager.getOvmsStatus.mockResolvedValue('running')
    ovmsManager.runOvms.mockResolvedValue({ success: true })
    ovmsManager.stopOvms.mockResolvedValue({ success: true })
    ovmsManager.stopAddModel.mockResolvedValue({ success: true })
    expect(await ovmsHandlers['ovms.get_status'](undefined, ctx)).toBe('running')
    await ovmsHandlers['ovms.start'](undefined, ctx)
    await ovmsHandlers['ovms.stop'](undefined, ctx)
    await ovmsHandlers['ovms.cancel_add_model'](undefined, ctx)
    expect(ovmsManager.runOvms).toHaveBeenCalledOnce()
    expect(ovmsManager.stopOvms).toHaveBeenCalledOnce()
    expect(ovmsManager.stopAddModel).toHaveBeenCalledOnce()
  })

  it('start throws OVMS_START_FAILED carrying the manager message when the run fails', async () => {
    ovmsManager.runOvms.mockResolvedValue({ success: false, message: 'run.bat not found' })
    await expect(ovmsHandlers['ovms.start'](undefined, ctx)).rejects.toMatchObject({
      code: ovmsErrorCodes.OVMS_START_FAILED,
      message: 'run.bat not found'
    })
  })

  it('stop throws OVMS_STOP_FAILED when the stop fails', async () => {
    ovmsManager.stopOvms.mockResolvedValue({ success: false, message: 'Failed to stop OVMS process' })
    await expect(ovmsHandlers['ovms.stop'](undefined, ctx)).rejects.toMatchObject({
      code: ovmsErrorCodes.OVMS_STOP_FAILED
    })
  })

  it('operation routes throw OVMS_NOT_AVAILABLE when the conditional service is inactive', async () => {
    appGetOptionalMock.mockReturnValue(undefined)
    await expect(ovmsHandlers['ovms.get_status'](undefined, ctx)).rejects.toMatchObject({
      code: ovmsErrorCodes.OVMS_NOT_AVAILABLE
    })
    await expect(
      ovmsHandlers['ovms.add_model']({ modelName: 'm', modelId: 'i', modelSource: 's', task: 't' }, ctx)
    ).rejects.toBeInstanceOf(IpcError)
  })
})
