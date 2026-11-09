import {
  methods,
  RequestError,
  type SessionConfigOption,
  type SessionUpdate,
  type RequestPermissionResponse
} from '@agentclientprotocol/sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runtimeId, type ObservationPayload, type ThreadSnapshot } from '@cherrystudio/agent-runtime'

import type { AcpObservationFrame, AcpThreadHandle } from '../src/v1'
import { configuration, confirmed, deferred, fixture, input } from './fixture'

const fixtures: ReturnType<typeof fixture>[] = []
const setup: typeof fixture = (...args) => {
  const value = fixture(...args)
  fixtures.push(value)
  return value
}
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(fixtures.splice(0).map((value) => value.cleanup()))
})

async function collect(handle: AcpThreadHandle) {
  const events: ObservationPayload[] = []
  const observer = confirmed(
    await handle.observe((event) => {
      events.push(event)
    })
  )
  await observer.drain()
  return { events, observer }
}

async function finished(handle: AcpThreadHandle, id: string) {
  const { events, observer } = await collect(handle)
  await expect
    .poll(
      () =>
        events.some(
          (event) => event.type === 'input.changed' && event.input.inputId === id && event.input.outcome !== undefined
        ) ||
        events.some(
          (event) =>
            event.type === 'snapshot' && event.inputs.some((item) => item.inputId === id && item.outcome !== undefined)
        )
    )
    .toBe(true)
  await observer.drain()
  return events
}

describe('ACP connection and session ownership', () => {
  it('refuses a different protocol before creating a session', async () => {
    let created = false
    const { runtime } = setup({
      initialize: () => ({ protocolVersion: 2, agentCapabilities: {}, authMethods: [] }),
      'session/new': () => {
        created = true
        return { sessionId: 'bad' }
      }
    })
    expect(await runtime.create(configuration)).toMatchObject({
      status: 'rejected',
      error: { message: 'Unsupported ACP protocol version: 2' }
    })
    expect(created).toBe(false)
  })

  it('coalesces cold opens, captures replay before response and reuses the live owner', async () => {
    let loads = 0
    const { runtime } = setup({
      'session/load': async ({ client, params }) => {
        loads++
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: { sessionUpdate: 'user_message_chunk', messageId: 'u', content: { type: 'text', text: 'saved' } }
        })
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'a',
            content: { type: 'text', text: 'native history' }
          }
        })
        return {}
      }
    })
    const thread = { backendId: runtimeId<'backend'>('fixture'), id: runtimeId<'thread'>('saved') }
    const [a, b] = (await Promise.all([runtime.open(thread), runtime.open(thread)])).map(confirmed)
    await a.release()
    const c = confirmed(await runtime.open(thread))
    const { events } = await collect(b)
    expect(events[0]).toMatchObject({
      type: 'snapshot',
      messages: [
        { role: 'user', parts: [{ type: 'text', text: 'saved' }] },
        { role: 'assistant', parts: [{ type: 'text', text: 'native history' }] }
      ]
    })
    expect(c.acp.state().messages).toEqual(b.acp.state().messages)
    expect(loads).toBe(1)
  })

  it('does not replace missing or unsupported history with a new session', async () => {
    const thread = { backendId: runtimeId<'backend'>('fixture'), id: runtimeId<'thread'>('missing') }
    let created = false
    const { runtime } = setup({
      'session/new': () => {
        created = true
        return { sessionId: 'new' }
      },
      'session/load': () => {
        throw new RequestError(-32002, 'Missing history')
      }
    })
    expect(await runtime.open(thread)).toMatchObject({ status: 'rejected', error: { message: 'Missing history' } })
    expect(created).toBe(false)
    const unsupported = setup({ initialize: () => ({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] }) })
    expect(await unsupported.runtime.open(thread)).toMatchObject({ status: 'unsupported' })
    expect(await runtime.open({ ...thread, backendId: runtimeId<'backend'>('other') })).toMatchObject({
      status: 'rejected',
      error: { code: 'backend-mismatch' }
    })
  })

  it('routes new-session updates by returned ID and fails explicitly on setup overflow', async () => {
    const good = setup({
      'session/new': async ({ client }) => {
        await client.notify(methods.client.session.update, {
          sessionId: 'elsewhere',
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'wrong' } }
        })
        await client.notify(methods.client.session.update, {
          sessionId: 'new',
          update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'right' } }
        })
        return { sessionId: 'new' }
      }
    })
    const handle = confirmed(await good.runtime.create(configuration))
    expect((await collect(handle)).events[0]).toMatchObject({
      messages: [{ parts: [{ type: 'text', text: 'right' }] }]
    })
    const overflow = setup({
      'session/new': async ({ client }) => {
        for (let i = 0; i < 257; i++)
          await client.notify(methods.client.session.update, {
            sessionId: 'new',
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '.' } }
          })
        return { sessionId: 'new' }
      }
    })
    expect(await overflow.runtime.create(configuration)).toMatchObject({
      status: 'rejected',
      error: { message: 'ACP setup update buffer overflow' }
    })
  })
})

describe('input, permission and cancellation', () => {
  it('runs separate sessions concurrently without sharing native message identity', async () => {
    const ready = deferred<void>()
    let running = 0
    const { runtime } = setup({
      'session/prompt': async ({ client, params }) => {
        if (++running === 2) ready.resolve()
        await ready.promise
        await client.notify(methods.client.session.update, {
          sessionId: params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: 'same',
            content: { type: 'text', text: params.sessionId }
          }
        })
        return { stopReason: 'end_turn' }
      }
    })
    const a = confirmed(await runtime.create(configuration))
    const b = confirmed(await runtime.create(configuration))
    await Promise.all([a.input!.submit(input()), b.input!.submit(input())])
    await Promise.all([finished(a, 'hello'), finished(b, 'hello')])
    const left = (await collect(a)).events[0] as ThreadSnapshot
    const right = (await collect(b)).events[0] as ThreadSnapshot
    expect(left.messages[0].id).not.toBe(right.messages[0].id)
    expect(left.messages[0].parts).toMatchObject([{ text: a.thread.id }])
    expect(right.messages[0].parts).toMatchObject([{ text: b.thread.id }])
  })
  it.each([undefined, {}, { embeddedContext: false }])(
    'accepts baseline resource links with prompt capabilities %j while rejecting embedded resources',
    async (promptCapabilities) => {
      const { runtime } = setup({
        initialize: () => ({ protocolVersion: 1, agentCapabilities: { promptCapabilities }, authMethods: [] }),
        'session/prompt': async ({ client, params }) => {
          await client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: { sessionUpdate: 'user_message_chunk', content: params.prompt[0] }
          })
          return { stopReason: 'end_turn' }
        }
      })
      const handle = confirmed(await runtime.create(configuration))
      expect(
        await handle.acp.submit({
          ...input('embedded'),
          content: [{ type: 'resource', resource: { uri: 'file:///context', text: 'embedded context' } }]
        })
      ).toMatchObject({ status: 'unsupported', error: { code: 'unsupported-prompt-content' } })
      const reference = { type: 'resource_link' as const, uri: 'file:///context', name: 'Context' }
      expect(await handle.acp.submit({ ...input('reference'), content: [reference] })).toMatchObject({
        status: 'acknowledged'
      })
      await finished(handle, 'reference')
      expect(handle.acp.state().messages).toMatchObject([{ chunks: [{ content: reference }] }])
    }
  )

  it('acknowledges only dispatch and prevents concurrent, duplicate and unsupported inputs', async () => {
    const end = deferred<void>()
    let prompts = 0
    const { runtime } = setup({
      'session/prompt': async () => {
        prompts++
        await end.promise
        return { stopReason: 'end_turn' }
      }
    })
    const handle = confirmed(await runtime.create(configuration))
    expect(await handle.input!.submit({ ...input(), whenBusy: 'follow-up' })).toMatchObject({ status: 'unsupported' })
    const [first, second] = await Promise.all([handle.input!.submit(input()), handle.input!.submit(input('busy'))])
    expect(first).toEqual({ status: 'acknowledged', inputId: 'hello', facts: ['dispatch-started'] })
    expect(second).toMatchObject({ status: 'rejected', error: { code: 'busy' } })
    expect(await handle.input!.submit(input())).toMatchObject({
      status: 'rejected',
      error: { code: 'duplicate-input' }
    })
    end.resolve()
    await finished(handle, 'hello')
    expect(prompts).toBe(1)
    expect(await handle.input!.submit(input())).toMatchObject({ status: 'rejected' })
  })

  it.each([
    ['end_turn', 'completed'],
    ['cancelled', 'aborted'],
    ['max_tokens', 'unanswered'],
    ['max_turn_requests', 'unanswered'],
    ['refusal', 'unanswered']
  ] as const)('preserves native %s as %s', async (stopReason, outcome) => {
    const { runtime } = setup({ 'session/prompt': () => ({ stopReason, _meta: { evidence: true } }) })
    const handle = confirmed(await runtime.create(configuration))
    await handle.input!.submit(input())
    await finished(handle, 'hello')
    const { events } = await collect(handle)
    expect(events[0]).toMatchObject({ inputs: [{ outcome, facts: ['dispatch-started'] }] })
    expect(handle.acp.state().turns).toEqual([
      { inputId: 'hello', response: { stopReason, _meta: { evidence: true } } }
    ])
  })

  it.each([{ stopReason: 'unknown' }, { stopReason: 'toString' }, { stopReason: ['end_turn'] }, {}])(
    'keeps the outcome unknown and closes admission after an invalid prompt response %j',
    async (response) => {
      const { runtime } = setup({ 'session/prompt': () => JSON.parse(JSON.stringify(response)) })
      const handle = confirmed(await runtime.create(configuration))
      const { events } = await collect(handle)
      expect(await handle.input!.submit(input())).toMatchObject({ status: 'acknowledged' })
      await expect.poll(() => events.some((event) => event.type === 'gap')).toBe(true)
      const snapshot = (await collect(handle)).events[0]
      expect(snapshot).toMatchObject({
        inputs: [{ inputId: 'hello', facts: ['dispatch-started'], error: { code: 'projection-failed' } }],
        activity: { state: 'unknown' }
      })
      if (snapshot.type !== 'snapshot') throw new Error('Expected snapshot')
      expect(snapshot.inputs[0].outcome).toBeUndefined()
      expect(handle.acp.state().turns).toEqual([])
      expect(await handle.input!.submit(input('next'))).toMatchObject({ status: 'rejected' })
    }
  )

  it('reports a remote request error without retrying or promising no tool effects', async () => {
    let prompts = 0
    const { runtime } = setup({
      'session/prompt': () => {
        prompts++
        throw new RequestError(-32603, 'Tool already ran')
      }
    })
    const handle = confirmed(await runtime.create(configuration))
    await handle.input!.submit(input())
    await finished(handle, 'hello')
    expect((await collect(handle)).events[0]).toMatchObject({
      inputs: [{ outcome: 'failed', error: { message: 'Tool already ran' } }]
    })
    expect(prompts).toBe(1)
  })

  it('cancels a pending permission, retains trailing output, and ignores stale approval', async () => {
    const offered = deferred<void>()
    const selection = deferred<RequestPermissionResponse>()
    const answers: RequestPermissionResponse[] = []
    let signal: AbortSignal | undefined
    const f = setup(
      {
        'session/prompt': async ({ client, params }) => {
          answers.push(
            await client.request(methods.client.session.requestPermission, {
              sessionId: params.sessionId,
              toolCall: { toolCallId: 'tool', title: 'Run' },
              options: [{ optionId: 'once', name: 'Once', kind: 'allow_once' }]
            })
          )
          await f.cancelled.promise
          await client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'tail' } }
          })
          return { stopReason: 'cancelled' }
        }
      },
      {
        callbacks: {
          permission: async (_, context) => {
            signal = context.signal
            offered.resolve()
            return selection.promise
          }
        }
      }
    )
    const handle = confirmed(await f.runtime.create(configuration))
    await handle.input!.submit(input())
    await offered.promise
    expect(await handle.interrupt!()).toMatchObject({ status: 'confirmed' })
    expect(signal?.aborted).toBe(true)
    selection.resolve({ outcome: { outcome: 'selected', optionId: 'once' } })
    expect(answers).toEqual([{ outcome: { outcome: 'cancelled' } }])
    expect((await collect(handle)).events[0]).toMatchObject({
      messages: [{ parts: [{ type: 'text', text: 'tail' }] }],
      inputs: [{ outcome: 'aborted' }]
    })
  })

  it.each([undefined, 'invented', 'once'])('authorizes only an offered option (%s)', async (optionId) => {
    const answer = deferred<RequestPermissionResponse>()
    const { runtime } = setup(
      {
        'session/prompt': async ({ client, params }) => {
          answer.resolve(
            await client.request(methods.client.session.requestPermission, {
              sessionId: params.sessionId,
              toolCall: { toolCallId: 'tool', title: 'Run' },
              options: [{ optionId: 'once', name: 'Once', kind: 'allow_once' }]
            })
          )
          return { stopReason: 'end_turn' }
        }
      },
      { callbacks: optionId ? { permission: async () => ({ outcome: { outcome: 'selected', optionId } }) } : {} }
    )
    const handle = confirmed(await runtime.create(configuration))
    await handle.input!.submit(input())
    expect(await answer.promise).toEqual(
      optionId === 'once' ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } }
    )
    await finished(handle, 'hello')
  })

  it('preserves genuine completion racing cancellation', async () => {
    const f = setup({
      'session/prompt': async () => {
        await f.cancelled.promise
        return { stopReason: 'end_turn' }
      }
    })
    const handle = confirmed(await f.runtime.create(configuration))
    await handle.input!.submit(input())
    expect(await handle.interrupt!()).toMatchObject({ status: 'confirmed' })
    expect((await collect(handle)).events[0]).toMatchObject({ inputs: [{ outcome: 'completed' }] })
  })

  it('keeps execution unknown after disconnect and does not retry', async () => {
    const seen = deferred<void>()
    const f = setup({
      'session/prompt': async ({ signal }) => {
        seen.resolve()
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }))
        return { stopReason: 'cancelled' }
      }
    })
    const handle = confirmed(await f.runtime.create(configuration))
    const { events } = await collect(handle)
    await handle.input!.submit(input())
    await seen.promise
    f.disconnect()
    await expect.poll(() => events.some((event) => event.type === 'gap' && event.reason === 'disconnected')).toBe(true)
    const baseline = (await collect(handle)).events[0] as ThreadSnapshot
    expect(baseline.inputs[0]).not.toHaveProperty('outcome')
    expect(await handle.interrupt!()).toMatchObject({ status: 'unknown' })
    expect(await handle.input!.submit(input('next'))).toMatchObject({ status: 'rejected' })
  })
})

describe('projection and observation', () => {
  it('preserves text/file/text part order within one native message', async () => {
    const { runtime } = setup({
      'session/prompt': async ({ client, params }) => {
        for (const content of [
          { type: 'text', text: 'before' },
          { type: 'image', data: 'AA==', mimeType: 'image/png' },
          { type: 'text', text: 'after' }
        ] as const) {
          await client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: { sessionUpdate: 'agent_message_chunk', messageId: 'mixed', content }
          })
        }
        return { stopReason: 'end_turn' }
      }
    })
    const handle = confirmed(await runtime.create(configuration))
    await handle.input!.submit(input())
    await finished(handle, 'hello')
    expect((await collect(handle)).events[0]).toMatchObject({
      messages: [
        {
          parts: [
            { type: 'text', text: 'before', state: 'done' },
            { type: 'file', mediaType: 'image/png' },
            { type: 'text', text: 'after', state: 'done' }
          ]
        }
      ]
    })
  })

  it('preserves partial tool fields, native resources and metadata independently of display support', async () => {
    const { runtime } = setup({
      'session/prompt': async ({ client, params }) => {
        const emit = (update: SessionUpdate) =>
          client.notify(methods.client.session.update, { sessionId: params.sessionId, update })
        await emit({
          sessionUpdate: 'agent_thought_chunk',
          messageId: 'same',
          content: { type: 'text', text: 'think' }
        })
        await emit({
          sessionUpdate: 'agent_message_chunk',
          messageId: 'same',
          content: { type: 'text', text: 'answer' }
        })
        await emit({
          sessionUpdate: 'tool_call',
          toolCallId: 't',
          title: 'Read',
          rawInput: { path: '/a' },
          content: [{ type: 'diff', path: '/a', oldText: '', newText: 'new' }]
        })
        await emit({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', rawOutput: 'done' })
        await emit({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'resource_link', uri: 'file:///private', name: 'reference' },
          _meta: { untouched: true }
        })
        await emit({
          sessionUpdate: 'available_commands_update',
          availableCommands: [{ name: 'compact', description: 'Compact' }]
        })
        return { stopReason: 'end_turn' }
      }
    })
    const handle = confirmed(await runtime.create(configuration))
    const frames: AcpObservationFrame[] = []
    const observer = confirmed(
      await handle.acp.observe((frame) => {
        frames.push(frame)
      })
    )
    await handle.input!.submit(input())
    await finished(handle, 'hello')
    await observer.drain()
    const state = handle.acp.state()
    expect(new Set(state.messages.map((message) => message.id)).size).toBe(3)
    expect(state.tools).toMatchObject([
      {
        toolCallId: 't',
        title: 'Read',
        rawInput: { path: '/a' },
        content: [{ type: 'diff', newText: 'new' }],
        rawOutput: 'done',
        status: 'completed'
      }
    ])
    expect(frames.filter((frame) => frame.update).map((frame) => frame.update?.sessionUpdate)).toEqual([
      'agent_thought_chunk',
      'agent_message_chunk',
      'tool_call',
      'tool_call_update',
      'agent_message_chunk',
      'available_commands_update'
    ])
    expect(state.messages.at(-1)?.chunks[0]).toMatchObject({
      content: { uri: 'file:///private' },
      _meta: { untouched: true }
    })
    const baseline = (await collect(handle)).events[0] as ThreadSnapshot
    expect(baseline.messages[0].parts).toMatchObject([{ type: 'reasoning', text: 'think' }])
    expect(baseline.messages[2].parts).toMatchObject([
      { type: 'dynamic-tool', state: 'output-available', input: { path: '/a' }, output: 'done' }
    ])
  })

  it('isolates slow observers and handle release from other accesses and execution', async () => {
    const release = deferred<void>()
    const end = deferred<void>()
    const f = setup({
      'session/prompt': async ({ client, params }) => {
        for (let i = 0; i < 120; i++)
          await client.notify(methods.client.session.update, {
            sessionId: params.sessionId,
            update: { sessionUpdate: 'agent_message_chunk', messageId: 'm', content: { type: 'text', text: '.' } }
          })
        end.resolve()
        return { stopReason: 'end_turn' }
      }
    })
    const a = confirmed(await f.runtime.create(configuration))
    const b = confirmed(await f.runtime.open(a.thread))
    const slow: ObservationPayload[] = []
    const observer = confirmed(
      await b.observe(async (event) => {
        slow.push(event)
        if (slow.length === 1) await release.promise
      })
    )
    await a.input!.submit(input())
    await a.release()
    await end.promise
    await finished(b, 'hello')
    release.resolve()
    await observer.drain()
    expect(slow.some((event) => event.type === 'gap' && event.reason === 'overflow')).toBe(true)
    const baseline = (await collect(b)).events[0] as ThreadSnapshot
    expect(baseline.messages[0].parts).toMatchObject([{ text: '.'.repeat(120) }])
    expect(await a.input!.submit(input('after-release'))).toMatchObject({ status: 'rejected' })
  })

  it.each(['response', 'notification'] as const)(
    'invalidates context measurements on model changes via %s until fresh usage arrives',
    async (source) => {
      const modelOptions = (currentValue: string): SessionConfigOption[] => [
        {
          id: 'model',
          name: 'Model',
          type: 'select',
          category: 'model',
          currentValue,
          options: [
            { value: 'small', name: 'Small' },
            { value: 'large', name: 'Large' }
          ]
        }
      ]
      const { runtime, peer } = setup({
        'session/new': () => ({ sessionId: 'context', configOptions: modelOptions('small') }),
        'session/set_config_option': ({ params }) => {
          if (typeof params.value !== 'string') throw new Error('Expected model ID')
          return { configOptions: modelOptions(params.value) }
        }
      })
      const handle = confirmed(await runtime.create(configuration))
      const { events, observer } = await collect(handle)
      const changeModel = async (model: string) => {
        if (source === 'response') confirmed(await handle.acp.setConfigOption('model', model))
        else {
          await peer.client.notify(methods.client.session.update, {
            sessionId: handle.thread.id,
            update: { sessionUpdate: 'config_option_update', configOptions: modelOptions(model) }
          })
          await expect
            .poll(() => handle.acp.state().metadata)
            .toContainEqual({
              sessionUpdate: 'config_option_update',
              configOptions: modelOptions(model)
            })
        }
        await observer.drain()
      }
      const usage = { sessionUpdate: 'usage_update' as const, used: 80, size: 100 }
      await peer.client.notify(methods.client.session.update, { sessionId: handle.thread.id, update: usage })
      await expect.poll(async () => (await handle.contextUsage()).status).toBe('confirmed')
      await changeModel('small')
      expect(await handle.contextUsage()).toMatchObject({
        status: 'confirmed',
        value: { model: 'small', contextWindow: 100, used: { tokens: 80 } }
      })

      await changeModel('large')
      expect(await handle.contextUsage()).toMatchObject({ status: 'unknown' })
      expect(events.at(-1)).toMatchObject({ type: 'snapshot', contextUsage: { status: 'unknown' } })
      expect(handle.acp.state().metadata).toContainEqual(usage)
      await changeModel('small')
      expect(await handle.contextUsage()).toMatchObject({ status: 'unknown' })

      await changeModel('large')
      await peer.client.notify(methods.client.session.update, {
        sessionId: handle.thread.id,
        update: { sessionUpdate: 'usage_update', used: 120, size: 2000 }
      })
      await expect.poll(async () => (await handle.contextUsage()).status).toBe('confirmed')
      await observer.drain()
      expect(events.at(-1)).toMatchObject({
        type: 'snapshot',
        contextUsage: {
          status: 'confirmed',
          value: { model: 'large', contextWindow: 2000, used: { tokens: 120 } }
        }
      })
    }
  )

  it('reads context passively only with native model and capacity evidence', async () => {
    let prompts = 0
    const { runtime, peer } = setup({
      'session/new': () => ({
        sessionId: 'context',
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            type: 'select',
            category: 'model',
            currentValue: 'native-model',
            options: [{ value: 'native-model', name: 'Model' }]
          }
        ]
      }),
      'session/prompt': () => {
        prompts++
        return { stopReason: 'end_turn' }
      }
    })
    const handle = confirmed(await runtime.create(configuration))
    expect(await handle.contextUsage()).toMatchObject({ status: 'unknown' })
    const emptyUsage = { sessionUpdate: 'usage_update' as const, used: 0, size: 0 }
    await peer.client.notify(methods.client.session.update, { sessionId: handle.thread.id, update: emptyUsage })
    await expect.poll(() => handle.acp.state().metadata).toContainEqual(emptyUsage)
    expect(await handle.contextUsage()).toMatchObject({ status: 'unknown' })
    await peer.client.notify(methods.client.session.update, {
      sessionId: handle.thread.id,
      update: { sessionUpdate: 'usage_update', used: 100, size: 1000, cost: { amount: 123, currency: 'USD' } }
    })
    await expect.poll(async () => (await handle.contextUsage()).status).toBe('confirmed')
    expect(await handle.contextUsage()).toMatchObject({
      value: { model: 'native-model', contextWindow: 1000, used: { tokens: 100 }, basis: 'current-context' }
    })
    expect(handle.acp.state().metadata).toMatchObject([{ cost: { amount: 123 } }])
    expect(prompts).toBe(0)
    expect(handle).not.toHaveProperty('subagents')
    expect(await handle.acp.setMode('unsupported')).toMatchObject({ status: 'unsupported' })
  })
})
