import { describe, expect, it } from 'vitest'

import { connectionMethods, remoteAuthorizationSchema, remoteFailureSchema } from '@cherrystudio/remote-protocol'

import { RemoteRpcError, RemoteRpcServer } from '../src/index'

const ping = connectionMethods(remoteAuthorizationSchema)['connection.ping']

describe('request-only JSON-RPC dispatch', () => {
  it('preserves typed domain errors through a catch and RPC serialization', async () => {
    const server = new RemoteRpcServer<void>(() => {})
    server.addMethod('connection.ping', ping, () => {
      try {
        throw new RemoteRpcError('CONFLICT', 'Execution changed')
      } catch (error) {
        if (error instanceof RemoteRpcError) throw error
        throw new RemoteRpcError('INTERNAL', 'Unknown outcome')
      }
    })
    expect(
      await server.receive({ jsonrpc: '2.0', id: 1, method: 'connection.ping', params: { nonce: 'n' } }, undefined)
    ).toMatchObject({ error: { code: 1000, data: { reason: 'CONFLICT', message: 'Execution changed' } } })
  })

  it('distinguishes null IDs from notifications and rejects whole oversized batches before side effects', async () => {
    let count = 0
    const server = new RemoteRpcServer<void>(() => {})
    server.addMethod('connection.ping', ping, ({ nonce }) => {
      count++
      return { nonce, serverTime: '2026-09-21T00:00:00Z' }
    })
    const notification = { jsonrpc: '2.0', method: 'connection.ping', params: { nonce: 'n' } }
    expect(await server.receive(notification, undefined)).toBeNull()
    expect(count).toBe(0)
    expect(await server.receive({ ...notification, id: null }, undefined)).toMatchObject({
      id: null,
      result: { nonce: 'n' }
    })
    expect(count).toBe(1)
    expect(
      await server.receive(
        Array.from({ length: 17 }, (_, id) => ({ ...notification, id })),
        undefined
      )
    ).toMatchObject({ error: { code: -32600 } })
    expect(count).toBe(1)
    expect(
      await server.receive({ ...notification, id: 'bad', params: { nonce: 'n', hidden: true } }, undefined)
    ).toMatchObject({ error: { code: -32602 } })
    expect(count).toBe(1)
  })

  it('rejects duplicate concurrent IDs without running the mutation twice', async () => {
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    let count = 0
    const server = new RemoteRpcServer<void>(() => {})
    server.addMethod('connection.ping', ping, async ({ nonce }) => {
      count++
      await pending
      return { nonce, serverTime: '2026-09-21T00:00:00Z' }
    })
    const request = { jsonrpc: '2.0', id: 1, method: 'connection.ping', params: { nonce: 'n' } }
    const first = server.receive(request, undefined)
    expect(await server.receive(request, undefined)).toMatchObject({ error: { code: -32600 } })
    finish()
    expect(await first).toMatchObject({ result: { nonce: 'n' } })
    expect(count).toBe(1)
  })
})

describe('refusal without dispatch', () => {
  const failure = { reason: 'RATE_LIMITED' as const, message: 'Request rate exceeded', retryAfterMs: 500 }
  const request = { jsonrpc: '2.0', id: 1, method: 'connection.ping', params: { nonce: 'n' } }
  const notification = { jsonrpc: '2.0', method: 'connection.ping', params: { nonce: 'n' } }

  it('answers a request with a protocol-valid retryable failure without running its handler', () => {
    let calls = 0
    const server = new RemoteRpcServer<void>(() => {})
    server.addMethod('connection.ping', ping, ({ nonce }) => {
      calls++
      return { nonce, serverTime: '2026-09-21T00:00:00Z' }
    })

    const response = server.refuse(request, failure)
    expect(response).toMatchObject({ id: 1, error: { code: 1000, data: failure } })
    const data = response && !Array.isArray(response) && 'error' in response ? response.error.data : undefined
    expect(data).toBe(failure)
    expect(remoteFailureSchema.safeParse(data).success).toBe(true)
    expect(data).toMatchObject({ retryAfterMs: 500 })
    expect(calls).toBe(0)
  })

  it('omits notifications and answers each request in a mixed batch', () => {
    const server = new RemoteRpcServer<void>(() => {})
    expect(server.refuse(notification, failure)).toBeNull()
    expect(server.refuse([notification], failure)).toBeNull()
    expect(server.refuse([request, notification, { ...request, id: 2 }], failure)).toEqual([
      { jsonrpc: '2.0', id: 1, error: { code: 1000, message: failure.message, data: failure } },
      { jsonrpc: '2.0', id: 2, error: { code: 1000, message: failure.message, data: failure } }
    ])
  })

  it('rejects oversized batches and malformed entries with the standard invalid-request errors', () => {
    const server = new RemoteRpcServer<void>(() => {})
    expect(
      server.refuse(
        Array.from({ length: 17 }, (_, id) => ({ ...request, id })),
        failure
      )
    ).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid batch' }
    })
    expect(server.refuse([], failure)).toMatchObject({ id: null, error: { code: -32600, message: 'Invalid batch' } })
    expect(server.refuse({ ...request, extra: true }, failure)).toEqual({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid request' }
    })
  })
})
