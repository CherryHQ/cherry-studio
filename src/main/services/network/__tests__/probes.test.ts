import { describe, expect, it } from 'vitest'

import { classifyNetworkError } from '../probes'

describe('classifyNetworkError', () => {
  it('returns an unknown failure when rejection text cannot be read', () => {
    const unprintable = { toString: null, valueOf: null }
    expect(classifyNetworkError(unprintable)).toEqual({ kind: 'unknown', code: undefined })
    expect(classifyNetworkError(Object.defineProperty(new Error('failed'), 'message', { value: unprintable }))).toEqual(
      {
        kind: 'unknown',
        code: undefined
      }
    )
  })

  it.each([null, undefined, false, 0, 'private request details'])(
    'classifies an opaque rejection without exposing its text',
    (failure) => {
      expect(classifyNetworkError(failure)).toEqual({ kind: 'unknown', code: undefined })
    }
  )

  it('classifies a revoked proxy without replacing the original probe failure', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()

    expect(classifyNetworkError(proxy)).toEqual({ kind: 'unknown', code: undefined })
    expect(classifyNetworkError(proxy, 407)).toEqual({ kind: 'proxy_auth', code: 'HTTP 407' })
  })

  it('preserves readable transport evidence when the cause cannot be read', () => {
    const error = Object.assign(new Error('private connection details'), { code: 'ECONNREFUSED' })
    Object.defineProperty(error, 'cause', {
      get() {
        throw new Error('unreadable cause')
      }
    })

    expect(classifyNetworkError(error)).toEqual({ kind: 'refused', code: 'ECONNREFUSED' })
  })

  it('still reads a cause when the outer code cannot be read', () => {
    const error = new Error('fetch failed', {
      cause: Object.assign(new Error('inner failure'), { code: 'ENOTFOUND' })
    })
    Object.defineProperty(error, 'code', {
      get() {
        throw new Error('unreadable code')
      }
    })

    expect(classifyNetworkError(error)).toEqual({ kind: 'dns', code: 'ENOTFOUND' })
  })

  it('still recognizes a caller abort when an outer name cannot be read', () => {
    const error = new Error('outer failure', { cause: new DOMException('deadline elapsed', 'TimeoutError') })
    Object.defineProperty(error, 'name', {
      get() {
        throw new Error('unreadable name')
      }
    })

    expect(classifyNetworkError(error)).toEqual({ kind: 'timeout', code: 'TimeoutError' })
  })

  it.each(['CUSTOM_FAILURE', ''])(
    'keeps the first string Node code %j instead of adopting a deeper Node code',
    (code) => {
      const error = Object.assign(
        new Error('outer failure', {
          cause: Object.assign(new Error('inner failure'), { code: 'ECONNREFUSED' })
        }),
        { code }
      )

      expect(classifyNetworkError(error)).toEqual({ kind: 'unknown', code })
    }
  )

  it('retains Node, Chromium and caller-abort precedence across wrapped errors', () => {
    const chromium = Object.assign(new Error('net::ERR_CERT_REVOKED'), { name: 'AbortError' })
    const known = Object.assign(new Error('outer failure', { cause: chromium }), { code: 'ECONNREFUSED' })
    const unknown = Object.assign(new Error('outer failure', { cause: chromium }), { code: 'CUSTOM_FAILURE' })

    expect(classifyNetworkError(known)).toEqual({ kind: 'refused', code: 'ECONNREFUSED' })
    expect(classifyNetworkError(unknown)).toEqual({ kind: 'tls_cert', code: 'ERR_CERT_REVOKED' })
  })

  it('finishes classification for cyclic causes and ignores errors beyond the five-value boundary', () => {
    const cyclic = Object.assign(new Error('connection failed'), { code: 'ECONNRESET' })
    cyclic.cause = cyclic
    expect(classifyNetworkError(cyclic)).toEqual({ kind: 'reset', code: 'ECONNRESET' })

    let nested: Error = Object.assign(new Error('inner failure'), { code: 'ENOTFOUND' })
    for (let depth = 0; depth < 5; depth++) nested = new Error('wrapper', { cause: nested })

    expect(classifyNetworkError(nested)).toEqual({ kind: 'unknown', code: undefined })
    expect(classifyNetworkError(nested.cause)).toEqual({ kind: 'dns', code: 'ENOTFOUND' })
  })

  it('reads Chromium codes out of net.fetch messages', () => {
    expect(classifyNetworkError(new Error('net::ERR_NAME_NOT_RESOLVED'))).toEqual({
      kind: 'dns',
      code: 'ERR_NAME_NOT_RESOLVED'
    })
    expect(classifyNetworkError(new Error('net::ERR_PROXY_CONNECTION_FAILED'))).toMatchObject({
      kind: 'proxy_unreachable'
    })
  })

  it('reads Node error codes', () => {
    expect(classifyNetworkError(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }))).toEqual({
      kind: 'refused',
      code: 'ECONNREFUSED'
    })
    expect(
      classifyNetworkError(Object.assign(new Error('self signed'), { code: 'SELF_SIGNED_CERT_IN_CHAIN' }))
    ).toMatchObject({
      kind: 'tls_cert'
    })
  })

  it('treats any ERR_CERT_* / ERR_SSL_* code as a certificate failure even when not in the table', () => {
    expect(classifyNetworkError(new Error('net::ERR_CERT_REVOKED'))).toEqual({
      kind: 'tls_cert',
      code: 'ERR_CERT_REVOKED'
    })
    expect(classifyNetworkError(new Error('net::ERR_SSL_PROTOCOL_ERROR'))).toMatchObject({ kind: 'tls_cert' })
  })

  it('classifies HTTP statuses: 407 is proxy auth, 5xx is the server, other 4xx reached the server', () => {
    expect(classifyNetworkError(undefined, 407)).toEqual({ kind: 'proxy_auth', code: 'HTTP 407' })
    expect(classifyNetworkError(undefined, 503)).toEqual({ kind: 'http_server', code: 'HTTP 503' })
    expect(classifyNetworkError(undefined, 404)).toEqual({ kind: 'http_client', code: 'HTTP 404' })
  })

  it('maps the caller-side abort (signal reason) to timeout', () => {
    expect(classifyNetworkError(new DOMException('The operation timed out', 'TimeoutError'))).toEqual({
      kind: 'timeout',
      code: 'TimeoutError'
    })
    expect(
      classifyNetworkError(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError', code: 'ABORT_ERR' })
      )
    ).toEqual({ kind: 'timeout', code: 'ABORT_ERR' })
  })

  it('keeps a peer-side abort as a reset with its own code, not a caller timeout', () => {
    expect(classifyNetworkError(new Error('net::ERR_CONNECTION_ABORTED'))).toEqual({
      kind: 'reset',
      code: 'ERR_CONNECTION_ABORTED'
    })
    expect(classifyNetworkError(new Error('request aborted by something odd'))).toEqual({ kind: 'unknown' })
  })
})
