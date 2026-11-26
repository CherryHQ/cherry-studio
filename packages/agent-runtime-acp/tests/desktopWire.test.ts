import { PassThrough } from 'node:stream'

import { expect, it } from 'vitest'
import * as z from 'zod'

import { connectAcpManagementStdio, connectAcpStdio, readNegotiatedAcpUsage, type AcpLiveEvents } from '../src/v1'

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

it.each([false, true])(
  'reads account windows only after ACP advertises the query (advertised: %s)',
  async (advertised) => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const request = z.object({ id: z.union([z.string(), z.number()]), method: z.string() })
    const methods: string[] = []
    stdin.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().trim().split('\n')) {
        const { id, method } = request.parse(JSON.parse(line))
        methods.push(method)
        const result =
          method === 'initialize'
            ? {
                protocolVersion: 1,
                agentCapabilities: advertised ? { _meta: { lody: { rateLimits: { version: 1, query: true } } } } : {}
              }
            : {
                rateLimits: [
                  {
                    limitId: 'weekly',
                    planName: 'Test plan',
                    windows: [{ usedPercent: 0, windowDurationSeconds: 604800, resetsAtEpochSeconds: 1800000000 }]
                  }
                ],
                fetchedAtEpochSeconds: 1799990000
              }
        stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
      }
    })

    const client = connectAcpManagementStdio(stdin, stdout, { name: 'fixture', version: '0.0.0' })
    try {
      const agent = await client.initialize()
      const result = await agent.readSubscriptionUsage(readNegotiatedAcpUsage, { env: {} })
      if (advertised) {
        expect(result).toMatchObject({
          status: 'available',
          readAt: 1799990000000,
          windows: [{ usedRatio: 0, durationMinutes: 10080, resetsAt: 1800000000000 }]
        })
        expect(methods).toEqual(['initialize', '_lody/rate_limits/get'])
      } else {
        expect(result).toEqual({ status: 'unsupported' })
        expect(methods).toEqual(['initialize'])
      }
    } finally {
      client.close()
    }
  }
)
