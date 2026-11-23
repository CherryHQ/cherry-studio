import { describe, expect, it } from 'vitest'

import {
  createPaintingGenerateError,
  encodePaintingGenerateError,
  PaintingGenerateError
} from '@shared/ai/paintingGenerateError'
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
    const detail = { name: 'AI_APICallError', message: '503 Service unavailable', stack: null, statusCode: 503 }
    // Empty top-level message (the message-less case the user hit): the detail must win.
    const err = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, '', detail)

    await expect(fail(err)).rejects.toMatchObject({
      name: 'PaintingGenerateError',
      code: 'REMOTE_ERROR',
      message: '503 Service unavailable'
    })
  })

  it('maps authentication failures to localized token guidance without echoing the credential', async () => {
    const detail = {
      name: 'AI_APICallError',
      message: 'Incorrect API key provided: sk-mp92-invalid-secret',
      stack: null,
      statusCode: 401
    }
    const error = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, '', detail)
    await expect(fail(error)).rejects.toMatchObject({
      code: 'REQ_ERROR_TOKEN',
      message: 'REQ_ERROR_TOKEN'
    })
  })

  it('recovers a transport painting error encoded across the image job', async () => {
    // A main-process transport throws createPaintingGenerateError('REQ_ERROR_TOKEN') on HTTP 401; the job
    // handler encodes it into the message, and IPC wraps it as AI_REQUEST_FAILED without a status code.
    const message = encodePaintingGenerateError(createPaintingGenerateError('REQ_ERROR_TOKEN'))
    const err = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, message, { name: 'Error', message, stack: null })

    await expect(fail(err)).rejects.toMatchObject({ name: 'PaintingGenerateError', code: 'REQ_ERROR_TOKEN' })
  })

  it('recovers an encoded painting error from a plain error', async () => {
    const message = encodePaintingGenerateError(createPaintingGenerateError('REQ_ERROR_NO_BALANCE'))
    await expect(fail(new Error(message))).rejects.toMatchObject({ code: 'REQ_ERROR_NO_BALANCE' })
  })

  it('keeps vendor text that equals a code as a remote error (HTTP 422 with message REQ_ERROR_TOKEN)', async () => {
    const message = encodePaintingGenerateError(
      createPaintingGenerateError('REMOTE_ERROR', { message: 'REQ_ERROR_TOKEN' })
    )
    const err = new IpcError(aiErrorCodes.AI_REQUEST_FAILED, message, { name: 'Error', message, stack: null })
    await expect(fail(err)).rejects.toMatchObject({ code: 'REMOTE_ERROR', message: 'REQ_ERROR_TOKEN' })

    const plain = { name: 'Error', message: 'REQ_ERROR_TOKEN', stack: null }
    await expect(fail(new IpcError(aiErrorCodes.AI_REQUEST_FAILED, 'REQ_ERROR_TOKEN', plain))).rejects.toMatchObject({
      code: 'REMOTE_ERROR',
      message: 'REQ_ERROR_TOKEN'
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
