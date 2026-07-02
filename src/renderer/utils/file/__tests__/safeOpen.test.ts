import { IpcError } from '@shared/ipc/errors'
import { fileErrorCodes } from '@shared/ipc/errors/file'
import type { FileHandle } from '@shared/types/file'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  request: vi.fn(),
  warn: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({ error: mocks.error, warn: mocks.warn })
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

import { safeOpen } from '../safeOpen'

const handle: FileHandle = { kind: 'entry', entryId: '019606a0-0000-7000-8000-000000000001' }

describe('safeOpen', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens the handle through File IPC', async () => {
    mocks.request.mockResolvedValue(undefined)

    await safeOpen(handle)

    expect(mocks.request).toHaveBeenCalledWith('file.open', handle)
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('reveals the handle when default-open is blocked as unsafe', async () => {
    mocks.request
      .mockRejectedValueOnce(new IpcError(fileErrorCodes.OPEN_BLOCKED_UNSAFE_TYPE))
      .mockResolvedValueOnce(undefined)

    await safeOpen(handle)

    expect(mocks.request).toHaveBeenNthCalledWith(1, 'file.open', handle)
    expect(mocks.request).toHaveBeenNthCalledWith(2, 'file.show_in_folder', handle)
    expect(mocks.warn).toHaveBeenCalled()
    expect(mocks.error).not.toHaveBeenCalled()
  })

  it('logs and rethrows ordinary open failures', async () => {
    const error = new Error('open failed')
    mocks.request.mockRejectedValueOnce(error)

    await expect(safeOpen(handle)).rejects.toBe(error)

    expect(mocks.error).toHaveBeenCalledWith('Failed to open file', error)
  })

  it('rethrows non-blocked IpcError without revealing the handle', async () => {
    const error = new IpcError('FILE_NOT_FOUND', 'not found')
    mocks.request.mockRejectedValueOnce(error)

    await expect(safeOpen(handle)).rejects.toBe(error)

    expect(mocks.request).toHaveBeenCalledWith('file.open', handle)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.error).toHaveBeenCalledWith('Failed to open file', error)
  })

  it('logs and rethrows reveal fallback failures', async () => {
    const showError = new Error('show failed')
    mocks.request
      .mockRejectedValueOnce(new IpcError(fileErrorCodes.OPEN_BLOCKED_UNSAFE_TYPE))
      .mockRejectedValueOnce(showError)

    await expect(safeOpen(handle)).rejects.toBe(showError)

    expect(mocks.warn).toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith('Failed to show blocked file in folder', showError)
  })
})
