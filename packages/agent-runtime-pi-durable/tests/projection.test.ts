import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import type {
  ConversationId,
  ConversationView,
  EntryId,
  EntryRecord,
  LiveState,
  TaskId
} from '@earendil-works/pi-durable'
import { describe, expect, it, onTestFinished } from 'vitest'

import { runtimeId, ThreadFeed, type ObservationPayload } from '@cherrystudio/agent-runtime'

import { DurableProjection, type DurableObservation } from '../src/projection'

const conversationId = 1 as ConversationId
const taskId = 7 as TaskId
const entry = (id: number, text: string, byTaskId = taskId): EntryRecord => ({
  id: id as EntryId,
  conversationId,
  kind: 'pi.assistant',
  byTaskId,
  model: [fauxAssistantMessage(text)]
})
const view = (entries: readonly EntryRecord[], live: LiveState = {}): ConversationView => ({
  conversation: { id: conversationId },
  entries,
  docs: { 'pi.live': live }
})
function setup(initial: ConversationView) {
  const errors: unknown[] = []
  const projection = new DurableProjection({ backendId: runtimeId('backend'), id: runtimeId('1') }, (error) =>
    errors.push(error)
  )
  projection.update(initial)
  const events: ObservationPayload[] = []
  projection.feed.observe((event) => {
    events.push(event)
  })
  onTestFinished(() => projection.close())
  return { projection, events, errors, update: (next: ConversationView) => projection.update(next) }
}
/** Messages each batch delivers as live product content. */
const liveMessages = (batches: readonly DurableObservation[]) =>
  batches.flatMap((batch) =>
    batch.events.flatMap((event) =>
      (event.type === 'snapshot' ? event.messages : event.type === 'message.upsert' ? [event.message] : []).filter(
        (message) => batch.live.includes(message.id)
      )
    )
  )
const live = (attempt = 1): LiveState => ({
  run: { taskId, inputs: [], turns: 0 },
  generation: { attempt, message: JSON.parse(JSON.stringify(fauxAssistantMessage('same text'))) }
})

it.each([0, 2048])('applies a native preview suffix with %i prior entries without reading them', async (count) => {
  const entries = Array.from({ length: count }, (_, index) => entry(index + 1, 'Settled'))
  const { projection, events } = setup(view(entries, live()))
  const before = projection.feed.snapshot
  const preview = before.messages.at(-1)!
  const next = view(entries, live())
  Object.defineProperty(next, 'entries', {
    get() {
      throw new Error('A text suffix must not read the transcript')
    }
  })
  expect(
    projection.appendPreview(next, [
      { part: 0, text: ' then' },
      { part: 0, text: ' suffix' }
    ])
  ).toBe(true)
  await expect
    .poll(() => events.filter((event) => event.type === 'message.text-append').map((event) => event.text))
    .toEqual([' then', ' suffix'])
  expect(projection.feed.snapshot.messages.at(-1)?.parts[0]).toMatchObject({ text: 'same text then suffix' })
  expect(preview.parts[0]).toMatchObject({ text: 'same text' })
})

it.each(['', 'partial answer'])('retains the provider failure alongside %j content', (text) => {
  const failure = {
    ...entry(10, text),
    model: [fauxAssistantMessage(text || [], { stopReason: 'error', errorMessage: '429: CONCURRENCY_LIMITED' })]
  }
  const { projection } = setup(view([failure]))
  expect(projection.feed.snapshot.messages[0]).toMatchObject({
    metadata: { error: { code: 'model-error', message: '429: CONCURRENCY_LIMITED' } }
  })
  expect(projection.feed.snapshot.messages[0].parts).toEqual(text ? [{ type: 'text', text, state: 'done' }] : [])
})

it('retains every failed attempt when a later attempt succeeds', () => {
  const failed = (id: number, byTaskId: TaskId): EntryRecord => ({
    ...entry(id, '', byTaskId),
    model: [fauxAssistantMessage([], { stopReason: 'error', errorMessage: '429: CONCURRENCY_LIMITED' })]
  })
  const entries = [failed(10, 8 as TaskId), failed(11, taskId), failed(12, taskId)]
  const { projection, update } = setup(view(entries))
  const before = projection.feed.snapshot.messages
  expect(before.slice(0, 3).every((message) => message.metadata?.error?.message === '429: CONCURRENCY_LIMITED')).toBe(
    true
  )
  update(view([...entries, entry(13, 'Recovered')]))
  expect(projection.feed.snapshot.messages[0]).toMatchObject({
    metadata: { error: { message: '429: CONCURRENCY_LIMITED' } }
  })
  expect(projection.feed.snapshot.messages.slice(0, 3)).toEqual(before)
  expect(projection.feed.snapshot.messages[3].parts).toEqual([{ type: 'text', text: 'Recovered', state: 'done' }])
  expect(before[2]).toMatchObject({ metadata: { error: { message: '429: CONCURRENCY_LIMITED' } } })
})

it('keeps complete isolated history when updating a view without observers', () => {
  const projection = new DurableProjection({ backendId: runtimeId('backend'), id: runtimeId('1') }, (error) => {
    throw error
  })
  const entries = Array.from({ length: 32 }, (_, index) => entry(index + 1, `saved-${index}`))
  projection.update(view(entries))
  const previous = projection.feed.snapshot
  expect(() => {
    previous.messages[0].parts.length = 0
  }).toThrow(TypeError)
  projection.update(view([...entries, entry(33, 'new')]))
  expect(projection.feed.snapshot.messages.map((message) => message.parts)).toEqual([
    ...Array.from({ length: 32 }, (_, index) => [{ type: 'text', text: `saved-${index}`, state: 'done' }]),
    [{ type: 'text', text: 'new', state: 'done' }]
  ])
  expect(previous.messages).toHaveLength(32)
  previous.messages.forEach((message, index) => expect(projection.feed.snapshot.messages[index]).toBe(message))
  onTestFinished(() => projection.close())
})

it('copies only messages that live progress or a later result changes, and rebuilds after compaction', () => {
  const call = fauxAssistantMessage(fauxToolCall('echo', {}, { id: 'call' }), { stopReason: 'toolUse' })
  const before = entry(9, 'before')
  const assistant: EntryRecord = { ...entry(10, ''), model: [call] }
  const result: EntryRecord = {
    id: 11 as EntryId,
    conversationId,
    kind: 'pi.tool_result',
    byTaskId: 8 as TaskId,
    model: [
      {
        role: 'toolResult',
        toolCallId: 'call',
        toolName: 'echo',
        content: [{ type: 'text', text: 'finished' }],
        isError: false,
        timestamp: 0
      }
    ]
  }
  const { projection, update } = setup(view([before, assistant]))
  const initial = projection.feed.snapshot.messages
  update(
    view([before, assistant], {
      run: { taskId, inputs: [], turns: 0 },
      tools: [{ callId: 'call', name: 'echo', status: 'running', taskId: 8 as TaskId, output: 'partial' }]
    })
  )
  const progressed = projection.feed.snapshot.messages
  update(view([before, assistant]))
  const settled = projection.feed.snapshot.messages
  update(view([before, assistant, result]))
  const finished = projection.feed.snapshot.messages

  expect(progressed[0]).toBe(initial[0])
  expect(finished[0]).toBe(initial[0])
  expect(progressed[1].parts[0]).toMatchObject({ output: { content: [{ text: 'partial' }] }, preliminary: true })
  expect(settled[1]).toBe(initial[1])
  expect(initial[1].parts[0]).toMatchObject({ toolCallId: 'call', state: 'input-available' })
  expect(finished[1].parts[0]).toMatchObject({
    state: 'output-available',
    output: { content: [{ type: 'text', text: 'finished' }] },
    preliminary: false
  })

  update(view([entry(20, 'compacted')]))
  expect(projection.feed.snapshot.messages.map((message) => message.parts)).toEqual([
    [{ type: 'text', text: 'compacted', state: 'done' }]
  ])
})

describe('Durable preview identity', () => {
  it('replaces a live answer without publishing a retraction of its identity', async () => {
    const { projection, update, events } = setup(view([], live()))
    const preview = projection.feed.snapshot.messages[0].id
    update(view([entry(10, 'committed answer')]))
    await expect.poll(() => events.some((event) => event.type === 'message.upsert')).toBe(true)
    expect(events.filter((event) => event.type === 'message.remove')).toEqual([])
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'message.upsert',
        replaces: [{ session: { backendId: runtimeId('backend'), id: runtimeId('1') }, id: preview }]
      })
    )
    expect(projection.feed.snapshot.messages).toMatchObject([
      { id: 'entry:10:0', parts: [{ text: 'committed answer' }] }
    ])
    expect(projection.feed.snapshot.messages).toHaveLength(1)
  })

  it('keeps one nested call across repeated live views without parent progress', () => {
    const parent = {
      ...entry(10, ''),
      model: [fauxAssistantMessage(fauxToolCall('echo', {}, { id: 'parent' }), { stopReason: 'toolUse' })]
    }
    const active: LiveState = {
      run: { taskId, inputs: [], turns: 0 },
      nestedTools: [
        {
          parentCallId: 'parent',
          parentTaskId: taskId,
          taskId: 8 as TaskId,
          callId: 'child',
          name: 'read',
          status: 'running',
          arguments: {},
          output: 'first'
        }
      ]
    }
    const { projection, update } = setup(view([parent], active))
    for (const output of ['second', 'third', 'final']) {
      update(view([parent], { ...active, nestedTools: [{ ...active.nestedTools![0], output }] }))
      const parts = projection.feed.snapshot.messages[0].parts
      expect(parts).toHaveLength(2)
      expect(parts[1]).toMatchObject({ toolCallId: 'child', output: { content: [{ text: output }] } })
    }
  })

  it('reuses immutable committed results while publishing only the growing live message', async () => {
    const assistant = {
      ...entry(10, ''),
      model: [fauxAssistantMessage(fauxToolCall('echo', {}, { id: 'call' }), { stopReason: 'toolUse' })]
    }
    const block = { type: 'text' as const, text: 'accepted result' }
    const result: EntryRecord = {
      ...entry(11, ''),
      model: [
        { role: 'toolResult', toolCallId: 'call', toolName: 'echo', content: [block], isError: false, timestamp: 0 }
      ]
    }
    const entries = [assistant, result]
    const { projection, update, events } = setup(view(entries, live()))
    const before = projection.feed.snapshot.messages[0].parts[0]
    Object.defineProperty(block, 'text', {
      get: () => {
        throw new Error('Text publication revisited a committed result')
      }
    })
    const active = live()
    if (!active.generation?.message) throw new Error('Missing live generation')
    update(
      view(entries, {
        ...active,
        generation: {
          ...active.generation,
          message: { ...active.generation.message, content: [{ type: 'text', text: 'new streamed text' }] }
        }
      })
    )
    await expect.poll(() => events.some((event) => event.type === 'message.upsert')).toBe(true)
    expect(events.filter((event) => event.type === 'snapshot')).toHaveLength(1)
    expect(projection.feed.snapshot.messages[0].parts[0]).toBe(before)
    expect(projection.feed.snapshot.messages.at(-1)?.parts).toMatchObject([{ text: 'new streamed text' }])
  })
  it('keeps a preview stable when unrelated entries arrive and associates only its producing task', () => {
    const { projection, update } = setup(view([], live()))
    const preview = projection.feed.snapshot.messages[0].id
    update(view([entry(10, 'same text', 8 as TaskId)], live()))
    expect(projection.feed.snapshot.messages.at(-1)?.id).toBe(preview)
    update(view([entry(10, 'same text', 8 as TaskId), entry(11, 'same text')]))
    expect(projection.aliases).toEqual({ 'entry:11:0': preview })
    expect(projection.feed.snapshot.messages).toHaveLength(2)
  })

  it('reports a gap instead of guessing when a coalesced frame contains two candidate answers', async () => {
    const { projection, update, events } = setup(view([], live()))
    update(view([entry(10, 'same text'), entry(11, 'same text')]))
    await expect.poll(() => events.some((event) => event.type === 'gap' && event.reason === 'mapping-reset')).toBe(true)
    expect(projection.aliases).toEqual({})
    expect(projection.feed.snapshot.messages).toHaveLength(2)
  })

  it('does not bind a preview to a head entry already present before that preview', async () => {
    const entries = [{ ...entry(10, 'same text'), head: 5 as EntryId }, entry(5, 'earlier', 8 as TaskId)]
    const { projection, update, events } = setup(view(entries, live()))
    update(view(entries))
    await expect.poll(() => events.some((event) => event.type === 'gap' && event.reason === 'mapping-reset')).toBe(true)
    expect(projection.aliases).toEqual({})
  })

  it('never associates an unobserved retry with the previous attempt', async () => {
    const { projection, update, events } = setup(view([], live()))
    update(view([], live(2)))
    const retry = projection.feed.snapshot.messages[0].id
    update(view([entry(10, 'same text')]))
    await expect.poll(() => events.some((event) => event.type === 'gap')).toBe(true)
    expect(projection.aliases).toEqual({ 'entry:10:0': retry })
  })

  it('carries tool call and progress identities into their committed items', () => {
    const message = fauxAssistantMessage(fauxToolCall('echo', {}, { id: 'call' }), { stopReason: 'toolUse' })
    const { projection, update } = setup(
      view([], { ...live(), generation: { attempt: 1, message: JSON.parse(JSON.stringify(message)) } })
    )
    const preview = projection.feed.snapshot.messages[0].id
    const assistant: EntryRecord = { ...entry(10, ''), model: [message] }
    update(
      view([assistant], {
        run: { taskId, inputs: [], turns: 0 },
        tools: [{ callId: 'call', name: 'echo', status: 'running', taskId: 8 as TaskId, output: 'partial' }]
      })
    )
    expect(projection.feed.snapshot.messages).toHaveLength(1)
    expect(projection.feed.snapshot.messages[0].parts[0]).toMatchObject({
      toolCallId: 'call',
      state: 'output-available',
      output: { content: [{ type: 'text', text: 'partial' }] },
      preliminary: true
    })
    update(
      view([
        assistant,
        {
          id: 11 as EntryId,
          conversationId,
          kind: 'pi.tool_result',
          byTaskId: 8 as TaskId,
          model: [
            {
              role: 'toolResult',
              toolCallId: 'call',
              toolName: 'echo',
              content: [{ type: 'text', text: 'finished' }],
              isError: false,
              timestamp: 0
            }
          ]
        }
      ])
    )
    expect(projection.aliases['entry:10:0']).toBe(preview)
    expect(projection.feed.snapshot.messages).toHaveLength(1)
    expect(projection.feed.snapshot.messages.at(-1)).toMatchObject({
      id: 'entry:10:0',
      parts: [
        {
          type: 'dynamic-tool',
          toolCallId: 'call',
          state: 'output-available',
          output: { content: [{ type: 'text', text: 'finished' }] },
          preliminary: false
        }
      ]
    })
  })
})

// Recovered live output must reach the product writer instead of becoming historical for the whole run.
it.each(['placed', 'completed', 'queued', 'ambiguous'] as const)(
  'restores committed tool output only for an unfinished placed input (%s)',
  async (status) => {
    const inputId = runtimeId<'input'>('recover-input')
    const input: EntryRecord = {
      ...entry(10, ''),
      kind: 'pi.user',
      data: { cherryInputId: inputId },
      model: [{ role: 'user', content: 'continue', timestamp: 1 }]
    }
    const call: EntryRecord = {
      ...entry(11, ''),
      model: [fauxAssistantMessage(fauxToolCall('read', { path: 'page.png' }, { id: 'read-page' }))]
    }
    const initial = view(
      [entry(5, 'previous answer'), ...(status === 'ambiguous' ? [{ ...input, id: 9 as EntryId }] : []), input, call],
      { run: { taskId, inputs: [], turns: 0 } }
    )
    const { projection } = setup(initial)
    projection.update(initial, 1, [
      {
        inputId,
        facts: status === 'queued' ? ['accepted', 'queued'] : ['accepted', 'placed'],
        ...(status === 'completed' && { outcome: 'completed' })
      }
    ])
    const batches: DurableObservation[] = []
    const observation = projection.observe((batch) => {
      batches.push(batch)
    })
    await observation.drain()
    const baseline = batches[0]
    const restored = baseline.events.flatMap((event) =>
      event.type === 'snapshot' ? event.messages.filter((message) => baseline.live.includes(message.id)) : []
    )
    expect(restored.map((message) => message.id)).toEqual(status === 'placed' ? ['entry:11:0'] : [])
    if (status === 'placed') {
      expect(restored[0].parts).toContainEqual(
        expect.objectContaining({ type: 'dynamic-tool', toolCallId: 'read-page', input: { path: 'page.png' } })
      )
      projection.update(
        view([
          ...initial.entries,
          {
            ...entry(12, ''),
            model: [
              {
                role: 'toolResult',
                toolCallId: 'read-page',
                toolName: 'read',
                content: [{ type: 'text', text: 'restored page' }],
                isError: false,
                timestamp: 2
              }
            ]
          }
        ])
      )
      await observation.drain()
      expect(liveMessages(batches.slice(1)).flatMap((message) => message.parts)).toContainEqual(
        expect.objectContaining({
          toolCallId: 'read-page',
          state: 'output-available',
          output: expect.objectContaining({ content: [{ type: 'text', text: 'restored page' }] })
        })
      )
    }
  }
)

it('keeps an active preview live when attaching midway through a generation', async () => {
  const { projection, update } = setup(view([entry(5, 'older committed answer')], live()))
  const batches: DurableObservation[] = []
  const observation = projection.observe((batch) => {
    batches.push(batch)
  })
  await observation.drain()
  const active = batches[0]
  expect(
    active.events
      .flatMap((event) =>
        event.type === 'snapshot' ? event.messages.filter((message) => active.live.includes(message.id)) : []
      )
      .flatMap((message) => message.parts)
  ).toContainEqual(expect.objectContaining({ type: 'text', text: 'same text' }))
  update(view([entry(5, 'older committed answer'), entry(11, 'recovered final answer')]))
  await observation.drain()
  const delivered = liveMessages(batches.slice(1))
  expect(delivered.flatMap((message) => message.parts)).toContainEqual(
    expect.objectContaining({ type: 'text', text: 'recovered final answer' })
  )
  expect(delivered.flatMap((message) => message.parts)).not.toContainEqual(
    expect.objectContaining({ type: 'text', text: 'older committed answer' })
  )
})

// A resumed native task can reuse its attempt number; it must not resurrect a source the product retired.
it('gives a returning preview a fresh identity after its previous instance committed', () => {
  const { projection, update } = setup(view([], live()))
  const interrupted = projection.feed.snapshot.messages[0].id
  update(view([entry(10, 'interrupted partial')]))
  update(view([entry(10, 'interrupted partial')], live()))
  const resumed = projection.feed.snapshot.messages.at(-1)!.id
  expect(resumed).not.toBe(interrupted)
  update(view([entry(10, 'interrupted partial'), entry(11, 'resumed final answer')]))
  expect(projection.aliases).toMatchObject({ 'entry:10:0': interrupted, 'entry:11:0': resumed })
})

/** The state an observer holds after applying its events in order. */
function replayed(events: readonly ObservationPayload[]) {
  const feed = new ThreadFeed(
    { type: 'snapshot', messages: [], inputs: [], activity: { state: 'unknown' } },
    (error) => {
      throw error
    }
  )
  for (const event of events) feed.publish(event)
  return feed.snapshot
}

describe('Durable observation deltas', () => {
  // Catches a delta stream that drops, reorders or duplicates a message, or keeps resending whole snapshots.
  it('sends only changed messages within a run and replays to the same view as a rebuild', async () => {
    const call = fauxAssistantMessage(fauxToolCall('echo', {}, { id: 'call' }), { stopReason: 'toolUse' })
    const older = entry(5, 'older')
    const assistant: EntryRecord = { ...entry(10, ''), model: [call] }
    const result: EntryRecord = {
      id: 11 as EntryId,
      conversationId,
      kind: 'pi.tool_result',
      byTaskId: 8 as TaskId,
      model: [{ role: 'toolResult', toolCallId: 'call', toolName: 'echo', content: [], isError: false, timestamp: 0 }]
    }
    const running = { run: { taskId, inputs: [], turns: 0 } }
    const { projection, events, update } = setup(view([older], live()))
    const generating = (text: string): LiveState => ({
      ...running,
      generation: { attempt: 1, message: JSON.parse(JSON.stringify(fauxAssistantMessage(text))) }
    })
    update(view([older], generating('same text, longer')))
    update(view([older], { ...running, generation: { attempt: 1, message: JSON.parse(JSON.stringify(call)) } }))
    update(view([older, assistant], running))
    update(view([older, assistant, result], running))
    await expect.poll(() => events.length).toBe(5)
    expect(events.map((event) => event.type)).toEqual([
      'snapshot',
      'message.upsert',
      'message.upsert',
      'message.upsert',
      'message.upsert'
    ])
    expect(events[3]).toMatchObject({
      message: { id: 'entry:10:0' },
      replaces: [{ id: events[2].type === 'message.upsert' && events[2].message.id }]
    })
    expect(replayed(events)).toEqual(projection.feed.snapshot)

    update(view([older, assistant, result]))
    await expect.poll(() => events.length).toBe(6)
    expect(events.at(-1)).toEqual({ type: 'activity.changed', activity: { state: 'idle' } })
    const rebuilt = new DurableProjection({ backendId: runtimeId('backend'), id: runtimeId('1') }, (error) => {
      throw error
    })
    onTestFinished(() => rebuilt.close())
    rebuilt.update(view([older, assistant, result]))
    expect(replayed(events)).toMatchObject({ messages: rebuilt.feed.snapshot.messages, activity: { state: 'idle' } })

    // Main begins an autonomous turn from one frame holding the run's inputs, activity and content.
    update(view([older, assistant, result], running))
    await expect.poll(() => events.length).toBe(7)
    expect(events.at(-1)).toMatchObject({ type: 'snapshot', activity: { state: 'active' } })
  })

  it('sends a snapshot right after a mapping reset', async () => {
    const { update, events } = setup(view([], live()))
    update(view([entry(10, 'same text'), entry(11, 'same text')], live(2)))
    await expect.poll(() => events.some((event) => event.type === 'gap')).toBe(true)
    const gap = events.findIndex((event) => event.type === 'gap')
    expect(events[gap + 1]?.type).toBe('snapshot')
  })

  // Catches a completion lost with the snapshot that used to carry it, or delivered before the input it reports.
  it('delivers completion on the last frame of its update', async () => {
    const { projection } = setup(view([]))
    const batches: DurableObservation[] = []
    const observation = projection.observe((batch) => {
      batches.push(batch)
    })
    const inputId = runtimeId<'input'>('quiet')
    projection.update(view([]), 1, [{ inputId, facts: ['accepted', 'queued'] }])
    projection.update(view([]), 2, [{ inputId, facts: ['accepted', 'placed'], outcome: 'completed' }])
    projection.beginAdmission(runtimeId<'input'>('admitted'))
    projection.endAdmission(runtimeId<'input'>('admitted'), true)
    await observation.drain()
    const completed = batches.filter((batch) => batch.completion)
    expect(completed.map((batch) => batch.events.map((event) => event.type))).toEqual([
      ['input.changed'],
      ['activity.changed']
    ])
    expect(completed[0].completion?.inputs).toMatchObject([{ inputId, outcome: 'completed' }])
    expect(batches.filter((batch) => batch.events.some((event) => event.type === 'snapshot'))).toHaveLength(1)
  })
})

it('does not project imported history twice when a continuation is appended', () => {
  const imported = { ...entry(1, 'Imported answer'), kind: 'cherry.imported-history' }
  const { projection, update } = setup(view([imported]))
  expect(projection.feed.snapshot.messages).toEqual([])
  update(view([imported, entry(2, 'New answer')]))
  expect(projection.feed.snapshot.messages).toHaveLength(1)
  expect(JSON.stringify(projection.feed.snapshot.messages)).toContain('New answer')
  expect(JSON.stringify(projection.feed.snapshot.messages)).not.toContain('Imported answer')
})
