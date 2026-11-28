import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import type {
  ConversationId,
  ConversationView,
  EntryId,
  EntryRecord,
  LiveState,
  TaskId
} from '@earendil-works/pi-durable'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

import { isLivePartInput, runtimeId, ThreadFeed, type ObservationPayload } from '@cherrystudio/agent-runtime'

import { previewTextAppends } from '../src/previewTextAppends'
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
const live = (attempt = 1): LiveState => ({
  run: { taskId, inputs: [], turns: 0 },
  generation: { attempt, message: JSON.parse(JSON.stringify(fauxAssistantMessage('same text'))) }
})

it('renders committed and live assistant content without reading archive response IDs', () => {
  const active = live()
  const assistant = (text: string) =>
    Object.defineProperty(
      { ...active.generation!.message!, content: [{ type: 'text' as const, text }] },
      'responseId',
      {
        get() {
          throw new Error('Only an archive read needs the provider response ID')
        }
      }
    )
  const entries = [{ ...entry(1, ''), model: [assistant('committed')] }]
  const { projection } = setup(view(entries, { ...active, generation: { attempt: 1, message: assistant('first') } }))
  const corrected = view(entries, { ...active, generation: { attempt: 1, message: assistant('corrected') } })

  expect(
    projection.updatePreviewParts(taskId, 1, [
      { index: 0, part: (corrected.docs['pi.live'] as LiveState).generation!.message!.content[0] }
    ])
  ).toBe(true)
  expect(projection.feed.snapshot.messages.map((message) => message.parts)).toEqual([
    [{ type: 'text', text: 'committed', state: 'done' }],
    [{ type: 'text', text: 'corrected', state: 'streaming' }]
  ])
})

it('restores input history in one snapshot and resumes only the unfinished placed input', async () => {
  const projection = new DurableProjection({ backendId: runtimeId('backend'), id: runtimeId('1') }, (error) => {
    throw error
  })
  onTestFinished(() => projection.close())
  const events: ObservationPayload[] = []
  const feed = projection.feed.observe((event) => {
    events.push(event)
  })
  const active = runtimeId<'input'>('active')
  projection.update(view([], live()), {
    type: 'snapshot',
    inputs: [
      { inputId: runtimeId('finished'), facts: ['placed'], outcome: 'completed' },
      { inputId: active, facts: ['placed'] },
      { inputId: runtimeId('next'), facts: ['queued'] }
    ]
  })
  const batches: DurableObservation[] = []
  const observation = projection.observe((batch) => {
    batches.push(batch)
  })
  await feed.drain()
  await observation.drain()
  expect(events.filter((event) => event.type === 'input.changed')).toEqual([])
  expect(projection.feed.snapshot.inputs.map((input) => input.inputId)).toEqual(['finished', active, 'next'])
  expect(batches[0]?.resumedInput).toBe(active)
})

it('reuses the prior preview when a restarted task replays the same generation attempt', async () => {
  const active = runtimeId<'input'>('active')
  const { projection } = setup(view([]))
  projection.update(view([], live()), {
    type: 'snapshot',
    inputs: [{ inputId: active, facts: ['placed'] }]
  })
  const [message] = projection.feed.snapshot.messages
  const savedPreview = 'live:previous-process:7:1:1'
  const observed: DurableObservation[] = []
  const subscription = projection.observe(
    (batch) => {
      observed.push(batch)
    },
    ['live:previous-process:6:1:1', savedPreview]
  )
  await subscription.drain()

  expect(observed[0]?.aliases).toEqual({ [message.id]: savedPreview })
  expect(observed[0]?.live).toEqual([message.id])
})

it('reconciles an interrupted preview after restart while retaining repeated committed text', async () => {
  const active = runtimeId<'input'>('active')
  const user: EntryRecord = {
    id: 1 as EntryId,
    conversationId,
    kind: 'cherry.user-input',
    data: { cherryInputId: active },
    model: [{ role: 'user', content: 'Start work', timestamp: 0 }]
  }
  const interrupted: EntryRecord = {
    ...entry(3, 'Repeated'),
    model: [{ ...fauxAssistantMessage('Repeated'), stopReason: 'aborted' }]
  }
  const { projection } = setup(view([]))
  projection.update(view([user, entry(2, 'Repeated'), interrupted, entry(4, 'Repeated')], { run: live().run }), {
    type: 'snapshot',
    inputs: [{ inputId: active, facts: ['placed'] }]
  })
  const savedPreview = 'live:previous-process:7:1:1'
  const observed: DurableObservation[] = []
  const subscription = projection.observe(
    (batch) => {
      observed.push(batch)
    },
    ['entry:2:0', savedPreview]
  )
  await subscription.drain()

  expect(observed[0]?.aliases).toEqual({ 'entry:3:0': savedPreview })
  expect(observed[0]?.live).toEqual(['entry:2:0', 'entry:3:0', 'entry:4:0'])
})

it.each([0, 32, 1024])(
  'relays ordered text edits without reading a cumulative source with %i settled parts',
  async (count) => {
    const { projection, errors } = setup(view([]))
    const frames: DurableObservation[] = []
    const subscription = projection.observe((frame) => {
      frames.push(frame)
    })
    const ref = { session: projection.ref, id: runtimeId<'item'>('source') }
    projection.feed.publish({
      type: 'message.reconcile',
      message: {
        id: ref.id,
        role: 'assistant',
        parts: Array.from({ length: count }, () => ({ type: 'text', state: 'done', text: 'settled' }))
      }
    })
    await subscription.drain()
    frames.length = 0
    const read = vi.spyOn(projection.feed, 'message').mockImplementation(() => {
      throw new Error('Live edit read the entire source')
    })
    const snapshot = vi.spyOn(projection.feed, 'snapshot', 'get').mockImplementation(() => {
      throw new Error('Live edit read the entire thread')
    })
    try {
      const providerMetadata = { pi: { startedAt: 17 } }
      projection.feed.publishPart({
        type: 'message.parts',
        ref,
        changes: [
          { type: 'open', part: count, kind: 'reasoning', providerMetadata },
          { type: 'append', part: count, text: '思考' },
          { type: 'finish', part: count }
        ]
      })
      await subscription.drain()
      expect(frames.map((frame) => frame.events)).toEqual([
        [
          { type: 'message.text-open', ref, part: count, kind: 'reasoning', providerMetadata },
          { type: 'message.text-append', ref, part: count, text: '思考' },
          { type: 'message.text-finish', ref, part: count }
        ]
      ])
      expect(errors).toEqual([])
    } finally {
      read.mockRestore()
      snapshot.mockRestore()
    }
    expect(projection.feed.message(ref.id)?.parts[count]).toMatchObject({
      type: 'reasoning',
      text: '思考',
      state: 'done'
    })
  }
)

it('publishes admission and input facts without reading the transcript', async () => {
  const current = view([entry(1, 'Settled')])
  const { projection, events } = setup(current)
  Object.defineProperty(current, 'entries', {
    get() {
      throw new Error('An input fact must not read the transcript')
    }
  })
  const inputId = runtimeId<'input'>('queued')
  projection.beginAdmission(inputId)
  projection.input({ inputId, facts: ['accepted', 'queued'] })
  projection.endAdmission(inputId, true)
  await expect
    .poll(() => events.at(-1))
    .toMatchObject({
      type: 'input.changed',
      input: { inputId, facts: ['accepted', 'queued'] }
    })
  expect(events.filter((event) => event.type === 'snapshot')).toHaveLength(1)
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
    projection.appendPreview(taskId, (next.docs['pi.live'] as LiveState).generation!.attempt, [
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

it('opens a preview block without reading committed entries or publishing a message', async () => {
  const entries = [entry(1, 'Earlier')]
  const { projection, events } = setup(view(entries, live()))
  const before = projection.feed.snapshot
  const state = live()
  state.generation!.message!.content.push({ type: 'thinking', thinking: 'Working' })
  const next = view(entries, state)
  Object.defineProperty(next, 'entries', {
    get() {
      throw new Error('A generation block change must not read committed entries')
    }
  })
  expect(
    projection.updatePreviewParts(taskId, 1, [
      { index: 1, part: (next.docs['pi.live'] as LiveState).generation!.message!.content[1] }
    ])
  ).toBe(true)
  await expect.poll(() => events.slice(1).map((event) => event.type)).toEqual(['message.parts'])
  expect(projection.feed.snapshot.messages[0]).toBe(before.messages[0])
  expect(projection.feed.snapshot.messages[1].parts[1]).toEqual({
    type: 'reasoning',
    text: 'Working',
    state: 'streaming'
  })
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
  expect(settled[1]).toEqual(initial[1])
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
    await expect.poll(() => events.some((event) => event.type === 'message.reconcile')).toBe(true)
    expect(events.filter((event) => event.type === 'message.remove')).toEqual([])
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'message.reconcile',
        replaces: [{ session: { backendId: runtimeId('backend'), id: runtimeId('1') }, id: preview }]
      })
    )
    expect(projection.feed.snapshot.messages).toMatchObject([
      { id: 'entry:10:0', parts: [{ text: 'committed answer' }] }
    ])
    expect(projection.feed.snapshot.messages).toHaveLength(1)
  })

  it('finishes an unchanged preview by its native block before binding the committed alias', async () => {
    const { projection, update, events } = setup(view([], live()))
    const preview = projection.feed.snapshot.messages[0].id
    update(view([entry(10, 'same text')]))
    await expect
      .poll(() => events.find((event) => event.type === 'message.text-finish'))
      .toMatchObject({ ref: { id: preview }, part: 0 })
    expect(projection.feed.snapshot.messages[0]?.parts).toEqual([{ type: 'text', text: 'same text', state: 'done' }])
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

  it('places a repeated nested call in its current parent message', () => {
    const call = fauxToolCall('script', {}, { id: 'parent' })
    const first = { ...entry(1, ''), model: [fauxAssistantMessage(call)] }
    const second = { ...entry(3, ''), model: [fauxAssistantMessage([{ type: 'text', text: 'next' }, call])] }
    const result = (id: number, text: string): EntryRecord => ({
      ...entry(id, ''),
      kind: 'pi.tool-result',
      model: [
        {
          role: 'toolResult',
          toolCallId: 'parent',
          toolName: 'script',
          content: [{ type: 'text', text }],
          nestedCalls: { complete: true, calls: [{ id: 'parent/key', name: 'read', status: 'ok', result: text }] },
          isError: false,
          timestamp: 0
        }
      ]
    })
    const saved = [first, result(2, 'first')]
    const { projection, update } = setup(view(saved))
    const previous = projection.feed.snapshot.messages[0]
    update(view([...saved, second, result(4, 'second')]))

    const [older, newer] = projection.feed.snapshot.messages
    expect(older).toBe(previous)
    expect(older.parts[1]).toMatchObject({ toolCallId: 'parent/key', output: 'first' })
    expect(newer.parts).toMatchObject([
      { type: 'text', text: 'next' },
      { toolCallId: 'parent', state: 'output-available' },
      { toolCallId: 'parent/key', output: 'second' }
    ])
  })

  it.each([
    [false, 'ok'],
    [true, 'ok'],
    [false, 'error'],
    [true, 'error']
  ] as const)(
    'shares a detached nested result with its parent evidence (parent failed=%s, child=%s)',
    (isError, status) => {
      const evidence = { rows: ['saved'] }
      const parent = { ...entry(1, ''), model: [fauxAssistantMessage(fauxToolCall('script', {}, { id: 'parent' }))] }
      const result: EntryRecord = {
        ...entry(2, ''),
        model: [
          {
            role: 'toolResult',
            toolCallId: 'parent',
            toolName: 'script',
            content: [{ type: 'text', text: 'finished' }],
            nestedCalls: { complete: true, calls: [{ id: 'parent/key', name: 'read', status, result: evidence }] },
            isError,
            timestamp: 0
          }
        ]
      }
      const { projection } = setup(view([parent, result]))
      const [outer, inner] = projection.feed.snapshot.messages[0].parts
      if (inner.type !== 'dynamic-tool' || outer.type !== 'dynamic-tool')
        throw new Error('Missing projected tool results')
      const output = outer.state === 'output-error' ? outer.resultProviderMetadata?.pi?.result : outer.output
      const retained = output as { nestedCalls: { calls: { result: unknown }[] } }
      evidence.rows.push('changed')
      const nested = inner.state === 'output-error' ? inner.resultProviderMetadata?.pi?.result : inner.output
      expect(nested).toEqual({ rows: ['saved'] })
      expect(retained.nestedCalls.calls[0].result).toBe(nested)
    }
  )

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
    await expect.poll(() => events.some((event) => event.type === 'message.reconcile')).toBe(true)
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
    projection.update(initial, {
      type: 'snapshot',
      inputs: [
        {
          inputId,
          facts: status === 'queued' ? ['accepted', 'queued'] : ['accepted', 'placed'],
          ...(status === 'completed' && { outcome: 'completed' })
        }
      ]
    })
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
      const edits = batches
        .slice(1)
        .flatMap((batch) =>
          batch.events.flatMap((event) =>
            event.type === 'message.parts' && batch.live.includes(event.ref.id) && event.ref.id === 'entry:11:0'
              ? event.changes
              : []
          )
        )
      expect(edits).toContainEqual(
        expect.objectContaining({
          type: 'put',
          value: expect.objectContaining({
            toolCallId: 'read-page',
            state: 'output-available',
            output: expect.objectContaining({ content: [{ type: 'text', text: 'restored page' }] })
          })
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
  const liveIds = new Set(batches.slice(1).flatMap((batch) => batch.live))
  const delivered = replayed(batches.map((batch) => batch.events).flat()).messages.filter((message) =>
    liveIds.has(message.id)
  )
  expect(delivered).toMatchObject([{ id: 'entry:11:0', parts: [{ type: 'text', text: 'recovered final answer' }] }])
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
  for (const event of events)
    if (isLivePartInput(event)) feed.publishPart(event)
    else feed.publish(event)
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
      'message.parts',
      'message.reconcile',
      'message.reconcile',
      'message.parts'
    ])
    expect(events[1]).toMatchObject({ changes: [{ type: 'append', part: 0, text: ', longer' }] })
    expect(events[3]).toMatchObject({
      message: { id: 'entry:10:0' },
      replaces: [{ id: events[2].type === 'message.reconcile' && events[2].message.id }]
    })
    expect(events[4]).toMatchObject({
      ref: { id: 'entry:10:0' },
      changes: [{ type: 'put', part: 0, value: { toolCallId: 'call', state: 'output-available' } }]
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
    projection.update(view([]), { type: 'commit', revision: 1, changes: [{ inputId, facts: ['accepted', 'queued'] }] })
    projection.update(view([]), {
      type: 'commit',
      revision: 2,
      changes: [{ inputId, facts: ['accepted', 'placed'], outcome: 'completed' }]
    })
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

it.each([
  [20, 20],
  [20_000, 20],
  [20, 20_000]
])(
  'applies a native append over %i entries and %i earlier blocks without reading their contents',
  async (history, siblings) => {
    const entries = Array.from({ length: history }, (_, i) => entry(i + 1, 'earlier'))
    const state = live()
    state.generation!.message!.content = Array.from({ length: siblings + 1 }, () => ({ type: 'text', text: 'a' }))
    const { projection } = setup(view(entries, state))
    const events: ObservationPayload[] = []
    const sub = projection.observe((batch) => {
      events.push(...batch.events)
    })
    await sub.drain()
    events.length = 0
    let historyReads = 0
    const next = view(entries, state)
    Object.defineProperty(next, 'entries', {
      get() {
        historyReads++
        return entries
      }
    })
    const touches = vi.spyOn(projection.feed, 'part')
    const full = vi.spyOn(projection.feed, 'message')
    const readBaseline = vi.spyOn(projection.feed, 'snapshot', 'get')
    const edits = previewTextAppends([
      ['a', ['docs', 'pi.live', 'generation', 'message', 'content', siblings, 'text'], 'b']
    ])
    expect(projection.appendPreview(taskId, (next.docs['pi.live'] as LiveState).generation!.attempt, edits!)).toBe(true)
    await sub.drain()
    expect(events).toMatchObject([{ type: 'message.text-append', part: siblings, text: 'b' }])
    expect(new Set(touches.mock.calls.map(([, index]) => index))).toEqual(new Set([siblings]))
    expect(touches.mock.calls.length).toBeLessThanOrEqual(2)
    expect(historyReads).toBe(0)
    expect(full).not.toHaveBeenCalled()
    expect(readBaseline).not.toHaveBeenCalled()
    await sub.stop()
  }
)

it('retains exact input answer positions while another native Run remains active and on reattachment', async () => {
  const { projection } = setup(view([], live()))
  const frames: DurableObservation[] = []
  const observer = projection.observe((frame) => {
    frames.push(frame)
  })
  const inputId = runtimeId<'input'>('answered-input')
  projection.update(view([entry(11, 'A final answer')], live()), {
    type: 'commit',
    revision: 1,
    changes: [{ inputId, facts: ['accepted', 'placed'], outcome: 'completed' }],
    answers: [{ inputId, entryId: '11' }]
  })
  await vi.waitFor(() =>
    expect(frames.some((frame) => frame.answers?.some((answer) => answer.entryId === '11'))).toBe(true)
  )
  expect(frames.every((frame) => !frame.completion)).toBe(true)
  await observer.stop()
  const reopened: DurableObservation[] = []
  const reattached = projection.observe((frame) => {
    reopened.push(frame)
  })
  await vi.waitFor(() => expect(reopened[0]?.answers).toEqual([{ inputId, entryId: '11' }]))
  await reattached.stop()
})
