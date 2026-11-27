import { PassThrough } from 'node:stream'

import { expect, it } from 'vitest'
import * as z from 'zod'

import { runtimeId } from '@cherrystudio/agent-runtime'

import {
  type AcpDesktopEvents,
  connectAcpManagementStdio,
  connectAcpStdio,
  mapAcpPermissionOptions,
  readNegotiatedAcpUsage
} from '../src/v1'

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
  const events: AcpDesktopEvents = {
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
    options() {},
    compaction() {}
  }
  const client = connectAcpStdio(stdin, stdout, {
    clientInfo: { name: 'fixture', version: '0.0.0' },
    backendId: runtimeId<'backend'>('fixture'),
    closeAndJoin: async () => {
      stdin.destroy()
      stdout.destroy()
    },
    report: () => {},
    callbacks: {},
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
    const original = session.acp.runPrompt({
      inputId: runtimeId<'input'>('revision'),
      content: [{ type: 'text', text: 'prompt' }]
    })
    const id = await prompt.promise
    emit(content('original reply'), native('started'), content('native reply'), native('finished'), {
      id,
      result: { stopReason: 'end_turn' }
    })
    await original
    expect(observed).toEqual(['original reply'])

    session.acp.drainNativeTurn()
    expect(observed).toEqual(['original reply', 'started', 'native reply', 'finished'])
  } finally {
    client.close()
  }
})

it('keeps metadata-only ACP updates out of the desktop tool timeline', async () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const emit = (frame: object) => stdout.write(JSON.stringify({ jsonrpc: '2.0', ...frame }) + '\n')
  const update = (update: object) => emit({ method: 'session/update', params: { sessionId: 'session', update } })
  const observed: Parameters<AcpDesktopEvents['tool']>[] = []
  stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().trim().split('\n')) {
      const { id, method } = JSON.parse(line) as { id: number; method: string }
      if (method === 'initialize') emit({ id, result: { protocolVersion: 1, agentCapabilities: {} } })
      if (method === 'session/new') emit({ id, result: { sessionId: 'session' } })
      if (method === 'session/prompt') {
        update({ sessionUpdate: 'tool_call', toolCallId: 'command', title: 'Run check', status: 'pending' })
        update({ sessionUpdate: 'tool_call_update', toolCallId: 'metadata', _meta: { progress: 1 } })
        update({ sessionUpdate: 'tool_call_update', toolCallId: 'command', _meta: { progress: 2 } })
        update({ sessionUpdate: 'tool_call_update', toolCallId: 'command', status: 'completed' })
        emit({ id, result: { stopReason: 'end_turn' } })
      }
    }
  })
  const client = connectAcpStdio(stdin, stdout, {
    clientInfo: { name: 'fixture', version: '0.0.0' },
    backendId: runtimeId<'backend'>('fixture'),
    closeAndJoin: async () => {
      stdin.destroy()
      stdout.destroy()
    },
    report: () => {},
    callbacks: {},
    events: {
      opened() {},
      content() {},
      tool(...args) {
        observed.push(args)
      },
      plan() {},
      title() {},
      notice() {},
      usage() {},
      commands() {},
      options() {},
      compaction() {}
    }
  })
  try {
    const session = await (await client.initialize()).create({ cwd: '/fixture', mcpServers: [] }, async () => {})
    await session.acp.runPrompt({
      inputId: runtimeId<'input'>('revision'),
      content: [{ type: 'text', text: 'prompt' }]
    })
    expect(observed).toEqual([
      ['command', { title: 'Run check', status: 'pending' }],
      ['command', { status: 'completed' }]
    ])
  } finally {
    client.close()
  }
})

it('keeps the native option IDs and recognizes Kimi’s session-scoped approval wording', () => {
  const options = mapAcpPermissionOptions([
    { optionId: 'approve_once', name: 'Approve once', kind: 'allow_once' },
    { optionId: 'approve_always', name: 'Approve for this session', kind: 'allow_always' },
    { optionId: 'reject_always', name: 'Reject all matching operations', kind: 'reject_always' }
  ])
  expect(options).toMatchObject([
    { optionId: 'approve_once', decision: 'accept', label: 'allow_once' },
    { optionId: 'approve_always', decision: 'acceptForSession', label: 'allow_session' },
    { optionId: 'reject_always', decision: 'decline', persistent: true }
  ])
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

it('publishes the model and its effort only after native confirmation', async () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const changes: { modelId?: string; effort?: string }[] = []
  const request = z.object({
    id: z.union([z.string(), z.number()]),
    method: z.string(),
    params: z.object({ configId: z.string().optional(), value: z.string().optional() }).optional()
  })
  const choices = [
    { value: 'first', name: 'First' },
    { value: 'second', name: 'Second' }
  ]
  const options = (model: string, effort: string) => [
    { id: 'native-model', name: 'Model', type: 'select', category: 'model', currentValue: model, options: choices },
    {
      id: 'effort',
      name: 'Effort',
      type: 'select',
      category: 'thought_level',
      currentValue: effort,
      options: [{ value: effort, name: effort }]
    }
  ]
  let confirm = false
  stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().trim().split('\n')) {
      const { id, method, params } = request.parse(JSON.parse(line))
      const result =
        method === 'initialize'
          ? { protocolVersion: 1, agentCapabilities: {} }
          : method === 'session/new'
            ? { sessionId: 'session', configOptions: options('first', 'low') }
            : {
                configOptions:
                  confirm && params?.configId === 'native-model' && params.value === 'second'
                    ? options('second', 'high')
                    : options('first', 'low')
              }
      stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n')
    }
  })

  let readModel: () => string | undefined = () => undefined
  const client = connectAcpStdio(stdin, stdout, {
    clientInfo: { name: 'fixture', version: '0.0.0' },
    backendId: runtimeId<'backend'>('fixture'),
    closeAndJoin: async () => {
      stdin.destroy()
      stdout.destroy()
    },
    report: () => {},
    callbacks: {},
    events: {
      opened(session) {
        readModel = () => session.acp.model.activeModel?.id
      },
      options(options) {
        const effort = options?.find(({ id }) => id === 'effort')
        changes.push({ modelId: readModel(), effort: effort?.type === 'select' ? effort.currentValue : undefined })
      },
      content() {},
      tool() {},
      plan() {},
      title() {},
      notice() {},
      usage() {},
      commands() {},
      compaction() {}
    }
  })
  try {
    const agent = await client.initialize()
    const session = await agent.create({ cwd: '/fixture', mcpServers: [] }, async () => {})
    expect(await session.acp.selectModel('outside-catalog')).toMatchObject({
      status: 'rejected',
      error: { code: 'invalid-model' }
    })
    expect(await session.acp.selectModel('second')).toMatchObject({
      status: 'rejected',
      error: { code: 'model-unconfirmed' }
    })
    expect(session.acp.model.activeModel?.id).toBe('first')
    expect(changes).toEqual([])
    confirm = true
    expect(await session.acp.selectModel('second')).toMatchObject({ status: 'confirmed' })
    expect(changes.at(-1)).toEqual({ modelId: 'second', effort: 'high' })
  } finally {
    client.close()
  }
})

it('routes a native turn received during restore and keeps replay out of the desktop timeline', async () => {
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const request = z.object({ id: z.union([z.string(), z.number()]), method: z.string() })
  const emit = (...frames: object[]) =>
    stdout.write(frames.map((frame) => JSON.stringify({ jsonrpc: '2.0', ...frame })).join('\n') + '\n')
  const content = (text: string) => ({
    method: 'session/update',
    params: {
      sessionId: 'existing',
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } }
    }
  })
  const native = (state: 'started' | 'finished') => ({
    method: '_fixture/turn',
    params: { sessionId: 'existing', id: 'first-native-turn', state }
  })
  const configOptions = (currentValue: string) => [
    {
      id: 'model',
      name: 'Model',
      type: 'select',
      category: 'model',
      currentValue,
      options: [
        { value: 'first', name: 'First' },
        { value: 'second', name: 'Second' }
      ]
    }
  ]
  stdin.on('data', (chunk: Buffer) => {
    for (const line of chunk.toString().trim().split('\n')) {
      const { id, method } = request.parse(JSON.parse(line))
      if (method === 'initialize')
        emit({ id, result: { protocolVersion: 1, agentCapabilities: { sessionCapabilities: { resume: {} } } } })
      if (method === 'session/resume')
        emit(content('replayed history'), { id, result: { configOptions: configOptions('first') } })
      if (method === 'session/set_config_option')
        emit(native('started'), content('new native reply'), native('finished'), {
          id,
          result: { configOptions: configOptions('second') }
        })
    }
  })
  const observed: string[] = []
  const client = connectAcpStdio(stdin, stdout, {
    clientInfo: { name: 'fixture', version: '0.0.0' },
    backendId: runtimeId<'backend'>('fixture'),
    closeAndJoin: async () => {
      stdin.destroy()
      stdout.destroy()
    },
    report: () => {},
    callbacks: {},
    harness: {
      registerProtocol(host) {
        host.onNotification('_fixture/turn', turn, host.nativeTurn)
        return () => ({ metadata: {}, read: () => undefined, release() {} })
      }
    },
    events: {
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
      options() {},
      compaction() {}
    }
  })
  try {
    const agent = await client.initialize()
    if (!agent.restore) throw new Error('Fixture did not advertise restore')
    const session = await agent.restore({ cwd: '/fixture', sessionId: 'existing', mcpServers: [] }, async (handle) => {
      expect(await handle.acp.selectInitialModel({ model: 'second' })).toMatchObject({ status: 'confirmed' })
      expect(observed).toEqual([])
    })
    expect(session.thread.id).toBe('existing')
    expect(observed).toEqual(['started', 'new native reply', 'finished'])
  } finally {
    await client.shutdown()
  }
})
