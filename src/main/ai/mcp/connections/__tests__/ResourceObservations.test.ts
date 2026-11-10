import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { createMcpHandler, Server, InMemoryServerEventBus } from '@modelcontextprotocol/server'
import { describe, expect, it } from 'vitest'

import { ClientMcpConnection } from '../ClientMcpConnection'
import { fetchMcpHandler } from './fetchMcpHandler'

const options = {
  capabilities: { elicitation: { form: {} }, sampling: {}, roots: {} },
  versionNegotiation: { mode: { pin: '2026-07-28' as const } }
}

describe('resource subscription leases over modern handler.fetch', () => {
  it('confirms before delivery, shares a URI stream and cancels only after its last owner closes', async () => {
    const updated: string[] = []
    const signals: AbortSignal[] = []
    const bus = new InMemoryServerEventBus()
    const handler = createMcpHandler(
      () => new Server({ name: 'resources', version: '1' }, { capabilities: { resources: { subscribe: true } } }),
      { legacy: 'reject', bus }
    )
    const connection = new ClientMcpConnection({ name: 'test', version: '1' }, options, {
      toolsChanged() {},
      promptsChanged() {},
      resourcesChanged() {},
      log() {},
      resourceUpdated: (uri) => updated.push(uri)
    })
    await connection.connect(
      new StreamableHTTPClientTransport(new URL('http://subscription.test/mcp'), {
        fetch: async (input, init) => {
          const request = new Request(input, init)
          if (request.method === 'POST' && (await request.json()).method === 'subscriptions/listen')
            signals.push(init!.signal!)
          return fetchMcpHandler(handler, input, init)
        }
      })
    )
    const first: string[] = [],
      second: string[] = []
    const a = connection.observeResource('docs://private/a', (state) => first.push(state))
    const b = connection.observeResource('docs://private/a', (state) => second.push(state))
    try {
      await expect.poll(() => [first.at(-1), second.at(-1)]).toEqual(['subscribed', 'subscribed'])
      expect(bus.listenerCount).toBe(1)
      handler.notify.resourceUpdated('docs://private/b')
      handler.notify.resourceUpdated('docs://private/a')
      await expect.poll(() => updated).toEqual(['docs://private/a'])
      await a.close()
      expect(bus.listenerCount).toBe(1)
      handler.notify.resourceUpdated('docs://private/a')
      await expect.poll(() => updated.length).toBe(2)
      await b.close()
      expect(signals.map((signal) => signal.aborted)).toEqual([true])
      await expect.poll(() => bus.listenerCount).toBe(0)
    } finally {
      await connection.close()
      await handler.close()
    }
  })

  it('reports unsupported resources without opening a stream', async () => {
    const bus = new InMemoryServerEventBus()
    const handler = createMcpHandler(
      () => new Server({ name: 'no-subscribe', version: '1' }, { capabilities: { resources: {} } }),
      { legacy: 'reject', bus }
    )
    const connection = new ClientMcpConnection({ name: 'test', version: '1' }, options, {
      toolsChanged() {},
      promptsChanged() {},
      resourcesChanged() {},
      resourceUpdated() {},
      log() {}
    })
    await connection.connect(
      new StreamableHTTPClientTransport(new URL('http://subscription.test/mcp'), {
        fetch: (input, init) => fetchMcpHandler(handler, input, init)
      })
    )
    const states: string[] = []
    try {
      const observation = connection.observeResource('docs://private/a', (state) => states.push(state))
      await expect.poll(() => states.at(-1)).toBe('unsupported')
      expect(bus.listenerCount).toBe(0)
      await observation.close()
      const pending = connection.observeResource('docs://private/b', () => undefined)
      await pending.close()
      expect(bus.listenerCount).toBe(0)
    } finally {
      await connection.close()
      await handler.close()
    }
  })
})
