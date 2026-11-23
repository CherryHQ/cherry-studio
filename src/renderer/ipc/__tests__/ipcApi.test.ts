import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcError } from '@shared/ipc/errors/IpcError'

import { ipcApi } from '../index'

const requestMock = vi.fn()

beforeEach(() => {
  requestMock.mockReset()
  vi.spyOn(window.api.ipcApi, 'request').mockImplementation(requestMock)
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

  it('accepts an explicitly undefined payload for a successful void route', async () => {
    requestMock.mockResolvedValue({ ok: true, data: undefined })
    await expect(ipcApi.request('system.toggle_dev_tools')).resolves.toBeUndefined()
  })

  it('reconstructs and throws an IpcError from a failed structured result', async () => {
    requestMock.mockResolvedValue({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'bad input' } })
    const err = await ipcApi.request('system.shell.open_path', '/tmp/file').catch((e: unknown) => e)
    assert(err instanceof IpcError)
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.message).toBe('bad input')
  })

  it.each([
    { name: 'missing frame', value: undefined },
    { name: 'string discriminator', value: { ok: 'false', data: [] } },
    { name: 'numeric discriminator', value: { ok: 1, data: [] } },
    { name: 'null discriminator', value: { ok: null, data: [] } },
    { name: 'missing success data', value: { ok: true } },
    { name: 'missing failure', value: { ok: false } },
    { name: 'null failure', value: { ok: false, error: null } },
    { name: 'non-string code', value: { ok: false, error: { code: 42, message: 'failed' } } },
    { name: 'non-string message', value: { ok: false, error: { code: 'DOMAIN_FAILURE', message: null } } },
    {
      name: 'invalid reporting marker',
      value: { ok: false, error: { code: 'DOMAIN_FAILURE', message: 'failed', reportingHandled: 'true' } }
    }
  ])('rejects a malformed $name as INTERNAL IpcError', async ({ value }) => {
    requestMock.mockResolvedValue(value)
    const error = await ipcApi.request('system.get_fonts').catch((caught: unknown) => caught)

    assert(error instanceof IpcError)
    expect(error.code).toBe('INTERNAL')
    expect(error.message).toBe('IpcApi returned a malformed result')
  })

  it('preserves reporting ownership and opaque error data when rebuilding a domain error', async () => {
    const data = new Uint8Array([1, 2, 3])
    requestMock.mockResolvedValue({
      ok: false,
      error: { code: 'DOMAIN_FAILURE', message: 'failed', data, reportingHandled: true }
    })
    const error = await ipcApi.request('system.get_fonts').catch((caught: unknown) => caught)

    assert(error instanceof IpcError)
    expect(error.code).toBe('DOMAIN_FAILURE')
    expect(error.data).toBe(data)
    expect(error.reportingHandled).toBe(true)
  })

  it('propagates the original invoke rejection without rebuilding it', async () => {
    const error = new Error('bridge disconnected')
    requestMock.mockRejectedValue(error)

    await expect(ipcApi.request('system.get_fonts')).rejects.toBe(error)
  })
})
