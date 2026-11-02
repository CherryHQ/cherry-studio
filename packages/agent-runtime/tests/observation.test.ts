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
  coverage: 'current-view',
  messages: [],
  inputs: [],
  activity: { scope: 'foreground', state: 'idle' }
})
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('normalized observation delivery', () => {
  it('delivers final content before closure, including recovery for a stalled observer', async () => {
    const feed = new ThreadFeed(snapshot(), () => {})
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const events: ObservationPayload[] = []
    feed.observe(async (event) => {
      events.push(event)
      if (events.length === 1) await held
    })
    await tick()
    for (let index = 0; index < 110; index++)
      feed.publish({ type: 'message.upsert', message: item('final', String(index)) })
    feed.close('shutdown')
    expect(events).toHaveLength(1)
    release()
    await tick()
    expect(events.at(-1)).toEqual({ type: 'closed', reason: 'shutdown' })
    expect(events.at(-2)).toMatchObject({ type: 'message.upsert', message: { parts: [{ text: '109' }] } })
    expect(events.some((event) => event.type === 'gap')).toBe(true)
    expect(() => feed.observe(() => {})).toThrow('closed')
  })

  it('isolates a stalled sink and recovers overflow with a current snapshot', async () => {
    const feed = new ThreadFeed(snapshot(), () => {})
    let unblock!: () => void
    const held = new Promise<void>((resolve) => {
      unblock = resolve
    })
    const slow: ObservationPayload[] = []
    const fast: ObservationPayload[] = []
    feed.observe(async (event) => {
      slow.push(event)
      if (slow.length === 1) await held
    })
    feed.observe((event) => {
      fast.push(event)
    })
    for (let i = 0; i < 110; i++) {
      feed.publish({ type: 'message.upsert', message: item('answer', String(i)) })
      await tick()
    }
    expect(fast.at(-1)).toMatchObject({ message: { parts: [{ text: '109' }] } })
    expect(slow).toHaveLength(1)
    unblock()
    await tick()
    expect(slow[0].type).toBe('snapshot')
    expect(slow[1]).toEqual({ type: 'gap', reason: 'overflow' })
    expect(slow[2]).toMatchObject({ type: 'snapshot', messages: [{ parts: [{ text: '100' }] }] })
    expect(slow.at(-1)).toMatchObject({ message: { parts: [{ text: '109' }] } })
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
    await subscription.stop()
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
      if (event.type === 'snapshot') (event.messages as RuntimeMessage[]).length = 0
    })
    const observed: ObservationPayload[] = []
    feed.observe((event) => {
      observed.push(event)
    })
    await tick()
    expect(feed.snapshot.messages.map((value) => value.id)).toEqual(['persisted', 'next'])
    expect(observed[0]).toMatchObject({ messages: [{ id: 'persisted' }, { id: 'next' }] })
    expect(initial.messages).toEqual([])
  })
})
