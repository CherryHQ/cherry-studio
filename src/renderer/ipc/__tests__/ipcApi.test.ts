import { IpcError } from '@shared/ipc/errors'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipcApi } from '../index'

const requestMock = vi.fn()
const onMock = vi.fn()

// These exercise the facade's runtime plumbing with throwaway route/event names,
// so they cast past the typed signatures rather than coupling to real routes.
const request = ipcApi.request as unknown as (route: string, input?: unknown) => Promise<unknown>
const on = ipcApi.on as unknown as (event: string, cb: (p: unknown) => void) => () => void

beforeEach(() => {
  requestMock.mockReset()
  onMock.mockReset()
  ;(window as unknown as { api: unknown }).api = { ipcApi: { request: requestMock, on: onMock } }
})

describe('ipcApi.request', () => {
  it('unwraps a successful structured result to its data', async () => {
    requestMock.mockResolvedValue({ ok: true, data: { sum: 3 } })
    await expect(request('demo.add', { a: 1, b: 2 })).resolves.toEqual({ sum: 3 })
    expect(requestMock).toHaveBeenCalledWith('demo.add', { a: 1, b: 2 })
  })

  it('omits the input argument for void-input routes', async () => {
    requestMock.mockResolvedValue({ ok: true, data: null })
    await request('demo.ping')
    expect(requestMock).toHaveBeenCalledWith('demo.ping', undefined)
  })

  it('reconstructs and throws an IpcError from a failed structured result', async () => {
    requestMock.mockResolvedValue({ ok: false, error: { code: 'VALIDATION_FAILED', message: 'bad input' } })
    const err = await request('demo.add', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(IpcError)
    expect((err as IpcError).code).toBe('VALIDATION_FAILED')
    expect((err as IpcError).message).toBe('bad input')
  })

  it('throws an IpcError (not an opaque TypeError) when the bridge returns a malformed result', async () => {
    requestMock.mockResolvedValue(undefined)
    const err = await request('demo.add', {}).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(IpcError)
    expect((err as IpcError).code).toBe('INTERNAL')
  })
})

describe('ipcApi.on', () => {
  it('delegates to the preload bridge and returns its unsubscribe', () => {
    const unsubscribe = vi.fn()
    onMock.mockReturnValue(unsubscribe)
    const callback = vi.fn()

    const returned = on('demo.evt', callback)

    expect(onMock).toHaveBeenCalledWith('demo.evt', callback)
    expect(returned).toBe(unsubscribe)
  })
})
