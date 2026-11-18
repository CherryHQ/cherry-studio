import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { ErrorCode, toDataApiError } from '../errors'

describe('toDataApiError', () => {
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
