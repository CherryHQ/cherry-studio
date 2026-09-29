import { createRequire } from 'node:module'

import type axiosType from 'axios'
import type * as DingTalkSdk from 'dingtalk-stream'
import { DWClient, type DWClientDownStream } from 'dingtalk-stream'
import { describe, expect, it, vi } from 'vitest'

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

describe('patched DingTalk SDK lifecycle', () => {
  it('reports registered and disconnected states through its public API without console output', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})
    const client = new DWClient({ clientId: 'app', clientSecret: 'secret', subscriptions: [], logger })
    const states: boolean[] = []
    client.on('connectionState', (state) => states.push(state))
    try {
      client.onSystem({ headers: { topic: 'REGISTERED' } } as DWClientDownStream)
      client.disconnect()
      expect(states).toEqual([true, false])
      expect(client.registered).toBe(false)
      expect(consoleInfo).not.toHaveBeenCalled()
    } finally {
      client.disconnect()
      consoleInfo.mockRestore()
    }
  })

  it('cancels an in-flight gateway request in the CJS production entry without opening a socket', async () => {
    const require = createRequire(import.meta.url)
    const sdk = require('dingtalk-stream') as typeof DingTalkSdk
    const sdkRequire = createRequire(require.resolve('dingtalk-stream'))
    const axios = sdkRequire('axios').default as typeof axiosType
    const previousAdapter = axios.defaults.adapter
    let signal: AbortSignal | undefined
    axios.defaults.adapter = (config) =>
      new Promise((_resolve, reject) => {
        signal = config.signal as AbortSignal
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      })
    const client = new sdk.DWClient({
      clientId: 'app',
      clientSecret: 'secret',
      subscriptions: [],
      logger,
      autoReconnect: false
    })
    try {
      const connecting = client.connect()
      expect(signal?.aborted).toBe(false)
      client.disconnect()
      await connecting
      expect(signal?.aborted).toBe(true)
      expect(client.connected).toBe(false)
      expect(client.registered).toBe(false)
    } finally {
      client.disconnect()
      axios.defaults.adapter = previousAdapter
    }
  })
})
