import { describe, expect, it, onTestFinished } from 'vitest'

import { runtimeId, type RuntimeMessage, type Thread, type ThreadSnapshot } from '@cherrystudio/agent-runtime'

import { ThreadMessageProjection } from '../ThreadMessageProjection'

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
  messages,
  inputs: [],
  subagents: [],
  activity: { state: 'idle' }
})
function projection(owner = root) {
  const value = new ThreadMessageProjection(owner)
  onTestFinished(() => value.close())
  return value
}
const text = (value: ThreadMessageProjection) =>
  value.snapshot().messages.flatMap((entry) => entry.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])))

describe('ThreadMessageProjection', () => {
  it('snapshots native mutations at acceptance and retains settled results until their explicit part changes', async () => {
    const value = projection()
    const output = { body: 'accepted A' }
    const source: RuntimeMessage = {
      id: 'native',
      role: 'assistant',
      metadata: { completeness: 'partial' },
      parts: [
        { type: 'dynamic-tool', toolName: 'Read', toolCallId: 'call', state: 'output-available', input: {}, output },
        { type: 'text', text: 'prefix', state: 'streaming' }
      ]
    }
    const accepting = value.accept({ type: 'message.reconcile', message: source })
    output.body = 'accepted B'
    await accepting
    const before = value.snapshot()
    expect(before.messages[0].parts[0]).toMatchObject({ output: { body: 'accepted A' } })
    source.parts[1] = { type: 'text', text: 'prefix suffix', state: 'streaming' }
    await value.accept({
      type: 'message.text-append',
      ref: { session: root, id: runtimeId(source.id) },
      part: 1,
      text: ' suffix'
    })
    expect(value.snapshot().messages[0].parts[0]).toBe(before.messages[0].parts[0])
    expect(value.snapshot().messages[0].parts[1]).toMatchObject({ text: 'prefix suffix' })
    const part = source.parts[0]
    if (part.type !== 'dynamic-tool') throw new Error('Missing tool part')
    await value.accept({
      type: 'message.parts',
      ref: { session: root, id: runtimeId(source.id) },
      changes: [{ type: 'put', part: 0, value: part }]
    })
    expect(value.snapshot().messages[0].parts[0]).toMatchObject({ output: { body: 'accepted B' } })
    expect(before.messages[0].parts[0]).toMatchObject({ output: { body: 'accepted A' } })
  })
  it.each(['staged', 'observed'] as const)(
    'rejects stray and stale native tool output on the %s path',
    async (path) => {
      const value = projection()
      const ref = { session: root, id: runtimeId<'item'>('message') }
      const tool = { type: 'dynamic-tool' as const, toolCallId: 'call', toolName: 'Read', input: {} }
      await value.accept(snapshot([{ ...message(root, ''), parts: [{ ...tool, state: 'input-available' }] }]))
      const output = async (part: number, toolCallId: string, body: string, preliminary: boolean) => {
        const event = {
          type: 'message.tool-output' as const,
          ref,
          part,
          tool: { ...tool, toolCallId, state: 'output-available' as const, output: body, preliminary }
        }
        if (path === 'staged') {
          value.stageParts(event, 1)
          await value.drain()
        } else await value.accept(event)
      }
      await output(1, 'missing', 'stray', true)
      await output(0, 'other', 'wrong call', false)
      expect(value.snapshot().messages[0].parts).toEqual([{ ...tool, state: 'input-available' }])
      await output(0, 'call', 'settled', false)
      await output(0, 'call', 'too late', true)
      expect(value.snapshot().messages[0].parts).toMatchObject([
        { toolCallId: 'call', output: 'settled', preliminary: false }
      ])
    }
  )

  it('updates one source without redecorating history or mutating an earlier view', async () => {
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
    await value.accept({ type: 'message.reconcile', message: message(root, 'new text', 'live') })
    expect(value.snapshot().messages.slice(-1)).toEqual([
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
    await value.accept({ type: 'activity.changed', activity: { state: 'active' } })
    expect(value.snapshot().activity.state).toBe('active')
  })

  it('redecorates only changed sources across repeated snapshots unless explicitly invalidated', async () => {
    let budget = Infinity
    let label = 'v1'
    const value = new ThreadMessageProjection(root, (message) => {
      if (--budget < 0) throw new Error('A snapshot redecorated unchanged history')
      return {
        ...message,
        parts: message.parts.map((part) => (part.type === 'text' ? { ...part, text: `${label}:${part.text}` } : part))
      }
    })
    onTestFinished(() => value.close())
    const history = Array.from({ length: 1000 }, (_, index) => message(root, 'saved', `old-${index}`, true))
    await value.accept(snapshot(history))
    budget = 1
    await value.accept(snapshot([...history, message(root, 'streaming', 'live')]))
    label = 'v2'
    budget = 2
    await value.accept([snapshot([...history, message(root, 'more', 'live')])], ['old-0'])
    expect(text(value).slice(0, 2)).toEqual(['v2:saved', 'v1:saved'])
    expect(text(value).at(-1)).toBe('v2:more')
  })

  it('preserves message order across a batch and supports explicit display invalidation', async () => {
    let title = 'before'
    const value = new ThreadMessageProjection(root, (message) => ({
      ...message,
      metadata: { ...message.metadata, title }
    }))
    onTestFinished(() => value.close())
    await value.accept(snapshot([message(root, 'first', 'a'), message(root, 'second', 'b')]))
    await value.accept([
      { type: 'message.reconcile', message: message(root, 'second updated', 'b') },
      { type: 'message.reconcile', message: message(root, 'first updated', 'a') },
      { type: 'message.reconcile', message: message(root, 'second final', 'b', true) }
    ])
    const changed = value.snapshot().messages
    expect(changed.map((item) => item.id)).toEqual(['a', 'b'])
    expect(changed[1].parts).toEqual([{ type: 'text', text: 'second final', state: 'done' }])
    title = 'after'
    await value.accept([], ['a'])
    expect(value.snapshot().messages[0]).toMatchObject({ id: 'a', metadata: { title: 'after' } })
    expect(value.snapshot().messages[1].metadata).toMatchObject({ title: 'before' })
  })

  it('keeps the last committed content when a multi-message decoration fails before any snapshot read', async () => {
    const value = new ThreadMessageProjection(root, (message) => {
      if (message.id === 'invalid') throw new Error('Invalid display metadata')
      return message
    })
    onTestFinished(() => value.close())
    await value.accept({ type: 'message.reconcile', message: message(root, 'committed', 'kept', true) })
    await expect(
      value.accept(snapshot([message(root, 'uncommitted', 'kept'), message(root, 'bad', 'invalid')]))
    ).rejects.toThrow('Invalid display metadata')
    expect(text(value)).toEqual(['committed'])
    expect(value.snapshot().closed).toBe('consumer-error')
    await value.accept({ type: 'message.reconcile', message: message(root, 'ignored') })
    expect(text(value)).toEqual(['committed'])
    await value.accept(snapshot([message(root, 'recovered')]))
    expect(text(value)).toEqual(['recovered'])
  })

  it('continues a partial snapshot without duplicating its prefix or ending it early', async () => {
    const value = projection()
    await value.accept(snapshot([message(root, 'hel')]))
    await value.accept({ type: 'message.reconcile', message: message(root, 'hello') })
    expect(text(value)).toEqual(['hello'])
    expect(value.snapshot().messages[0].parts).toEqual([{ type: 'text', text: 'hello', state: 'streaming' }])
    await value.accept({ type: 'message.reconcile', message: message(root, 'hello!', 'message', true) })
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
    await value.accept({ type: 'message.reconcile', message: replacement })
    await value.accept({
      type: 'message.reconcile',
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
    expect(value.snapshot()).toBe(before)
    expect(value.snapshot().messages[0]).toBe(before.messages[0])
    await value.accept({
      type: 'message.reconcile',
      message: message(root, 'same', 'saved', true),
      replaces: [{ session: root, id: runtimeId('preview') }]
    })
    expect(text(value)).toEqual(['same'])
    expect(value.snapshot().messages.map((item) => item.id)).toEqual(['saved'])
    await value.accept({ type: 'message.remove', ref: { session: root, id: runtimeId('saved') } })
    expect(text(value)).toEqual([])
  })

  it('isolates parent, siblings and grandchildren even when item IDs collide', async () => {
    const owners = [root, thread('child-a'), thread('child-b'), thread('grandchild')]
    const views = owners.map((owner) => projection(owner))
    await Promise.all(views.map((view, i) => view.accept(snapshot([message(owners[i], owners[i].id)]))))
    await views[0].close()
    await views[1].accept({
      type: 'message.reconcile',
      message: message(owners[1], 'child-a continues', 'message', true)
    })
    await views[3].accept({ type: 'message.reconcile', message: message(owners[3], 'grandchild continues') })
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

  it('retains replacement position and publishes reorder-only snapshots', async () => {
    const value = projection()
    const first = message(root, 'first', 'first', true)
    const last = message(root, 'last', 'last', true)
    await value.accept(snapshot([first, message(root, 'middle', 'preview'), last]))
    const middle = message(root, 'middle', 'saved', true)
    await value.accept({
      type: 'message.reconcile',
      message: middle,
      replaces: [{ session: root, id: runtimeId('preview') }]
    })
    expect(text(value)).toEqual(['first', 'middle', 'last'])
    await value.accept(snapshot([last, middle, first]))
    expect(text(value)).toEqual(['last', 'middle', 'first'])
  })

  it('requires a new baseline after a gap', async () => {
    const value = projection()
    await value.accept(snapshot([message(root, 'before')]))
    await value.accept({ type: 'gap', reason: 'overflow' })
    await value.accept({ type: 'message.reconcile', message: message(root, 'unmapped tail', 'other') })
    expect(text(value)).toEqual(['before'])
    expect(value.snapshot().gap).toBe('overflow')
    await value.accept(snapshot([message(root, 'recovered', 'saved', true)]))
    expect(text(value)).toEqual(['recovered'])
    expect(value.snapshot().gap).toBeUndefined()
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
    await value.accept({ type: 'message.reconcile', message: source })
    expect(value.snapshot().messages).toHaveLength(1)
    expect(value.snapshot().messages[0]).toMatchObject({
      metadata: { status: 'pending' },
      parts: [{ text: 'Before' }, { output: 'FIRST', preliminary: true }, { text: 'After' }]
    })
    await value.accept({
      type: 'message.reconcile',
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

it.each([20, 20_000])('updates two child messages without enumerating %i stored messages', async (historySize) => {
  const thread = { backendId: runtimeId<'backend'>('fixture'), id: runtimeId<'thread'>('child') }
  const projection = new ThreadMessageProjection(thread)
  const msg = (i: number, text: string): RuntimeMessage => ({
    id: String(i),
    role: 'assistant',
    parts: [{ type: 'text', text, state: 'done' }]
  })
  try {
    await projection.accept({
      type: 'snapshot',
      activity: { state: 'idle' },
      inputs: [],
      messages: Array.from({ length: historySize }, (_, i) => msg(i, 'history'))
    })
    const entries = Reflect.get(projection, 'entries') as Map<string, unknown>
    const values = entries.values.bind(entries)
    let visited = 0
    Reflect.defineProperty(entries, 'values', {
      value: function* () {
        for (const entry of values()) {
          ++visited
          yield entry
        }
      }
    })
    await projection.accept({ type: 'message.reconcile', message: msg(0, 'one') })
    expect(visited).toBe(0)
    await projection.accept([0, 1].map((i) => ({ type: 'message.reconcile' as const, message: msg(i, 'two') })))
    expect(visited).toBe(0)
    expect(
      projection
        .snapshot()
        .messages.slice(0, 2)
        .map((row) => row.parts[0])
    ).toMatchObject([{ text: 'two' }, { text: 'two' }])
  } finally {
    await projection.close()
  }
})
