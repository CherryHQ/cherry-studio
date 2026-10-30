import { describe, expect, it } from 'vitest'

import { PaintingGenerateError } from '@shared/ai/paintingGenerateError'
import { aiErrorCodes, aiErrorDetail } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'

import { runPainting } from '../runPainting'

/**
 * runPainting's error path is the renderer end of the "看不到报错" fix: a
 * provider/SDK failure crosses `ai.image.generate` as an `AI_REQUEST_FAILED`
 * IpcError whose rich serialized detail (statusCode / responseBody) rides in
 * `data`. runPainting must recover that detail into the user-facing message
 * instead of collapsing it to an empty `REMOTE_ERROR`.
 */
describe('runPainting error surfacing', () => {
  const fail = (error: unknown) => runPainting(() => Promise.reject(error))

  it('surfaces the provider detail message from an AI_REQUEST_FAILED IpcError', async () => {
    const detail = { name: 'AI_APICallError', message: '401 Unauthorized', stack: null, statusCode: 401 }
    // Empty top-level message (the message-less case the user hit): the detail must win.
    const err = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, '', detail)

    const rejected = await fail(err).catch((error: unknown) => error)
    expect(rejected).toMatchObject({
      name: 'PaintingGenerateError',
      code: 'REMOTE_ERROR',
      message: '401 Unauthorized'
    })
    expect(rejected).toMatchObject({ cause: err })
    expect(aiErrorDetail((rejected as { cause?: unknown }).cause)).toMatchObject({
      statusCode: 401,
      message: '401 Unauthorized'
    })
  })

  it('falls back to HTTP status + response body when the detail has no message', async () => {
    const detail = { name: 'AI_APICallError', message: '', stack: null, statusCode: 500, responseBody: 'upstream boom' }
    const err = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, '', detail)

    const rejected = await fail(err).catch((error: unknown) => error)
    expect(rejected).toMatchObject({
      code: 'REMOTE_ERROR',
      message: 'HTTP 500 upstream boom',
      cause: err
    })
    expect(aiErrorDetail((rejected as { cause?: unknown }).cause)?.responseBody).toBe('upstream boom')
  })

  it('normalizes a plain (non-AI) error without inventing detail', async () => {
    const original = new Error('network down')
    const rejected = await fail(original).catch((error: unknown) => error)
    expect(rejected).toMatchObject({
      name: 'PaintingGenerateError',
      code: 'REMOTE_ERROR',
      message: 'network down',
      cause: original
    })
  })

  it('re-throws an AbortError untouched (silent cancel, not a REMOTE_ERROR)', async () => {
    const abort = new DOMException('Image generation aborted', 'AbortError')
    await expect(fail(abort)).rejects.toBe(abort)
  })

  it('does not wrap a PaintingGenerateError a second time', async () => {
    const original = new PaintingGenerateError('PROMPT_REQUIRED')
    await expect(fail(original)).rejects.toBe(original)
  })
})
