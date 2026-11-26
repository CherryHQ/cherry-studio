import { PassThrough } from 'node:stream'

import { expect, it } from 'vitest'
import * as z from 'zod'

import { connectAcpStdio, type AcpLiveEvents } from '../src/v1'

const turn = z.discriminatedUnion('state', [
  z.object({ state: z.literal('started'), sessionId: z.string(), id: z.string() }),
  z.object({ state: z.literal('finished'), sessionId: z.string(), id: z.string() })
])

it('preserves private native turn boundaries when the preceding prompt and its continuation share a wire batch', async () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const emit = (...frames: object[]) =>
    stdout.write(frames.map((frame) => JSON.stringify({ jsonrpc: '2.0', ...frame })).join('\n') + '\n')
  const request = z.object({ id: z.union([z.string(), z.number()]), method: z.string() })
  const prompt = Promise.withResolvers<string | number>()
  stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().trim().split('\n')) {
      const { id, method } = request.parse(JSON.parse(line))
      if (method === 'initialize') emit({ id, result: { protocolVersion: 1, agentCapabilities: {} } })
      if (method === 'session/new') emit({ id, result: { sessionId: 'session' } })
      if (method === 'session/prompt') prompt.resolve(id)
    }
  })

  const observed: string[] = []
  const events: AcpLiveEvents = {
    opened() {},
    nativeTurn(event) {
      observed.push(event.state)
      return true
    },
    content(_kind, part) {
      if (part.type === 'text') observed.push(part.text)
    },
    tool() {},
    plan() {},
    title() {},
    notice() {},
    usage() {},
    commands() {},
    mode() {},
    options() {},
    compaction() {}
  }
  const client = connectAcpStdio(stdin, stdout, {
    clientInfo: { name: 'fixture', version: '0.0.0' },
    callbacks: {},
    currentModel: () => undefined,
    events,
    harness: {
      registerProtocol(host) {
        host.onNotification('_fixture/turn', turn, host.nativeTurn)
        return () => ({ metadata: {}, read: () => undefined, release() {} })
      }
    }
  })
  const content = (text: string) => ({
    method: 'session/update',
    params: { sessionId: 'session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } }
  })
  const native = (state: 'started' | 'finished') => ({
    method: '_fixture/turn',
    params: { sessionId: 'session', id: 'native-turn', state }
  })

  try {
    const agent = await client.initialize()
    const session = await agent.create({ cwd: '/fixture', mcpServers: [] }, async () => {})
    const original = session.prompt([{ type: 'text', text: 'prompt' }], 'revision')
    const id = await prompt.promise
    emit(content('original reply'), native('started'), content('native reply'), native('finished'), {
      id,
      result: { stopReason: 'end_turn' }
    })
    await original
    expect(observed).toEqual(['original reply'])

    session.drainNativeTurn()
    expect(observed).toEqual(['original reply', 'started', 'native reply', 'finished'])
  } finally {
    client.close()
  }
})
