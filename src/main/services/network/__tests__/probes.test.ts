import { describe, expect, it } from 'vitest'

import { classifyNetworkError } from '../probes'

describe('classifyNetworkError', () => {
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

  it('maps aborts to timeout and everything else to unknown', () => {
    expect(
      classifyNetworkError(Object.assign(new Error('The operation was aborted'), { code: 'ABORT_ERR' }))
    ).toMatchObject({ kind: 'timeout' })
    expect(classifyNetworkError(new Error('something odd'))).toEqual({ kind: 'unknown', code: undefined })
  })
})
