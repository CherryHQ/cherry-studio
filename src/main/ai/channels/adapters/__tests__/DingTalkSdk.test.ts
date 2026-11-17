import { once } from 'node:events'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { AxiosStatic } from 'axios'
import type * as DingTalkSdk from 'dingtalk-stream'
import { DWClient } from 'dingtalk-stream'
import { describe, expect, it, vi } from 'vitest'
import { WebSocketServer } from 'ws'

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

const require = createRequire(import.meta.url)
const sdkRequire = createRequire(require.resolve('dingtalk-stream'))
const cjsSdk = require('dingtalk-stream') as typeof DingTalkSdk
const esmAxios = (await import(pathToFileURL(join(dirname(sdkRequire.resolve('axios/package.json')), 'index.js')).href))
  .default as AxiosStatic

describe('patched DingTalk SDK lifecycle', () => {
  it.each([
    { entry: 'ESM', Client: DWClient, http: esmAxios },
    { entry: 'CJS', Client: cjsSdk.DWClient, http: sdkRequire('axios').default as AxiosStatic }
  ])(
    'reports an open socket without a REGISTERED frame, then reports disconnection ($entry)',
    async ({ Client, http }) => {
      const server = new WebSocketServer({ host: '127.0.0.1', port: 0 })
      await once(server, 'listening')
      const address = server.address()
      if (typeof address === 'string' || !address) throw new Error('Expected a TCP address')
      const previousAdapter = http.defaults.adapter
      http.defaults.adapter = async (config) => ({
        data: { endpoint: `ws://127.0.0.1:${address.port}`, ticket: 'test-ticket' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config
      })
      const client = new Client({
        clientId: 'app',
        clientSecret: 'secret',
        subscriptions: [],
        logger,
        autoReconnect: false
      })
      const states: boolean[] = []
      client.on('connectionState', (state: boolean) => states.push(state))
      try {
        await client.connect()
        expect(client.connected).toBe(true)
        expect(states.at(-1)).toBe(true)
        for (const socket of server.clients) socket.close()
        await vi.waitFor(() => expect(client.connected).toBe(false))
        expect(states.at(-1)).toBe(false)
      } finally {
        client.disconnect()
        for (const socket of server.clients) socket.terminate()
        await new Promise<void>((resolve) => server.close(() => resolve()))
        http.defaults.adapter = previousAdapter
      }
    }
  )

  it('cancels an in-flight gateway request in the CJS production entry without opening a socket', async () => {
    const require = createRequire(import.meta.url)
    const sdk = require('dingtalk-stream') as typeof DingTalkSdk
    const sdkRequire = createRequire(require.resolve('dingtalk-stream'))
    const axios = sdkRequire('axios').default as AxiosStatic
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
