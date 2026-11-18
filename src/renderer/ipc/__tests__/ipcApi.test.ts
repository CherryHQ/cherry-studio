import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcError } from '@shared/ipc/errors/IpcError'

import { ipcApi } from '../index'

const requestMock = vi.fn()
const onMock = vi.fn()

beforeEach(() => {
  requestMock.mockReset()
  onMock.mockReset()
  vi.spyOn(window.api.ipcApi, 'request').mockImplementation(requestMock)
  vi.spyOn(window.api.ipcApi, 'on').mockImplementation(onMock)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ipcApi.request', () => {
  it('unwraps a successful structured result to its data', async () => {
    requestMock.mockResolvedValue({ ok: true, data: ['Arial', 'Inter'] })
    await expect(ipcApi.request('system.get_fonts')).resolves.toEqual(['Arial', 'Inter'])
    expect(requestMock).toHaveBeenCalledWith('system.get_fonts', undefined)
  })

  it('omits the input argument for void-input routes', async () => {
    requestMock.mockResolvedValue({ ok: true, data: undefined })
    await ipcApi.request('system.toggle_dev_tools')
    expect(requestMock).toHaveBeenCalledWith('system.toggle_dev_tools', undefined)
  })

  it('reconstructs and throws an IpcError from a failed structured result', async () => {
    requestMock.mockResolvedValue({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'bad input' } })
    const err = await ipcApi.request('system.shell.open_path', '/tmp/file').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(IpcError)
    expect((err as IpcError).code).toBe('VALIDATION_FAILED')
    expect((err as IpcError).message).toBe('bad input')
  })

  it('throws an IpcError (not an opaque TypeError) when the bridge returns a malformed result', async () => {
    requestMock.mockResolvedValue(undefined)
    const err = await ipcApi.request('system.shell.open_path', '/tmp/file').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(IpcError)
    expect((err as IpcError).code).toBe('INTERNAL')
  })
})

describe('ipcApi.on', () => {
  it('delegates to the preload bridge and returns its unsubscribe', () => {
    const unsubscribe = vi.fn()
    onMock.mockReturnValue(unsubscribe)
    const callback = vi.fn()

    const returned = ipcApi.on('system.native_theme_updated', callback)

    expect(onMock).toHaveBeenCalledWith('system.native_theme_updated', callback)
    expect(returned).toBe(unsubscribe)
  })
})
