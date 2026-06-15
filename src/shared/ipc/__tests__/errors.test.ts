import { describe, expect, it } from 'vitest'

import { IpcError, IpcErrorCode, type SerializedIpcError } from '../errors'

describe('IpcError', () => {
  it('is an Error subclass carrying a string code', () => {
    const err = new IpcError('ROUTE_NOT_FOUND', 'window.close')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(IpcError)
    expect(err.code).toBe('ROUTE_NOT_FOUND')
    expect(err.message).toBe('window.close')
  })

  it('defaults message to the code when message is omitted', () => {
    const err = new IpcError('FORBIDDEN_SENDER')
    expect(err.message).toBe('FORBIDDEN_SENDER')
  })

  it('serializes to a plain JSON object with code/message and optional data', () => {
    const json: SerializedIpcError = new IpcError('VALIDATION_FAILED', 'bad input', { field: 'width' }).toJSON()
    expect(json).toEqual({ code: 'VALIDATION_FAILED', message: 'bad input', data: { field: 'width' } })
  })

  it('omits the data key from JSON when no data is attached', () => {
    const json = new IpcError('INTERNAL', 'boom').toJSON()
    expect(json).toEqual({ code: 'INTERNAL', message: 'boom' })
    expect('data' in json).toBe(false)
  })

  it('round-trips through toJSON/fromJSON preserving code, message and data', () => {
    const original = new IpcError('VALIDATION_FAILED', 'bad input', { field: 'height' })
    const restored = IpcError.fromJSON(original.toJSON())
    expect(restored).toBeInstanceOf(IpcError)
    expect(restored.code).toBe(original.code)
    expect(restored.message).toBe(original.message)
    expect(restored.data).toEqual(original.data)
  })

  it('from() returns the same instance when given an IpcError', () => {
    const err = new IpcError('ROUTE_NOT_FOUND', 'x')
    expect(IpcError.from(err)).toBe(err)
  })

  it('from() wraps a native Error as INTERNAL preserving its message', () => {
    const wrapped = IpcError.from(new Error('handler exploded'))
    expect(wrapped).toBeInstanceOf(IpcError)
    expect(wrapped.code).toBe('INTERNAL')
    expect(wrapped.message).toBe('handler exploded')
  })

  it('from() wraps a non-error thrown value as INTERNAL', () => {
    const wrapped = IpcError.from('plain string')
    expect(wrapped.code).toBe('INTERNAL')
    expect(wrapped.message).toBe('plain string')
  })
})

describe('IpcErrorCode', () => {
  it('is the single source of truth for exactly the framework error codes', () => {
    expect(IpcErrorCode).toEqual({
      ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
      VALIDATION_FAILED: 'VALIDATION_FAILED',
      FORBIDDEN_SENDER: 'FORBIDDEN_SENDER',
      INTERNAL: 'INTERNAL'
    })
  })

  it('backs IpcError.from() normalization (no bare string literal)', () => {
    expect(IpcError.from(new Error('boom')).code).toBe(IpcErrorCode.INTERNAL)
    expect(IpcError.from('x').code).toBe(IpcErrorCode.INTERNAL)
  })
})
