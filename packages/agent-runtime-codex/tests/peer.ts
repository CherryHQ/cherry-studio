import { createInterface } from 'node:readline'
import { PassThrough } from 'node:stream'

import { expect } from 'vitest'
import * as z from 'zod'

import { connectCodexAppServer, type CodexClientHandlers } from '../src/appServerClient'

const frame = z.looseObject({ id: z.union([z.string(), z.number()]).optional(), method: z.string().optional() })
export function createPeer() {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const lines = createInterface({ input: stdin })[Symbol.asyncIterator]()
  async function read() {
    const { value, done } = await lines.next()
    if (done) throw new Error('Client closed before writing the expected frame')
    return frame.parse(JSON.parse(value))
  }
  function send(message: object) {
    stdout.write(JSON.stringify(message) + '\n')
  }
  let wire: ReturnType<typeof connectCodexAppServer> | undefined
  function connect(handlers?: CodexClientHandlers) {
    wire = connectCodexAppServer(stdin, stdout, { name: 'test', title: null, version: '1' }, handlers)
    return { ready: wire.ready, close: async () => close() }
  }
  async function handshake(userAgent = 'test-server') {
    const init = await read()
    expect(init.method).toBe('initialize')
    send({ id: init.id, result: { userAgent } })
    expect(await read()).toEqual({ method: 'initialized' })
  }
  function close() {
    wire?.close()
    stdin.end()
    stdout.end()
  }
  return { connect, handshake, read, send, close, stdin, stdout }
}
