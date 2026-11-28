import { APICallError, RetryError } from 'ai'
import { describe, expect, it } from 'vitest'

import { serializeChatStreamError } from '../serializeChatStreamError'
import { serializeError } from '../serializeError'

const request = {} as const
const image = { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,secret-image' } }
const text = { type: 'text', text: 'private-text' }
const phrase = 'Downloaded image content cannot exceed 30MB'
function api(message = phrase, statusCode: number | undefined = 413, messages: unknown = [{ content: [image] }]) {
  return new APICallError({
    message,
    statusCode,
    url: 'https://example.test',
    requestBodyValues: { messages },
    responseBody: JSON.stringify({ error: { message }, secret: 'private-secret' })
  })
}

describe('serializeChatStreamError', () => {
  it.each([
    ['history image', [{ content: [image] }, { content: [text] }]],
    ['current image', [{ content: [text, image] }]],
    ['mixed images', [{ content: [image] }, { content: [text, image] }]]
  ])('adds safe recovery for %s', (_label, messages) => {
    const result = serializeChatStreamError(api(phrase, 413, messages), request)
    expect(result).toMatchObject({
      providerErrorCategory: 'payload',
      i18nKey: 'diagnosis.payload',
      detailI18nKey: 'image_payload_rejection_detail',
      detailI18nValues: { reason: phrase }
    })
    expect(JSON.stringify(result)).not.toMatch(/secret-image|private-text|private-secret/)
    expect(result.requestBodyValues).toBeNull()
    expect(result.responseBody).toBeNull()
  })
  it.each([400, 413, undefined])('accepts status %s', (status) => {
    const error = new APICallError({
      message: 'Downloaded image content cannot exceed 42 MiB',
      statusCode: status,
      url: '',
      requestBodyValues: { messages: [{ content: [image] }] }
    })
    expect(serializeChatStreamError(error, request).providerErrorCategory).toBe('payload')
  })
  it('removes an inline data URL from the selected provider reason', () => {
    const result = serializeChatStreamError(api(`${phrase}. data:image/jpeg;base64,QUJDREVGRw==`), request)
    const reason = (result.detailI18nValues as { reason: string }).reason
    expect(reason).toContain(phrase)
    expect(reason).not.toMatch(/data:image|base64,|QUJDREVGRw/)
    expect(result.requestBodyValues).toBeNull()
  })
  it('redacts a bare secret token in the selected provider reason', () => {
    const token = 'sk-proj-abcdefghijklmnopqrstuvwxyz123456'
    const result = serializeChatStreamError(api(`${phrase}. ${token}`), request)
    const reason = (result.detailI18nValues as { reason: string }).reason
    expect(reason).toContain(phrase)
    expect(reason).not.toContain(token)
    expect(reason).toContain('<redacted>')
  })
  it('does not enrich when truncation removes the image clause', () => {
    const error = api(`${'x'.repeat(200)} ${phrase}`)
    expect(serializeChatStreamError(error, request)).toEqual(serializeError(error))
  })
  it.each([
    ['no image', api(phrase, 413, [{ content: [text] }])],
    ['generic payload', api('payload too large')],
    ['buffer', api('failed to buffer the request body: length limit exceeded')],
    ['unsupported body', api(phrase, 413, 'bad')],
    ['empty URL', api(phrase, 413, [{ content: [{ type: 'image_url', image_url: { url: '' } }] }])],
    ['PDF', api(phrase, 413, [{ content: [{ type: 'file', data: 'private-pdf' }] }])],
    ['audio', api(phrase, 413, [{ content: [{ type: 'input_audio', data: 'private-audio' }] }])],
    ['tool', api(phrase, 413, [{ content: [{ type: 'tool_result', content: 'private-tool' }] }])],
    ['content filter', api(`${phrase} blocked by safety`, 400)],
    ['quota', api(`${phrase} insufficient quota`, 400)],
    ['validation', api('invalid field', 400)],
    ['rate limit', api(phrase, 429)],
    ['server', api(phrase, 500)],
    ['auth', api(`${phrase} invalid api key`, 400)],
    ['context', api(`${phrase} context window exceeded`, 400)]
  ])('leaves %s unchanged', (_label, error) => {
    expect(serializeChatStreamError(error, request)).toEqual(serializeError(error))
  })
  it('recognizes a terminal image failure inside a retry', () => {
    const error = new RetryError({
      message: 'failed',
      reason: 'maxRetriesExceeded',
      errors: [api('invalid field', 400), api()]
    })
    expect(serializeChatStreamError(error, request)).toMatchObject({
      detailI18nKey: 'image_payload_rejection_detail',
      lastError: { requestBodyValues: null }
    })
    expect(JSON.stringify(serializeChatStreamError(error, request))).not.toContain('secret-image')
  })
  it.each([{ statusCode: 429 }, { finishReason: 'SAFETY' }])(
    'preserves a retry wrapper with a strong signal: %s',
    (signal) => {
      const error = Object.assign(
        new RetryError({ message: 'failed', reason: 'maxRetriesExceeded', errors: [api()] }),
        signal
      )
      expect(serializeChatStreamError(error, request)).toEqual(serializeError(error))
    }
  )
  it('uses the final retry error only', () => {
    const error = new RetryError({
      message: 'failed',
      reason: 'maxRetriesExceeded',
      errors: [api(), api('invalid field', 400)]
    })
    expect(serializeChatStreamError(error, request)).toEqual(serializeError(error))
  })
  it.each([
    { runtime: { kind: 'agent-session' as const, sessionId: 'session', turnId: 'turn' } },
    { contextOwner: 'caller' as const }
  ])('skips caller-owned and agent requests', (scope) => {
    const error = api()
    expect(serializeChatStreamError(error, scope)).toEqual(serializeError(error))
  })
})
