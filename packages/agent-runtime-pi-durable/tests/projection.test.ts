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

import { runtimeId, type ObservationPayload } from '@cherrystudio/agent-runtime'

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

describe('Durable preview identity', () => {
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
  const final = batches.at(-1)!
  const delivered = final.events.flatMap((event) =>
    event.type === 'snapshot' ? event.messages.filter((message) => final.live.includes(message.id)) : []
  )
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
