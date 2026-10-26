import { describe, expect, it, onTestFinished } from 'vitest'

import {
  runtimeId,
  ThreadFeed,
  type ContentItem,
  type MessageItem,
  type ObservationSink,
  type Thread,
  type ThreadHandle,
  type ThreadSnapshot,
  type ToolCallItem
} from '@cherrystudio/agent-runtime'

import { ThreadMessageProjection, type ThreadProjectionUpdate } from '../ThreadMessageProjection'

const thread = (id: string): Thread => ({ backendId: runtimeId('fixture'), id: runtimeId(id) })
const root = thread('root')
function message(owner: Thread, text: string, id = 'message', complete = false): MessageItem {
  return {
    ref: { session: owner, id: runtimeId(id) },
    type: 'message',
    role: 'assistant',
    parts: [{ type: 'text', text }],
    completeness: complete ? 'complete' : 'partial'
  }
}
const snapshot = (items: ContentItem[] = []): ThreadSnapshot => ({
  type: 'snapshot',
  coverage: 'current-view',
  items,
  inputs: [],
  subagents: [],
  activity: { scope: 'foreground', state: 'idle' }
})
function projection(owner = root) {
  const value = new ThreadMessageProjection(owner)
  onTestFinished(() => value.close())
  return value
}
const text = (value: ThreadMessageProjection) =>
  value.snapshot().messages.flatMap((entry) => entry.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])))

describe('ThreadMessageProjection', () => {
  it('continues a partial snapshot without duplicating its prefix or ending it early', async () => {
    const value = projection()
    await value.accept(snapshot([message(root, 'hel')]))
    await value.accept({ type: 'item.upsert', item: message(root, 'hello') })
    expect(text(value)).toEqual(['hello'])
    expect(value.snapshot().messages[0].parts).toEqual([{ type: 'text', text: 'hello', state: 'streaming' }])
    await value.accept({ type: 'item.upsert', item: message(root, 'hello!', 'message', true) })
    expect(value.snapshot().messages[0].parts).toEqual([{ type: 'text', text: 'hello!', state: 'done' }])
  })

  it('replaces shortened text and reordered reasoning, then resumes valid SDK chunks', async () => {
    const value = projection()
    await value.accept(snapshot([message(root, 'original long answer')]))
    const replacement = {
      ...message(root, 'new'),
      parts: [
        { type: 'reasoning' as const, text: 'reconsider' },
        { type: 'text' as const, text: 'new' }
      ]
    }
    await value.accept({ type: 'item.upsert', item: replacement })
    await value.accept({
      type: 'item.upsert',
      item: {
        ...replacement,
        parts: [replacement.parts[0], { type: 'text', text: 'new answer' }],
        completeness: 'complete'
      }
    })
    expect(value.snapshot().messages[0].parts).toEqual([
      { type: 'reasoning', text: 'reconsider', state: 'done' },
      { type: 'text', text: 'new answer', state: 'done' }
    ])
  })

  it('keeps equal snapshots idempotent and replaces preview identities atomically', async () => {
    const value = projection()
    await value.accept(snapshot([message(root, 'same', 'preview')]))
    const before = value.snapshot()
    await value.accept(snapshot([message(root, 'same', 'preview')]))
    expect(value.snapshot().revision).toBe(before.revision)
    expect(value.snapshot().messages[0]).toBe(before.messages[0])
    const events: ThreadProjectionUpdate[] = []
    value.subscribe((event) => events.push(event))
    await value.accept({
      type: 'item.upsert',
      item: message(root, 'same', 'saved', true),
      replaces: [{ session: root, id: runtimeId('preview') }]
    })
    expect(text(value)).toEqual(['same'])
    expect(value.snapshot().messages.map((item) => item.id)).toEqual(['saved'])
    expect(events.at(-1)).toMatchObject({ type: 'change', removed: ['preview'], messages: [{ id: 'saved' }] })
    await value.accept({ type: 'item.remove', ref: { session: root, id: runtimeId('saved') } })
    expect(text(value)).toEqual([])
  })

  it('isolates parent, siblings and grandchildren even when item IDs collide', async () => {
    const owners = [root, thread('child-a'), thread('child-b'), thread('grandchild')]
    const views = owners.map((owner) => projection(owner))
    await Promise.all(views.map((view, i) => view.accept(snapshot([message(owners[i], owners[i].id)]))))
    await views[0].close()
    await views[1].accept({ type: 'item.upsert', item: message(owners[1], 'child-a continues', 'message', true) })
    await views[3].accept({ type: 'item.upsert', item: message(owners[3], 'grandchild continues') })
    expect(views.map(text)).toEqual([['root'], ['child-a continues'], ['child-b'], ['grandchild continues']])
    await expect(views[2].accept({ type: 'item.upsert', item: message(root, 'wrong owner') })).rejects.toThrow(
      /thread/i
    )
    expect(text(views[2])).toEqual(['child-b'])
    const anotherBackend = { ...root, backendId: runtimeId<'backend'>('other') }
    await expect(views[1].accept(snapshot([message(anotherBackend, 'foreign backend')]))).rejects.toThrow(/thread/i)
  })

  it('converges after a ThreadFeed burst overflows its bounded queue', async () => {
    const errors: unknown[] = []
    const feed = new ThreadFeed(snapshot([message(root, 'initial', 'preview')]), (error) => errors.push(error))
    const value = projection()
    const events: ThreadProjectionUpdate[] = []
    value.subscribe((event) => events.push(event))
    await value.attach({
      thread: root,
      release: async () => {},
      observe: async (sink) => ({ status: 'confirmed', value: feed.observe(sink) })
    })
    for (let index = 0; index < 150; index++)
      feed.publish({ type: 'item.upsert', item: message(root, `part ${index}`, 'preview') })
    feed.publish({
      type: 'item.upsert',
      item: message(root, 'final', 'saved', true),
      replaces: [{ session: root, id: runtimeId('preview') }]
    })
    await expect.poll(() => text(value)).toEqual(['final'])
    expect(value.snapshot().messages.map((entry) => entry.id)).toEqual(['saved'])
    expect(events.some((event) => event.type === 'change' && event.state.gap === 'overflow')).toBe(true)
    expect(value.snapshot().gap).toBeUndefined()
    expect(errors).toEqual([])
  })

  it('retains replacement position and publishes reorder-only snapshots', async () => {
    const value = projection()
    const first = message(root, 'first', 'first', true)
    const last = message(root, 'last', 'last', true)
    await value.accept(snapshot([first, message(root, 'middle', 'preview'), last]))
    const middle = message(root, 'middle', 'saved', true)
    await value.accept({ type: 'item.upsert', item: middle, replaces: [{ session: root, id: runtimeId('preview') }] })
    expect(text(value)).toEqual(['first', 'middle', 'last'])
    const events: ThreadProjectionUpdate[] = []
    value.subscribe((event) => events.push(event))
    await value.accept(snapshot([last, middle, first]))
    expect(text(value)).toEqual(['last', 'middle', 'first'])
    expect(events.at(-1)).toMatchObject({
      type: 'change',
      messages: [],
      removed: [],
      order: ['last', 'saved', 'first']
    })
  })

  it('gives an attaching consumer a committed baseline while the SDK reader is updating', async () => {
    const value = projection()
    await value.accept(snapshot([message(root, 'old', 'old', true)]))
    const before = value.snapshot()
    const pending = value.accept(snapshot([message(root, 'new', 'new')]))
    await Promise.resolve()
    const events: ThreadProjectionUpdate[] = []
    value.subscribe((event) => events.push(event))
    expect(events).toEqual([{ type: 'snapshot', view: before }])
    await pending
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ type: 'change', revision: before.revision + 1, removed: ['old'], order: ['new'] })
    expect(text(value)).toEqual(['new'])
  })

  it('drains accepted updates and fences late callbacks when replacing observation access', async () => {
    const value = projection()
    let retired!: ObservationSink
    const handle = (answer: string): ThreadHandle => ({
      thread: root,
      release: async () => {},
      async observe(sink) {
        retired = sink
        await sink(snapshot([message(root, answer)]))
        return { status: 'confirmed', value: { stop: async () => {} } }
      }
    })
    await value.attach(handle('first'))
    const old = retired
    const pending = old({ type: 'item.upsert', item: message(root, 'first extended') })
    await value.attach(handle('second'))
    await pending
    await old({ type: 'item.upsert', item: message(root, 'late old output') })
    expect(text(value)).toEqual(['second'])
    await retired({ type: 'item.upsert', item: message(root, 'second extended', 'message', true) })
    expect(text(value)).toEqual(['second extended'])
  })

  it('publishes a projection failure once, preserves its last view and recovers on explicit reattachment', async () => {
    const value = projection()
    const sibling = projection(thread('sibling'))
    const errors: unknown[] = []
    const feed = new ThreadFeed(snapshot([message(root, 'last readable')]), (error) => errors.push(error))
    await value.attach({
      thread: root,
      release: async () => {},
      observe: async (sink) => ({ status: 'confirmed', value: feed.observe(sink) })
    })
    await expect.poll(() => text(value)).toEqual(['last readable'])
    feed.publish({ type: 'item.upsert', item: message(sibling.thread, 'wrong scope') })
    feed.publish({ type: 'item.upsert', item: message(root, 'unusable tail') })
    await expect.poll(() => value.snapshot().closed).toBe('consumer-error')
    expect(value.snapshot()).toMatchObject({ gap: 'mapping-reset', diagnostic: { code: 'projection-failed' } })
    expect(text(value)).toEqual(['last readable'])
    await sibling.accept(snapshot([message(sibling.thread, 'sibling continues')]))
    expect(text(sibling)).toEqual(['sibling continues'])
    await expect.poll(() => errors.length).toBe(1)
    const recovered = new ThreadFeed(snapshot([message(root, 'restored')]), (error) => errors.push(error))
    await value.attach({
      thread: root,
      release: async () => {},
      observe: async (sink) => ({ status: 'confirmed', value: recovered.observe(sink) })
    })
    await expect.poll(() => text(value)).toEqual(['restored'])
    expect(value.snapshot().closed).toBeUndefined()
    expect(value.snapshot().diagnostic).toBeUndefined()
    recovered.publish({ type: 'item.upsert', item: message(root, 'restored and continued', 'message', true) })
    await expect.poll(() => text(value)).toEqual(['restored and continued'])
    expect(errors).toHaveLength(1)
  })

  it('stops observation obtained after close and rejects further attachment', async () => {
    const value = projection()
    let finish!: () => void
    const pending = new Promise<void>((resolve) => {
      finish = resolve
    })
    let arrive!: () => void
    const reached = new Promise<void>((resolve) => {
      arrive = resolve
    })
    let observing = true
    const handle: ThreadHandle = {
      thread: root,
      release: async () => {},
      async observe(sink) {
        arrive()
        await pending
        await sink(snapshot([message(root, 'too late')]))
        return {
          status: 'confirmed',
          value: {
            stop: async () => {
              observing = false
            }
          }
        }
      }
    }
    const attaching = value.attach(handle)
    await reached
    const closing = value.close()
    finish()
    await Promise.all([attaching, closing])
    expect(observing).toBe(false)
    expect(text(value)).toEqual([])
    await expect(value.attach(handle)).rejects.toThrow(/closed/)
  })

  it('supports independent subscribers, isolates a failing subscriber and delivers only changed messages', async () => {
    const value = projection()
    await value.accept(snapshot([message(root, 'first', 'a'), message(root, 'second', 'b', true)]))
    const stable = value.snapshot().messages[1]
    const left: ThreadProjectionUpdate[] = []
    const right: ThreadProjectionUpdate[] = []
    const stop = value.subscribe((event) => left.push(event))
    value.subscribe((event) => {
      if (event.type === 'change') throw new Error('window closed')
    })
    value.subscribe((event) => right.push(event))
    stop()
    await value.accept({ type: 'item.upsert', item: message(root, 'first extended', 'a') })
    expect(left).toHaveLength(1)
    expect(right).toHaveLength(2)
    expect(right[1]).toMatchObject({ type: 'change', messages: [{ id: 'a' }], removed: [] })
    if (right[1].type === 'change') expect(right[1].messages).toHaveLength(1)
    expect(value.snapshot().messages[1]).toBe(stable)
    expect(text(value)).toEqual(['first extended', 'second'])
  })

  it('requires a new baseline after a gap and preserves confirmed input outcome', async () => {
    const value = projection()
    await value.accept(snapshot([message(root, 'before')]))
    await value.accept({
      type: 'input.changed',
      input: { inputId: runtimeId('input'), facts: ['accepted'], outcome: 'completed' }
    })
    await value.accept({ type: 'gap', reason: 'overflow' })
    await value.accept({ type: 'item.upsert', item: message(root, 'unmapped tail', 'other') })
    expect(text(value)).toEqual(['before'])
    expect(value.snapshot().gap).toBe('overflow')
    await value.accept(snapshot([message(root, 'recovered', 'saved', true)]))
    expect(text(value)).toEqual(['recovered'])
    expect(value.snapshot().gap).toBeUndefined()
    expect(value.snapshot().inputs[0].outcome).toBe('completed')
  })

  it('merges native and logical input identities without losing settled facts on reattachment', async () => {
    const value = projection()
    const nativeInput = { session: root, id: runtimeId<'native-input'>('native') }
    await value.accept({ ...snapshot(), inputs: [{ nativeInput, facts: ['accepted'] }] })
    await value.accept({
      type: 'input.changed',
      input: { inputId: runtimeId('logical'), nativeInput, facts: ['placed'], outcome: 'completed' }
    })
    await value.accept({ ...snapshot(), inputs: [{ nativeInput, facts: ['accepted'] }] })
    expect(value.snapshot().inputs).toEqual([
      {
        inputId: 'logical',
        nativeInput,
        facts: ['accepted', 'placed'],
        outcome: 'completed',
        response: undefined,
        error: undefined
      }
    ])
  })

  it('records inaccessible children without treating the parent lifecycle as child completion', async () => {
    const value = projection()
    const relation = { id: runtimeId<'subagent'>('relation'), parent: root }
    await value.accept({ type: 'subagent.upsert', subagent: relation })
    await value.accept({ type: 'subagent.upsert', subagent: { ...relation, child: thread('child') } })
    await value.accept({ type: 'activity.changed', activity: { scope: 'foreground', state: 'idle' } })
    await value.accept({ type: 'closed', reason: 'released' })
    expect(value.snapshot().subagents).toEqual([{ ...relation, child: thread('child') }])
    expect(value.snapshot().messages).toEqual([])
    expect(value.snapshot().closed).toBe('released')
  })

  it('projects streamed and replaced tool arguments, associates results, and removes stale output', async () => {
    const value = projection()
    const call: ToolCallItem = {
      type: 'tool-call',
      ref: { session: root, id: runtimeId('call') },
      name: 'read',
      argumentsText: '{"path":"a',
      completeness: 'partial'
    }
    await value.accept({ type: 'item.upsert', item: call })
    expect(value.snapshot().messages[0].parts[0]).toMatchObject({
      type: 'dynamic-tool',
      state: 'input-streaming',
      input: { path: 'a' }
    })
    await value.accept({
      type: 'item.upsert',
      item: { ...call, argumentsText: '{"path":"b"}', completeness: 'complete' }
    })
    const result = {
      type: 'tool-result' as const,
      ref: { session: root, id: runtimeId<'item'>('result') },
      call: call.ref,
      parts: [{ type: 'text' as const, text: 'file body' }],
      outcome: 'success' as const
    }
    await value.accept({ type: 'item.upsert', item: result })
    expect(value.snapshot().messages).toHaveLength(1)
    expect(value.snapshot().messages[0].parts[0]).toMatchObject({
      state: 'output-available',
      input: { path: 'b' },
      output: result.parts
    })
    await value.accept({ type: 'item.remove', ref: result.ref })
    expect(value.snapshot().messages[0].parts[0]).toMatchObject({ state: 'input-available', input: { path: 'b' } })
    expect(value.snapshot().messages[0].parts[0]).toMatchObject({ output: undefined })
  })

  it('waits for an explicit result association and preserves preliminary output until actual settlement', async () => {
    const value = projection()
    const call: ToolCallItem = {
      type: 'tool-call',
      ref: { session: root, id: runtimeId('call') },
      name: 'work',
      argumentsText: '{}',
      completeness: 'complete'
    }
    const result = {
      type: 'tool-result' as const,
      ref: { session: root, id: runtimeId<'item'>('result') },
      parts: [{ type: 'text' as const, text: 'working' }],
      outcome: 'unknown' as const
    }
    await value.accept(snapshot([result, call]))
    expect(value.snapshot().messages[0].parts[0]).toMatchObject({ state: 'input-available', output: undefined })
    await value.accept({ type: 'item.upsert', item: { ...result, call: call.ref } })
    expect(value.snapshot().messages[0].parts[0]).toMatchObject({
      state: 'output-available',
      preliminary: true,
      output: result.parts
    })
    await value.accept({
      type: 'item.upsert',
      item: { ...result, call: call.ref, outcome: 'success', data: { result: 'done' } }
    })
    expect(value.snapshot().messages[0].parts[0]).toMatchObject({
      state: 'output-available',
      preliminary: false,
      output: { result: 'done' }
    })
    await value.accept({ type: 'item.upsert', item: { ...result, call: call.ref, outcome: 'success', data: null } })
    expect(value.snapshot().messages[0].parts[0]).toMatchObject({ output: null, preliminary: false })
  })
})
