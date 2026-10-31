import { describe, expect, it, onTestFinished } from 'vitest'

import {
  runtimeId,
  ThreadFeed,
  type RuntimeMessage,
  type ObservationSink,
  type Thread,
  type ThreadHandle,
  type ThreadSnapshot
} from '@cherrystudio/agent-runtime'

import { ThreadMessageProjection, type ThreadProjectionUpdate } from '../ThreadMessageProjection'

const thread = (id: string): Thread => ({ backendId: runtimeId('fixture'), id: runtimeId(id) })
const root = thread('root')
function message(_owner: Thread, text: string, id = 'message', complete = false): RuntimeMessage {
  return {
    id,
    role: 'assistant',
    parts: [{ type: 'text', text, state: complete ? 'done' : 'streaming' }],
    metadata: { completeness: complete ? 'complete' : 'partial' }
  }
}
const snapshot = (messages: RuntimeMessage[] = []): ThreadSnapshot => ({
  type: 'snapshot',
  coverage: 'current-view',
  messages,
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
  it('returns only changed messages without redecorating history or mutating an earlier view', async () => {
    let budget = Infinity
    const value = new ThreadMessageProjection(root, (message) => {
      if (--budget < 0) throw new Error('A live update traversed unrelated history')
      return message
    })
    onTestFinished(() => value.close())
    await value.accept(
      snapshot(Array.from({ length: 1000 }, (_, index) => message(root, 'saved', `old-${index}`, true)))
    )
    const before = value.snapshot()
    budget = 1
    const changed = await value.accept({ type: 'message.upsert', message: message(root, 'new text', 'live') })
    expect(changed).toEqual([
      {
        id: 'live',
        role: 'assistant',
        parts: [{ type: 'text', text: 'new text', state: 'streaming' }],
        metadata: { status: 'pending' }
      }
    ])
    expect(before.messages).toHaveLength(1000)
    expect(value.snapshot().messages).toHaveLength(1001)
    expect(value.snapshot().messages[0]).toBe(before.messages[0])
    expect(
      await value.accept({ type: 'activity.changed', activity: { scope: 'foreground', state: 'active' } })
    ).toEqual([])
  })

  it('returns the final ordered changes of a batch and supports explicit display invalidation', async () => {
    let title = 'before'
    const value = new ThreadMessageProjection(root, (message) => ({
      ...message,
      metadata: { ...message.metadata, title }
    }))
    onTestFinished(() => value.close())
    await value.accept(snapshot([message(root, 'first', 'a'), message(root, 'second', 'b')]))
    const changed = await value.accept([
      { type: 'message.upsert', message: message(root, 'second updated', 'b') },
      { type: 'message.upsert', message: message(root, 'first updated', 'a') },
      { type: 'message.upsert', message: message(root, 'second final', 'b', true) }
    ])
    expect(changed.map((item) => item.id)).toEqual(['a', 'b'])
    expect(changed[1].parts).toEqual([{ type: 'text', text: 'second final', state: 'done' }])
    title = 'after'
    const refreshed = await value.accept([], ['a'])
    expect(refreshed).toHaveLength(1)
    expect(refreshed[0]).toMatchObject({ id: 'a', metadata: { title: 'after' } })
    expect(value.snapshot().messages[1].metadata).toMatchObject({ title: 'before' })
  })

  it('keeps the last committed content when a multi-message decoration fails before any snapshot read', async () => {
    const value = new ThreadMessageProjection(root, (message) => {
      if (message.id === 'invalid') throw new Error('Invalid display metadata')
      return message
    })
    onTestFinished(() => value.close())
    await value.accept({ type: 'message.upsert', message: message(root, 'committed', 'kept', true) })
    await expect(
      value.accept(snapshot([message(root, 'uncommitted', 'kept'), message(root, 'bad', 'invalid')]))
    ).rejects.toThrow('Invalid display metadata')
    expect(text(value)).toEqual(['committed'])
    expect(value.snapshot().closed).toBe('consumer-error')
    expect(await value.accept({ type: 'message.upsert', message: message(root, 'ignored') })).toEqual([])
    await value.accept(snapshot([message(root, 'recovered')]))
    expect(text(value)).toEqual(['recovered'])
  })

  it('continues a partial snapshot without duplicating its prefix or ending it early', async () => {
    const value = projection()
    await value.accept(snapshot([message(root, 'hel')]))
    await value.accept({ type: 'message.upsert', message: message(root, 'hello') })
    expect(text(value)).toEqual(['hello'])
    expect(value.snapshot().messages[0].parts).toEqual([{ type: 'text', text: 'hello', state: 'streaming' }])
    await value.accept({ type: 'message.upsert', message: message(root, 'hello!', 'message', true) })
    expect(value.snapshot().messages[0].parts).toEqual([{ type: 'text', text: 'hello!', state: 'done' }])
  })

  it('replaces shortened text and reordered reasoning, without retaining removed parts', async () => {
    const value = projection()
    await value.accept(snapshot([message(root, 'original long answer')]))
    const replacement = {
      ...message(root, 'new'),
      parts: [
        { type: 'reasoning' as const, text: 'reconsider', state: 'done' as const },
        { type: 'text' as const, text: 'new' }
      ]
    }
    await value.accept({ type: 'message.upsert', message: replacement })
    await value.accept({
      type: 'message.upsert',
      message: {
        ...replacement,
        parts: [replacement.parts[0], { type: 'text', text: 'new answer', state: 'done' }],
        metadata: { completeness: 'complete' }
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
      type: 'message.upsert',
      message: message(root, 'same', 'saved', true),
      replaces: [{ session: root, id: runtimeId('preview') }]
    })
    expect(text(value)).toEqual(['same'])
    expect(value.snapshot().messages.map((item) => item.id)).toEqual(['saved'])
    expect(events.at(-1)).toMatchObject({ type: 'change', removed: ['preview'], messages: [{ id: 'saved' }] })
    await value.accept({ type: 'message.remove', ref: { session: root, id: runtimeId('saved') } })
    expect(text(value)).toEqual([])
  })

  it('isolates parent, siblings and grandchildren even when item IDs collide', async () => {
    const owners = [root, thread('child-a'), thread('child-b'), thread('grandchild')]
    const views = owners.map((owner) => projection(owner))
    await Promise.all(views.map((view, i) => view.accept(snapshot([message(owners[i], owners[i].id)]))))
    await views[0].close()
    await views[1].accept({ type: 'message.upsert', message: message(owners[1], 'child-a continues', 'message', true) })
    await views[3].accept({ type: 'message.upsert', message: message(owners[3], 'grandchild continues') })
    expect(views.map(text)).toEqual([['root'], ['child-a continues'], ['child-b'], ['grandchild continues']])
    await expect(
      views[2].accept({ type: 'message.remove', ref: { session: root, id: runtimeId('message') } })
    ).rejects.toThrow(/thread/i)
    expect(text(views[2])).toEqual(['child-b'])
    const anotherBackend = { ...root, backendId: runtimeId<'backend'>('other') }
    await expect(
      views[1].accept({ type: 'subagent.upsert', subagent: { id: runtimeId('foreign'), parent: anotherBackend } })
    ).rejects.toThrow(/thread/i)
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
      feed.publish({ type: 'message.upsert', message: message(root, `part ${index}`, 'preview') })
    feed.publish({
      type: 'message.upsert',
      message: message(root, 'final', 'saved', true),
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
    await value.accept({
      type: 'message.upsert',
      message: middle,
      replaces: [{ session: root, id: runtimeId('preview') }]
    })
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

  it('gives an attaching consumer a committed baseline while an update is queued', async () => {
    const value = projection()
    await value.accept(snapshot([message(root, 'old', 'old', true)]))
    const before = value.snapshot()
    const pending = value.accept(snapshot([message(root, 'new', 'new')]))
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
    const pending = old({ type: 'message.upsert', message: message(root, 'first extended') })
    await value.attach(handle('second'))
    await pending
    await old({ type: 'message.upsert', message: message(root, 'late old output') })
    expect(text(value)).toEqual(['second'])
    await retired({ type: 'message.upsert', message: message(root, 'second extended', 'message', true) })
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
    feed.publish({ type: 'message.remove', ref: { session: sibling.thread, id: runtimeId('message') } })
    feed.publish({ type: 'message.upsert', message: message(root, 'unusable tail') })
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
    recovered.publish({ type: 'message.upsert', message: message(root, 'restored and continued', 'message', true) })
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
    await value.accept({ type: 'message.upsert', message: message(root, 'first extended', 'a') })
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
    await value.accept({ type: 'message.upsert', message: message(root, 'unmapped tail', 'other') })
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

  it('retains interleaved parts and keeps preliminary tool output pending until settlement', async () => {
    const value = projection()
    const tool = {
      type: 'dynamic-tool' as const,
      toolCallId: 'call',
      toolName: 'Bash',
      input: {},
      state: 'output-available' as const,
      output: 'FIRST',
      preliminary: true
    }
    const source: RuntimeMessage = {
      id: 'native',
      role: 'assistant',
      metadata: { completeness: 'complete' },
      parts: [{ type: 'text', text: 'Before', state: 'done' }, tool, { type: 'text', text: 'After', state: 'done' }]
    }
    await value.accept({ type: 'message.upsert', message: source })
    expect(value.snapshot().messages).toHaveLength(1)
    expect(value.snapshot().messages[0]).toMatchObject({
      metadata: { status: 'pending' },
      parts: [{ text: 'Before' }, { output: 'FIRST', preliminary: true }, { text: 'After' }]
    })
    await value.accept({
      type: 'message.upsert',
      message: {
        ...source,
        parts: [source.parts[0], { ...tool, output: 'FIRST\nLAST', preliminary: false }, source.parts[2]]
      }
    })
    expect(value.snapshot().messages[0]).toMatchObject({
      metadata: { status: 'success' },
      parts: [{ text: 'Before' }, { toolCallId: 'call', output: 'FIRST\nLAST', preliminary: false }, { text: 'After' }]
    })
    expect(source.parts[1]).toMatchObject({ output: 'FIRST', preliminary: true })
  })
})
