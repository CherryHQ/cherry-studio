import { describe, expect, it } from 'vitest'

import { runtimeId, ThreadFeed, type MessageItem, type ObservationPayload, type ThreadSnapshot } from '../src'

const ref = { backendId: runtimeId<'backend'>('backend'), id: runtimeId<'thread'>('session') }
const item = (id: string, text = id): MessageItem => ({
  ref: { session: ref, id: runtimeId(id) },
  type: 'message',
  role: 'assistant',
  parts: [{ type: 'text', text }],
  completeness: 'partial'
})
const snapshot = (): ThreadSnapshot => ({
  type: 'snapshot',
  coverage: 'current-view',
  items: [],
  inputs: [],
  activity: { scope: 'foreground', state: 'idle' }
})
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('normalized observation delivery', () => {
  it('retains child relationships without requiring a context and updates reused children by identity', async () => {
    const feed = new ThreadFeed(snapshot(), () => {})
    const subagent = { id: runtimeId<'subagent'>('child-work'), parent: ref }
    feed.publish({ type: 'subagent.upsert', subagent })
    expect(feed.snapshot.subagents).toEqual([subagent])
    const child = { ...ref, id: runtimeId<'thread'>('child-context') }
    feed.publish({ type: 'subagent.upsert', subagent: { ...subagent, child } })
    feed.publish({ type: 'activity.changed', activity: { scope: 'foreground', state: 'idle' } })
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
    const fast: ObservationPayload[] = []
    feed.observe(async (event) => {
      slow.push(event)
      if (slow.length === 1) await held
    })
    feed.observe((event) => {
      fast.push(event)
    })
    for (let i = 0; i < 110; i++) {
      feed.publish({ type: 'item.upsert', item: item('answer', String(i)) })
      await tick()
    }
    expect(fast.at(-1)).toMatchObject({ item: { parts: [{ text: '109' }] } })
    expect(slow).toHaveLength(1)
    unblock()
    await tick()
    expect(slow[0].type).toBe('snapshot')
    expect(slow[1]).toEqual({ type: 'gap', reason: 'overflow' })
    expect(slow[2]).toMatchObject({ type: 'snapshot', items: [{ parts: [{ text: '100' }] }] })
    expect(slow.at(-1)).toMatchObject({ item: { parts: [{ text: '109' }] } })
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
    feed.publish({ type: 'item.upsert', item: item('queued') })
    await subscription.stop()
    unblock()
    await tick()
    expect(count).toBe(1)
    feed.observe(() => {
      throw new Error('consumer failed')
    })
    await tick()
    feed.publish({ type: 'item.upsert', item: item('survives') })
    expect(failures).toHaveLength(1)
    expect(feed.snapshot.items.at(-1)?.ref.id).toBe('survives')
  })

  it('never enters a consumer on the publishing stack and preserves order with reentrant publication', async () => {
    const feed = new ThreadFeed(snapshot(), () => {})
    const events: ObservationPayload[] = []
    feed.observe((event) => {
      if (event.type === 'item.upsert' && event.item.ref.id === 'first')
        feed.publish({ type: 'item.upsert', item: item('second') })
    })
    feed.observe((event) => {
      events.push(event)
    })
    await tick()
    feed.publish({ type: 'item.upsert', item: item('first') })
    expect(events).toHaveLength(1)
    await tick()
    expect(events.flatMap((event) => (event.type === 'item.upsert' ? [event.item.ref.id] : []))).toEqual([
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
    for (let i = 0; i < 110; i++) feed.publish({ type: 'item.upsert', item: item('answer', String(i)) })
    await tick()
    expect(events[0].type).toBe('snapshot')
    expect(events[1]).toEqual({ type: 'gap', reason: 'overflow' })
    expect(events.at(-1)).toMatchObject({ item: { parts: [{ text: '109' }] } })
  })

  it('keeps replacement order and prevents consumers mutating shared facts', async () => {
    const initial = snapshot()
    const feed = new ThreadFeed(initial, () => {})
    feed.publish({ type: 'item.upsert', item: item('live') })
    feed.publish({ type: 'item.upsert', item: item('next') })
    feed.publish({ type: 'item.upsert', item: item('persisted'), replaces: [item('live').ref] })
    feed.observe((event) => {
      if (event.type === 'snapshot') (event.items as MessageItem[]).length = 0
    })
    const observed: ObservationPayload[] = []
    feed.observe((event) => {
      observed.push(event)
    })
    await tick()
    expect(feed.snapshot.items.map((value) => value.ref.id)).toEqual(['persisted', 'next'])
    expect(observed[0]).toMatchObject({ items: [{ ref: { id: 'persisted' } }, { ref: { id: 'next' } }] })
    expect(initial.items).toEqual([])
  })
})
