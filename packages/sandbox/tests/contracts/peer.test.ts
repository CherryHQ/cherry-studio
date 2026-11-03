import { PassThrough } from 'node:stream'

import { afterEach, expect, it } from 'vitest'
import { createMessageConnection } from 'vscode-jsonrpc/node'

import { deferred } from '../../src/host/deferred.js'
import { createRpcPeer } from '../../src/rpc/peer.js'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

function connect() {
  const input = new PassThrough()
  const output = new PassThrough()
  const peer = createRpcPeer(input, output, { authorize: async () => true })
  const remote = createMessageConnection(output, input)
  remote.listen()
  cleanups.push(() => {
    peer.dispose()
    remote.dispose()
    input.destroy()
    output.destroy()
  })
  return { peer, remote }
}

it.each(['timeout', 'abort'] as const)('keeps unresolved transport requests bounded after %s', async (interruption) => {
  const { peer, remote } = connect()
  const reply = deferred<string>()
  remote.onRequest('wait', () => reply.promise)
  remote.onRequest('echo', () => 'ok')
  const calls = Array.from({ length: 32 }, () => {
    const controller = new AbortController()
    const result = peer.request('wait', {}, { timeoutMs: 20, signal: controller.signal })
    const assertion = expect(result).rejects.toThrow(interruption === 'timeout' ? 'timed out' : 'cancelled')
    if (interruption === 'abort') controller.abort()
    return assertion
  })
  await Promise.all(calls)
  try {
    await expect(peer.request('echo', {}, { timeoutMs: 1000 })).rejects.toThrow('Too many pending')
  } finally {
    reply.resolve('late response')
  }
  await expect
    .poll(async () => {
      try {
        return await peer.request('echo', {}, { timeoutMs: 1000 })
      } catch (error) {
        return String(error)
      }
    })
    .toBe('ok')
})

it('rejects out-of-range timeouts and accepts the maximum timer delay', async () => {
  const { peer, remote } = connect()
  remote.onRequest('echo', () => 'ok')
  await expect(peer.request('echo', {}, { timeoutMs: 2147483648 })).rejects.toThrow('Invalid RPC timeout')
  await expect(peer.request('echo', {}, { timeoutMs: 2147483647 })).resolves.toBe('ok')
})

it('does not consume slots for pre-cancelled requests and settles pending calls on disconnect', async () => {
  const { peer, remote } = connect()
  remote.onRequest('echo', () => 'ok')
  for (let i = 0; i < 40; i++) {
    await expect(peer.request('echo', {}, { signal: AbortSignal.abort() })).rejects.toThrow('cancelled')
  }
  await expect(peer.request('echo', {})).resolves.toBe('ok')
  const pending = peer.request('echo', {})
  const assertion = expect(pending).rejects.toThrow('disconnected')
  peer.dispose()
  await assertion
})
