import type { Server } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'

import { node } from '@elysia/node'
import { Elysia } from 'elysia'
import { describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'

const cjsNode: typeof node = createRequire(import.meta.url)('@elysia/node').node

describe.each([
  ['ESM', node],
  ['CommonJS', cjsNode]
] as const)('Node WebSocket adapter (%s)', (_format, adapter) => {
  it('preserves data frames containing ping and handles real control pings separately', async () => {
    const errors: unknown[] = []
    const app = new Elysia({ adapter: adapter() }).ws('/echo', {
      message(ws, data) {
        // Echo the received type and bytes without Elysia's object serialization.
        ws.raw.send(data as string | Buffer)
      },
      error(error) {
        errors.push(error)
      }
    })
    type Info = { raw?: { ready?: () => Promise<unknown>; node?: { server?: Server } } }
    const info = await new Promise<Info>((resolve) => app.listen({ port: 0, hostname: '127.0.0.1' }, resolve))
    await info.raw?.ready?.()
    const http = info.raw!.node!.server!
    const port = (http.address() as AddressInfo).port
    const socket = new WebSocket(`ws://127.0.0.1:${port}/echo`)
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve)
        socket.once('error', reject)
      })
      for (const payload of ['ping', 'shipping', Buffer.from([0xff, 0x70, 0x69, 0x6e, 0x67, 0x00, 0x80])]) {
        const echoed = new Promise<{ data: Buffer; binary: boolean }>((resolve) =>
          socket.once('message', (data, binary) => resolve({ data: data as Buffer, binary }))
        )
        socket.send(payload)
        const response = await echoed
        expect(errors).toEqual([])
        expect(response.binary).toBe(typeof payload !== 'string')
        expect(response.data).toEqual(Buffer.from(payload))
      }
      const pong = new Promise<Buffer>((resolve) => socket.once('pong', resolve))
      socket.ping('control')
      expect(await pong).toEqual(Buffer.from('control'))
      expect(errors).toEqual([])
    } finally {
      socket.terminate()
      await new Promise<void>((resolve) => http.close(() => resolve()))
    }
  }, 10_000)
})
