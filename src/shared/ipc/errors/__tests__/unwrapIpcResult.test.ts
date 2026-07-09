import { describe, expect, it } from 'vitest'

import { IpcError, IpcErrorCode } from '../IpcError'
import { unwrapIpcResult } from '../unwrapIpcResult'

describe('unwrapIpcResult', () => {
  it('returns data from successful IpcApi envelopes', async () => {
    await expect(unwrapIpcResult(Promise.resolve({ ok: true, data: 'done' }))).resolves.toBe('done')
  })

  it('throws IpcError from failed IpcApi envelopes', async () => {
    await expect(
      unwrapIpcResult(Promise.resolve({ ok: false, error: { code: 'BAD_PATH', message: 'bad path' } }))
    ).rejects.toMatchObject({
      name: 'IpcError',
      code: 'BAD_PATH',
      message: 'bad path'
    })
  })

  it('throws on malformed envelopes', async () => {
    await expect(unwrapIpcResult(Promise.resolve(null))).rejects.toEqual(
      new IpcError(IpcErrorCode.INTERNAL, 'IpcApi returned a malformed result')
    )
  })
})
