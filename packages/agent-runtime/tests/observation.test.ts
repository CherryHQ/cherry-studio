import { setImmediate as nextTurn } from 'node:timers/promises'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

import { runtimeId, ThreadFeed, type RuntimeMessage, type ObservationPayload, type ThreadSnapshot } from '../src'

const ref = { backendId: runtimeId<'backend'>('backend'), id: runtimeId<'thread'>('session') }
const item = (id: string, text = id): RuntimeMessage => ({
  id,
  role: 'assistant',
  parts: [{ type: 'text', text }],
  metadata: { completeness: 'partial' }
})
const snapshot = (): ThreadSnapshot => ({
  type: 'snapshot',
  messages: [],
  inputs: [],
  activity: { state: 'idle' }
})
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

setFlagsFromString('--expose_gc')
const collectGarbage = runInNewContext('gc') as () => void
async function retainedHeap(): Promise<number> {
  await nextTurn()
  collectGarbage()
  await nextTurn()
  collectGarbage()
  return process.memoryUsage().heapUsed
}

it('shares immutable image strings across isolated observer containers', async () => {
  const url = JSON.parse(JSON.stringify(`data:image/png;base64,${'A'.repeat(4 * 1024 * 1024)}`)) as string
  const before = await retainedHeap()
  const feed = new ThreadFeed(
    {
      ...snapshot(),
      messages: [
        {
          id: 'image',
          role: 'user',
          parts: [{ type: 'file', mediaType: 'image/png', url }],
          metadata: { completeness: 'complete' }
        }
      ]
    },
    () => {}
  )
  const received: ObservationPayload[] = []
  const observers = Array.from({ length: 12 }, () =>
    feed.observe((event) => {
      received.push(event)
    })
  )
  await Promise.all(observers.map((observer) => observer.drain()))
  const retained = (await retainedHeap()) - before

  expect(received).toHaveLength(12)
  expect(
    received.every(
      (event) =>
        event.type === 'snapshot' &&
        event.messages[0].parts[0].type === 'file' &&
        event.messages[0].parts[0].url === url
    )
  ).toBe(true)
  expect(retained).toBeLessThan(16 * 1024 * 1024)
  const [first] = received as ThreadSnapshot[]
  expect(received.every((event) => event === first)).toBe(true)
  expect(Object.isFrozen(first.messages[0].parts[0])).toBe(true)
  observers.forEach((observer) => observer.stop())
})

describe('normalized observation delivery', () => {
  it('reads state and individual message bindings without exposing the stored message graph', () => {
    const feed = new ThreadFeed(snapshot(), () => {})
    const message = item('answer')
    message.metadata = { completeness: 'complete', inputId: runtimeId('input') }
    feed.publish({ type: 'message.upsert', message })
    expect(feed.messageInputId('answer')).toBe('input')
    expect(feed.messageInputId('missing')).toBeUndefined()
    const state = feed.state
    expect(state).not.toHaveProperty('messages')
    expect(() => Object.assign(state.activity, { state: 'active' })).toThrow(TypeError)
    const captured = feed.message('answer')!
    expect(() => {
      captured.parts.length = 0
    }).toThrow(TypeError)
    message.parts[0] = { type: 'text', text: 'publisher edit' }
    const ids = feed.messageIds
    ids.length = 0
    expect(feed.snapshot.activity.state).toBe('idle')
    expect(feed.snapshot.messages[0].parts).toEqual([{ type: 'text', text: 'answer' }])
    expect(feed.messageIds).toEqual(['answer'])
  })

  it('closes an unrecoverable control backlog without delivering a fabricated completion', async () => {
    const failures: unknown[] = []
    const feed = new ThreadFeed(snapshot(), (error) => failures.push(error))
    let gateResolve!: () => void
    const gate = new Promise<void>((resolve) => {
      gateResolve = resolve
    })
    const events: ObservationPayload[] = []
    const observation = feed.observeCaptured<ObservationPayload>(
      async (event) => {
        events.push(event)
        if (events.length === 1) await gate
      },
      (event) => ({ value: event, retain: event.type === 'input.changed' })
    )
    await tick()
    for (let index = 0; index < 1001; index++)
      feed.publish({
        type: 'input.changed',
        input: { inputId: runtimeId(String(index)), facts: ['accepted'], outcome: 'completed' }
      })
    expect(events).toHaveLength(1)
    gateResolve()
    await observation.drain()
    expect(events.slice(1)).toEqual([
      { type: 'gap', reason: 'overflow' },
      { type: 'closed', reason: 'source-lost' }
    ])
    expect(failures).toEqual([
      expect.objectContaining({ message: 'Observation exceeded recoverable delivery backlog' })
    ])
  })

  it('captures metadata at publication and retains ordered terminal frames through repeated overflow', async () => {
    const failures: unknown[] = []
    const feed = new ThreadFeed(snapshot(), (error) => failures.push(error))
    let blockedResolve!: () => void
    const blocked = new Promise<void>((resolve) => {
      blockedResolve = resolve
    })
    const native = { revision: 0 }
    let terminal = false
    const received: { event: ObservationPayload; native: typeof native; terminal: boolean }[] = []
    const observed = feed.observeCaptured<(typeof received)[number]>(
      async (batch) => {
        received.push(batch)
        if (received.length === 1) await blocked
      },
      (event, delivery) => ({
        value: { event, native, terminal: delivery !== 'baseline' && terminal },
        retain: terminal
      })
    )
    await tick()
    for (let turn = 1; turn <= 2; turn++) {
      for (let index = 0; index < 120; index++) {
        native.revision++
        feed.publish({ type: 'message.upsert', message: item(`turn-${turn}`, `body-${native.revision}`) })
      }
      terminal = true
      feed.publish({ type: 'activity.changed', activity: { state: 'idle' } })
      terminal = false
    }
    for (let index = 0; index < 120; index++) feed.publish({ type: 'activity.changed', activity: { state: 'idle' } })
    native.revision = 999
    blockedResolve()
    await observed.drain()
    const endings = received.filter((batch) => batch.terminal)
    expect(received[0].native.revision).toBe(0)
    expect(endings.map((batch) => batch.native.revision)).toEqual([120, 240])
    expect(endings[0].event).toMatchObject({
      type: 'snapshot',
      messages: [{ id: 'turn-1', parts: [{ text: 'body-120' }] }]
    })
    expect(endings[1].event).toMatchObject({
      type: 'snapshot',
      messages: [{ id: 'turn-1' }, { id: 'turn-2', parts: [{ text: 'body-240' }] }]
    })
    expect(failures).toEqual([])
  })

  it('delivers final content before closure, including recovery for a stalled observer', async () => {
    const feed = new ThreadFeed(snapshot(), () => {})
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const events: ObservationPayload[] = []
    const observation = feed.observe(async (event) => {
      events.push(event)
      if (events.length === 1) await held
    })
    await tick()
    for (let index = 0; index < 110; index++)
      feed.publish({ type: 'message.upsert', message: item('final', String(index)) })
    feed.close('shutdown')
    let drained = false
    const barrier = observation.drain().then(() => {
      drained = true
    })
    expect(events).toHaveLength(1)
    await tick()
    expect(drained).toBe(false)
    release()
    await barrier
    expect(events.at(-1)).toEqual({ type: 'closed', reason: 'shutdown' })
    expect(events.at(-2)).toMatchObject({ type: 'message.upsert', message: { parts: [{ text: '109' }] } })
    expect(events.some((event) => event.type === 'gap')).toBe(true)
    expect(() => feed.observe(() => {})).toThrow('closed')
  })

  it('retains child relationships without requiring a context and updates reused children by identity', async () => {
    const feed = new ThreadFeed(snapshot(), () => {})
    const subagent = { id: runtimeId<'subagent'>('child-work'), parent: ref }
    feed.publish({ type: 'subagent.upsert', subagent })
    expect(feed.snapshot.subagents).toEqual([subagent])
    const child = { ...ref, id: runtimeId<'thread'>('child-context') }
    feed.publish({ type: 'subagent.upsert', subagent: { ...subagent, child } })
    feed.publish({ type: 'activity.changed', activity: { state: 'idle' } })
    feed.publish({ type: 'subagent.upsert', subagent: { ...subagent, child } })
    const events: ObservationPayload[] = []
    feed.observe((event) => {
      events.push(event)
    })
    await tick()
    expect(events[0]).toMatchObject({ subagents: [{ ...subagent, child }] })
    expect(feed.snapshot.subagents).toHaveLength(1)
  })

  it('isolates a stalled sink and recovers overflow with a current snapshot', async () => {
    const feed = new ThreadFeed(snapshot(), () => {})
    let unblock!: () => void
    const held = new Promise<void>((resolve) => {
      unblock = resolve
    })
    const slow: ObservationPayload[] = []
    const fast: string[] = []
    feed.observe(async (event) => {
      slow.push(event)
      if (slow.length === 1) await held
    })
    feed.observe((event) => {
      if (event.type !== 'message.upsert') return
      const part = event.message.parts[0]
      if (part.type !== 'text') return
      fast.push(part.text)
    })
    for (let i = 0; i < 110; i++) {
      feed.publish({ type: 'message.upsert', message: item('answer', String(i)) })
      await tick()
    }
    expect(fast.at(-1)).toBe('109')
    expect(slow).toHaveLength(1)
    unblock()
    await tick()
    expect(slow[0].type).toBe('snapshot')
    expect(slow[1]).toEqual({ type: 'gap', reason: 'overflow' })
    expect(slow[2]).toMatchObject({ type: 'snapshot', messages: [{ parts: [{ text: '100' }] }] })
    expect(slow.at(-1)).toMatchObject({ message: { parts: [{ text: '109' }] } })
    expect(feed.snapshot.messages[0].parts).toEqual([{ type: 'text', text: '109' }])
  })

  it('stops future calls without waiting for an entered consumer, and isolates consumer failures', async () => {
    const failures: unknown[] = []
    const feed = new ThreadFeed(snapshot(), (error) => {
      failures.push(error)
    })
    let unblock!: () => void
    let count = 0
    const subscription = feed.observe(async () => {
      count++
      await new Promise<void>((resolve) => {
        unblock = resolve
      })
    })
    await tick()
    feed.publish({ type: 'message.upsert', message: item('queued') })
    const discarded = expect(subscription.drain()).rejects.toThrow('stopped before delivery drained')
    await subscription.stop()
    await discarded
    unblock()
    await tick()
    expect(count).toBe(1)
    feed.observe(() => {
      throw new Error('consumer failed')
    })
    await tick()
    feed.publish({ type: 'message.upsert', message: item('survives') })
    expect(failures).toHaveLength(1)
    expect(feed.snapshot.messages.at(-1)?.id).toBe('survives')
  })

  it('never enters a consumer on the publishing stack and preserves order with reentrant publication', async () => {
    const feed = new ThreadFeed(snapshot(), () => {})
    const events: ObservationPayload[] = []
    feed.observe((event) => {
      if (event.type === 'message.upsert' && event.message.id === 'first')
        feed.publish({ type: 'message.upsert', message: item('second') })
    })
    feed.observe((event) => {
      events.push(event)
    })
    await tick()
    feed.publish({ type: 'message.upsert', message: item('first') })
    expect(events).toHaveLength(1)
    await tick()
    expect(events.flatMap((event) => (event.type === 'message.upsert' ? [event.message.id] : []))).toEqual([
      'first',
      'second'
    ])
  })

  it('still delivers a snapshot first when the initial delivery overflows before it starts', async () => {
    const feed = new ThreadFeed(snapshot(), () => {})
    const events: ObservationPayload[] = []
    feed.observe((event) => {
      events.push(event)
    })
    for (let i = 0; i < 110; i++) feed.publish({ type: 'message.upsert', message: item('answer', String(i)) })
    await tick()
    expect(events[0].type).toBe('snapshot')
    expect(events[1]).toEqual({ type: 'gap', reason: 'overflow' })
    expect(events.at(-1)).toMatchObject({ message: { parts: [{ text: '109' }] } })
  })

  it('keeps replacement order and prevents consumers mutating shared facts', async () => {
    const initial = snapshot()
    const feed = new ThreadFeed(initial, () => {})
    feed.publish({ type: 'message.upsert', message: item('live') })
    feed.publish({ type: 'message.upsert', message: item('next') })
    feed.publish({
      type: 'message.upsert',
      message: item('persisted'),
      replaces: [{ session: ref, id: runtimeId('live') }]
    })
    feed.observe((event) => {
      if (event.type === 'snapshot') event.messages[0].parts.length = 0
    })
    const observed: ObservationPayload[] = []
    feed.observe((event) => {
      observed.push(event)
    })
    await tick()
    expect(feed.snapshot.messages.map((value) => value.id)).toEqual(['persisted', 'next'])
    expect(observed[0]).toMatchObject({
      messages: [{ id: 'persisted', parts: [{ text: 'persisted' }] }, { id: 'next' }]
    })
    expect(initial.messages).toEqual([])
  })

  it('isolates published updates from publisher, observer and snapshot mutations', async () => {
    const failures: unknown[] = []
    const feed = new ThreadFeed(snapshot(), (error) => failures.push(error))
    const source = item('answer', 'published')
    const mutating = feed.observe((event) => {
      if (event.type === 'message.upsert') event.message.parts[0] = { type: 'text', text: 'observer edit' }
    })
    const received: ObservationPayload[] = []
    const observing = feed.observe((event) => {
      received.push(event)
    })
    await Promise.all([mutating.drain(), observing.drain()])

    feed.publish({ type: 'message.upsert', message: source })
    source.parts[0] = { type: 'text', text: 'publisher edit' }
    await observing.drain()
    await expect(mutating.drain()).rejects.toThrow('stopped before delivery drained')
    expect(failures).toEqual([expect.any(TypeError)])

    const expected = [{ type: 'text', text: 'published' }]
    expect(received[1]).toMatchObject({ type: 'message.upsert', message: { parts: expected } })
    expect(feed.snapshot.messages[0].parts).toEqual(expected)
    const exposed = feed.snapshot
    expect(() => {
      exposed.messages[0].parts[0] = { type: 'text', text: 'snapshot edit' }
    }).toThrow(TypeError)
    expect(feed.snapshot.messages[0].parts).toEqual(expected)
  })
})

it('deduplicates unchanged context readings and includes the latest value for a new observer', async () => {
  const feed = new ThreadFeed(snapshot(), () => {})
  const events: ObservationPayload[] = []
  feed.observe((event) => {
    events.push(event)
  })
  const result = {
    status: 'confirmed' as const,
    value: {
      model: 'model',
      revision: 'native-revision',
      contextWindow: 1000,
      used: { tokens: 100, precision: 'estimated' as const },
      basis: 'current-context' as const
    }
  }
  for (let i = 0; i < 120; i++) feed.publish({ type: 'context.changed', result })
  await tick()
  expect(events.map((event) => event.type)).toEqual(['snapshot', 'context.changed'])
  expect(feed.snapshot.contextUsage).toEqual(result)
  const invalid = {
    status: 'unknown' as const,
    error: { operation: 'contextUsage', code: 'compacted', message: 'Unknown after compaction' }
  }
  feed.publish({ type: 'context.changed', result: invalid })
  expect(feed.snapshot.contextUsage).toEqual(invalid)
})

it('keeps a slow observer open when pending terminal frames share one large history', async () => {
  const failures: unknown[] = []
  const feed = new ThreadFeed(snapshot(), (error) => failures.push(error))
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const received: ObservationPayload[] = []
  const observation = feed.observeCaptured<ObservationPayload>(
    async (event) => {
      received.push(event)
      if (received.length === 1) await held
    },
    (event) => ({ value: event, retain: event.type === 'snapshot' && event.messages.length > 0 })
  )
  await tick()
  const url = `data:image/png;base64,${'A'.repeat(9 * 1024 * 1024)}`
  const image: RuntimeMessage = { ...item('image'), parts: [{ type: 'file', mediaType: 'image/png', url }] }
  for (let i = 0; i < 2; i++) feed.publish({ ...snapshot(), messages: [image, item('answer', String(i))] })
  release()
  await observation.drain()
  expect(received.map((event) => event.type)).toEqual(['snapshot', 'snapshot', 'snapshot'])
  expect(received.at(-1)).toMatchObject({ messages: [{ id: 'image' }, { parts: [{ text: '1' }] }] })
  expect(failures).toEqual([])
  await observation.stop()
})

it('retains one copy of republished history across a stalled observer backlog', async () => {
  const history = Array.from(
    { length: 2000 },
    (_, index): RuntimeMessage => ({
      id: `tool-${index}`,
      role: 'assistant',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: `call-${index}`,
          toolName: 'read',
          state: 'output-available',
          input: { path: `file-${index}` },
          output: { content: [{ type: 'text', text: 'contents' }] }
        }
      ],
      metadata: { completeness: 'complete' }
    })
  )
  const feed = new ThreadFeed({ ...snapshot(), messages: history }, () => {})
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const received: ThreadSnapshot[] = []
  const observation = feed.observe(async (event) => {
    if (event.type === 'snapshot') received.push(event)
    if (received.length === 1) await held
  })
  await tick()
  const before = await retainedHeap()
  for (let i = 0; i < 90; i++)
    feed.publish({ ...feed.snapshot, messages: [...feed.snapshot.messages.slice(0, 2000), item('live', String(i))] })
  const retained = (await retainedHeap()) - before
  release()
  await observation.drain()
  expect(retained).toBeLessThan(16 * 1024 * 1024)
  expect(received).toHaveLength(91)
  expect(received.at(-1)?.messages[0]).toBe(received[0].messages[0])
  expect(received.at(-1)?.messages.at(-1)).toMatchObject({ parts: [{ text: '89' }] })
  await observation.stop()
})

it('keeps the initial baseline first when a backlog closes an unstarted observer', async () => {
  const feed = new ThreadFeed(snapshot(), () => {})
  const received: ObservationPayload[] = []
  const observation = feed.observeCaptured<ObservationPayload>(
    (event) => {
      received.push(event)
    },
    (event) => ({ value: event, retain: event.type === 'input.changed' })
  )
  for (let index = 0; index < 1001; index++)
    feed.publish({
      type: 'input.changed',
      input: { inputId: runtimeId(String(index)), facts: ['accepted'], outcome: 'completed' }
    })
  await observation.drain()
  expect(received.map((event) => event.type)).toEqual(['snapshot', 'gap', 'closed'])
  expect(received.at(-1)).toEqual({ type: 'closed', reason: 'source-lost' })
})

it('exposes isolated state without carrying historical message bodies', () => {
  const inputId = runtimeId<'input'>('input')
  const feed = new ThreadFeed(
    { ...snapshot(), messages: [item('large', 'A'.repeat(1024 * 1024))], inputs: [{ inputId, facts: ['accepted'] }] },
    () => {}
  )
  const state = feed.state
  expect(state).not.toHaveProperty('messages')
  expect(() => (state.inputs[0].facts as string[]).push('placed')).toThrow(TypeError)
  expect(feed.state.inputs[0].facts).toEqual(['accepted'])
  expect(feed.snapshot.messages[0].parts).toEqual([{ type: 'text', text: 'A'.repeat(1024 * 1024) }])
})

it('delivers an oversized latest snapshot without truncating its body', async () => {
  const failures: unknown[] = []
  const feed = new ThreadFeed(snapshot(), (error) => failures.push(error))
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const received: ObservationPayload[] = []
  const observation = feed.observe(async (event) => {
    received.push(event)
    if (received.length === 1) await held
  })
  await tick()
  const body = 'A'.repeat(9 * 1024 * 1024)
  for (let i = 0; i < 2; i++) feed.publish({ ...snapshot(), messages: [item('answer', `${i}:${body}`)] })
  release()
  await observation.drain()
  expect(received.at(-1)).toMatchObject({ type: 'snapshot', messages: [{ parts: [{ text: `1:${body}` }] }] })
  expect(failures).toEqual([])
  await observation.stop()
})
