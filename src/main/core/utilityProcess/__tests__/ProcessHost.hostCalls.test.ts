import { describe, expect, it } from 'vitest'

import { createHost, echoServeOptions, rejectionOf } from './hostTestUtils'
import { waitUntil } from './memoryProcessAdapter'

function hostWithCallbacks() {
  return createHost({
    script: (child) => {
      const { options } = echoServeOptions((error) => child.triggerFatal(error))
      options.handlers.echo = (input, context) => context.callHost('echo', input)
      child.serve(options)
    }
  })
}

describe('request-scoped host capabilities', () => {
  it('routes concurrent requests only to their own host capability', async () => {
    const { host } = hostWithCallbacks()
    try {
      expect(
        await Promise.all([
          host.request('echo', 'left', { onHostCall: async (_method, input) => `${input}:one` }),
          host.request('echo', 'right', { onHostCall: async (_method, input) => `${input}:two` })
        ])
      ).toEqual(['left:one', 'right:two'])
      await expect(host.request('echo', 'untrusted')).rejects.toThrow('Host calls are not available')
    } finally {
      await host.dispose()
    }
  })

  it('aborts a host capability and fences its late reply when the parent request is cancelled', async () => {
    const { host } = hostWithCallbacks()
    const abort = new AbortController()
    let childSignal: AbortSignal | undefined
    let release!: (value: unknown) => void
    const result = rejectionOf(
      host.request('echo', null, {
        signal: abort.signal,
        onHostCall: async (_method, _input, signal) => {
          childSignal = signal
          return new Promise((resolve) => {
            release = resolve
          })
        }
      })
    )
    await waitUntil(() => !!childSignal)
    abort.abort(new Error('user stopped'))
    expect(await result).toMatchObject({ message: 'user stopped' })
    expect(childSignal?.aborted).toBe(true)
    release('stale')
    expect(await host.request('ping', undefined)).toBe('pong')
    await host.dispose()
  })
})
