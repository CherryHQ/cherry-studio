import { describe, expect, it } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { PaintingGenerateError } from '@shared/ai/paintingGenerateError'
import { aiErrorCodes } from '@shared/ipc/errors/ai'
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

    await expect(fail(err)).rejects.toMatchObject({
      name: 'PaintingGenerateError',
      code: 'REMOTE_ERROR',
      message: '401 Unauthorized'
    })
  })

  it('falls back to HTTP status + response body when the detail has no message', async () => {
    const detail = { name: 'AI_APICallError', message: '', stack: null, statusCode: 500, responseBody: 'upstream boom' }
    const err = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, '', detail)

    await expect(fail(err)).rejects.toMatchObject({
      code: 'REMOTE_ERROR',
      message: 'HTTP 500 upstream boom'
    })
  })

  it('maps a 504 gateway timeout to the friendly timeout string, not the raw body', async () => {
    const detail = {
      name: 'AI_APICallError',
      message: '',
      stack: null,
      statusCode: 504,
      responseBody: '<html>proxy noise</html>'
    }
    const err = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, '', detail)

    await expect(fail(err)).rejects.toMatchObject({
      code: 'REMOTE_ERROR',
      message: i18n.t('error.http.504')
    })
  })

  it('maps a 504 with a provider message to the friendly timeout string too', async () => {
    const detail = { name: 'AI_APICallError', message: 'Gateway Timeout', stack: null, statusCode: 504 }
    const err = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, '', detail)

    await expect(fail(err)).rejects.toMatchObject({
      code: 'REMOTE_ERROR',
      message: i18n.t('error.http.504')
    })
  })

  it('maps an exhausted-retry 504 nested in lastError to the friendly timeout string', async () => {
    const detail = {
      name: 'AI_RetryError',
      message: 'Failed after 3 attempts',
      stack: null,
      lastError: { name: 'AI_APICallError', message: 'Gateway Timeout', stack: null, statusCode: 504 }
    }
    const err = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, '', detail)

    await expect(fail(err)).rejects.toMatchObject({
      code: 'REMOTE_ERROR',
      message: i18n.t('error.http.504')
    })
  })

  it('maps an exhausted-retry 504 nested in errors to the friendly timeout string', async () => {
    const detail = {
      name: 'AI_RetryError',
      message: 'Failed after 3 attempts',
      stack: null,
      errors: [{ name: 'AI_APICallError', message: '', stack: null, statusCode: 504 }]
    }
    const err = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, '', detail)

    await expect(fail(err)).rejects.toMatchObject({
      code: 'REMOTE_ERROR',
      message: i18n.t('error.http.504')
    })
  })

  it('normalizes a plain (non-AI) error without inventing detail', async () => {
    await expect(fail(new Error('network down'))).rejects.toMatchObject({
      name: 'PaintingGenerateError',
      code: 'REMOTE_ERROR',
      message: 'network down'
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
