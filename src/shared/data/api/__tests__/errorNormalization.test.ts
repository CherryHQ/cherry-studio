import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import {
  DataApiError,
  ErrorCode,
  isDataApiNotFoundError,
  isDataApiResourceNotFoundError,
  isSerializedDataApiError,
  toDataApiError
} from '../errors'

describe('toDataApiError', () => {
  it('preserves extension codes and opaque details through IPC reconstruction', () => {
    const wire = {
      code: 'FUTURE_PROVIDER_UNAVAILABLE',
      message: 'A newer API reported a provider failure',
      status: 503,
      details: { retryAfter: 15, provider: 'custom' },
      requestContext: { requestId: 'request-1', path: '/providers', method: 'GET' as const, timestamp: 1 }
    }

    const result = toDataApiError(wire)

    expect(result).toBeInstanceOf(DataApiError)
    expect(result.code).toBe(wire.code)
    expect(result.status).toBe(503)
    expect(result.isRetryable).toBe(false)
    expect(result.toJSON()).toEqual(wire)
  })

  it('does not infer a mapped detail shape from a reconstructed NOT_FOUND code', () => {
    const result = toDataApiError({
      code: ErrorCode.NOT_FOUND,
      message: 'Missing resource',
      status: 404,
      details: { resource: 42, id: false }
    })

    expect(isDataApiNotFoundError(result)).toBe(true)
    expect(isDataApiResourceNotFoundError(result, 'Topic')).toBe(false)
    expect(result.details).toEqual({ resource: 42, id: false })

    const wrapped = DataApiError.fromError(new Error('Missing resource'), ErrorCode.NOT_FOUND)
    expect(isDataApiNotFoundError(wrapped)).toBe(true)
    expect(isDataApiResourceNotFoundError(wrapped, 'Topic')).toBe(false)
  })

  it.each([
    ['scalar details', { details: 42 }],
    ['null details', { details: null }],
    ['array details', { details: [] }],
    ['invalid request context', { requestContext: { requestId: 42, path: '/topics', method: 'GET' } }],
    ['missing request context', { requestContext: { method: 'GET' } }],
    ['unsupported request method', { requestContext: { requestId: 'request-1', path: '/topics', method: 'TRACE' } }],
    [
      'invalid request timestamp',
      { requestContext: { requestId: 'request-1', path: '/topics', method: 'GET', timestamp: 'now' } }
    ],
    ['invalid reporting ownership', { reportingHandled: false }]
  ])('does not accept a wire error with %s as a complete serialized error', (_label, invalid) => {
    const wire = { code: ErrorCode.NOT_FOUND, message: 'Missing resource', status: 404, ...invalid }

    expect(isSerializedDataApiError(wire)).toBe(false)
    expect(toDataApiError(wire).code).toBe(ErrorCode.INTERNAL_SERVER_ERROR)
  })

  it('retains a native failure when unrelated optional metadata cannot be read', () => {
    const failure = Object.defineProperty(new Error('Storage read failed'), 'details', {
      get() {
        throw new Error('Metadata cannot be read')
      }
    })

    expect(isSerializedDataApiError(failure)).toBe(false)
    expect(toDataApiError(failure).toJSON()).toMatchObject({
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      status: 500,
      message: 'Internal error: Storage read failed',
      details: { originalError: 'Storage read failed' }
    })
  })

  it.each([
    [null],
    [{}],
    [{ path: null, message: 'Invalid input' }],
    [{ path: ['name'], message: 7 }],
    [{ path: [Symbol('name')], message: 'Invalid input' }]
  ])('keeps malformed validation issues as an internal failure: %j', (...issues) => {
    const error = Object.assign(new Error('Malformed validation failure'), { name: 'ZodError', issues })

    const result = toDataApiError(error)

    expect(result.code).toBe(ErrorCode.INTERNAL_SERVER_ERROR)
    expect(result.status).toBe(500)
    expect(result.message).toContain('Malformed validation failure')
  })

  it('maps real Zod field and root validation failures to 422', () => {
    const fields = z.object({ names: z.array(z.string({ error: 'Name must be text' })) }).safeParse({ names: [7] })
    const root = z.string({ error: 'Input must be text' }).safeParse(7)
    if (fields.success || root.success) throw new Error('Invalid fixtures passed validation')

    expect(toDataApiError(fields.error).toJSON()).toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      status: 422,
      details: { fieldErrors: { 'names.0': ['Name must be text'] } }
    })
    expect(toDataApiError(root.error).toJSON()).toMatchObject({
      code: ErrorCode.VALIDATION_ERROR,
      status: 422,
      details: { fieldErrors: { _root: ['Input must be text'] } }
    })
  })

  it('converts a rejection whose string conversion throws into an internal failure', () => {
    const error = {
      toString() {
        throw new Error('String conversion failed')
      }
    }

    expect(toDataApiError(error, 'loading topics').toJSON()).toMatchObject({
      code: ErrorCode.INTERNAL_SERVER_ERROR,
      status: 500,
      message: 'Unknown error in loading topics: [Unserializable]',
      details: { originalError: '[Unserializable]', context: 'loading topics' }
    })
  })

  it('groups all messages even when a validation path names an object prototype property', () => {
    const error = new z.ZodError([
      { code: 'custom', path: ['__proto__'], message: 'Reserved field' },
      { code: 'custom', path: ['__proto__'], message: 'Choose another name' }
    ])

    expect(toDataApiError(error).toJSON().details?.fieldErrors).toEqual({
      ['__proto__']: ['Reserved field', 'Choose another name']
    })
  })
})
