import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai'
import type {
  ConversationId,
  ConversationView,
  ConversationWatch,
  EntryId,
  EntryRecord,
  LiveState,
  TaskId
} from '@earendil-works/pi-durable'
import { describe, expect, it, onTestFinished } from 'vitest'

import { runtimeId, type ObservationPayload } from '@cherrystudio/agent-runtime'

import { DurableProjection } from '../src/projection'

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
  let listener!: Parameters<ConversationWatch['start']>[0]
  const watch: ConversationWatch = {
    value: initial,
    start: (use) => {
      listener = use
    },
    stop: async () => ({ reason: 'stopped' }),
    closed: new Promise(() => {})
  }
  const errors: unknown[] = []
  const projection = new DurableProjection({ backendId: runtimeId('backend'), id: runtimeId('1') }, watch, (error) =>
    errors.push(error)
  )
  const events: ObservationPayload[] = []
  projection.feed.observe((event) => {
    events.push(event)
  })
  onTestFinished(() => projection.close())
  return { projection, events, errors, update: (next: ConversationView) => listener(next, [], BACKGROUND_CONTEXT) }
}
const live = (attempt = 1): LiveState => ({
  run: { taskId, inputs: [] },
  generation: { attempt, message: JSON.parse(JSON.stringify(fauxAssistantMessage('same text'))) }
})

describe('Durable preview identity', () => {
  it('keeps a preview stable when unrelated entries arrive and associates only its producing task', async () => {
    const { projection, update } = setup(view([], live()))
    const preview = projection.feed.snapshot.items[0].ref.id
    await update(view([entry(10, 'same text', 8 as TaskId)], live()))
    expect(projection.feed.snapshot.items.at(-1)?.ref.id).toBe(preview)
    await update(view([entry(10, 'same text', 8 as TaskId), entry(11, 'same text')]))
    expect(projection.aliases).toEqual({ 'entry:11:0': preview })
    expect(projection.feed.snapshot.items).toHaveLength(2)
  })

  it('reports a gap instead of guessing when a coalesced frame contains two candidate answers', async () => {
    const { projection, update, events } = setup(view([], live()))
    await update(view([entry(10, 'same text'), entry(11, 'same text')]))
    await expect.poll(() => events.some((event) => event.type === 'gap' && event.reason === 'mapping-reset')).toBe(true)
    expect(projection.aliases).toEqual({})
    expect(projection.feed.snapshot.items).toHaveLength(2)
  })

  it('does not bind a preview to a head entry already present before that preview', async () => {
    const entries = [{ ...entry(10, 'same text'), head: 5 as EntryId }, entry(5, 'earlier', 8 as TaskId)]
    const { projection, update, events } = setup(view(entries, live()))
    await update(view(entries))
    await expect.poll(() => events.some((event) => event.type === 'gap' && event.reason === 'mapping-reset')).toBe(true)
    expect(projection.aliases).toEqual({})
  })

  it('never associates an unobserved retry with the previous attempt', async () => {
    const { projection, update, events } = setup(view([], live()))
    await update(view([], live(2)))
    const retry = projection.feed.snapshot.items[0].ref.id
    await update(view([entry(10, 'same text')]))
    await expect.poll(() => events.some((event) => event.type === 'gap')).toBe(true)
    expect(projection.aliases).toEqual({ 'entry:10:0': retry })
  })

  it('carries tool call and progress identities into their committed items', async () => {
    const message = fauxAssistantMessage(fauxToolCall('echo', {}, { id: 'call' }), { stopReason: 'toolUse' })
    const { projection, update } = setup(
      view([], { ...live(), generation: { attempt: 1, message: JSON.parse(JSON.stringify(message)) } })
    )
    const preview = projection.feed.snapshot.items.find((item) => item.type === 'tool-call')!.ref.id
    const assistant: EntryRecord = { ...entry(10, ''), model: [message] }
    await update(
      view([assistant], {
        run: { taskId, inputs: [] },
        tools: [{ callId: 'call', name: 'echo', status: 'running', taskId: 8 as TaskId, output: 'partial' }]
      })
    )
    const progress = projection.feed.snapshot.items.find((item) => item.type === 'tool-result')!.ref.id
    await update(
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
    expect(projection.aliases['entry:10:0:call:call']).toBe(preview)
    expect(projection.aliases['entry:11:0']).toBe(progress)
    expect(projection.feed.snapshot.items.at(-1)).toMatchObject({
      type: 'tool-result',
      call: { id: 'entry:10:0:call:call' },
      parts: [{ type: 'text', text: 'finished' }]
    })
  })
})
