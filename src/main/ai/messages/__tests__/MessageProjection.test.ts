import { afterEach, expect, it, vi } from 'vitest'

import {
  applyMessageProjectionUpdate,
  type MessageProjectionUpdate,
  type TopicProjectionState
} from '@shared/ai/messageProjection'
import type { CherryUIMessage } from '@shared/data/types/message'

import { MessageProjection } from '../MessageProjection'

const msg = (text: string): CherryUIMessage => ({ id: 'm', role: 'assistant', parts: [{ type: 'text', text }] })
const state: TopicProjectionState = { kind: 'topic', topicId: 'root', executions: [] }
afterEach(() => vi.useRealTimers())

// A dropped coalesced batch must never create an undetectable hole in the receiver's revision sequence.
it('numbers published batches, emits suffixes, and retains immutable baselines', () => {
  vi.useFakeTimers()
  const projection = new MessageProjection<TopicProjectionState>({ ...state, messages: [msg('A')] })
  const baseline = projection.snapshot()
  const updates: MessageProjectionUpdate<TopicProjectionState>[] = []
  projection.subscribe((update) => updates.push(update))
  projection.update({ ...state, messages: [msg('AB')] })
  projection.update({ ...state, messages: [msg('ABC')] })
  vi.advanceTimersByTime(80)
  expect(updates).toHaveLength(1)
  expect(updates[0]).toMatchObject({ revision: 1, patches: [{ type: 'append', text: 'BC' }] })
  expect(applyMessageProjectionUpdate(baseline, updates[0])?.messages[0].parts).toEqual(msg('ABC').parts)
  expect(baseline.messages[0].parts).toEqual(msg('A').parts)
  projection.update({ ...state, messages: [msg('ABCD')] })
  const latest = projection.snapshot()
  expect(latest.revision).toBe(2)
  expect(latest.messages[0].parts).toEqual(msg('ABCD').parts)
  projection.dispose()
})

// Partial application would corrupt the next valid revision, even if recovery later succeeds.
it('rejects a gap or invalid append without mutating the previous view', () => {
  const projection = new MessageProjection<TopicProjectionState>({ ...state, messages: [msg('A')] })
  const baseline = projection.snapshot()
  const update: MessageProjectionUpdate<TopicProjectionState> = {
    ...state,
    revision: 1,
    patches: [
      { type: 'append', messageId: 'm', part: 0, text: 'B' },
      { type: 'append', messageId: 'missing', part: 0, text: 'bad' }
    ],
    order: ['m']
  }
  expect(applyMessageProjectionUpdate(baseline, update)).toBeUndefined()
  expect(applyMessageProjectionUpdate(baseline, { ...update, revision: 2 })).toBeUndefined()
  expect(baseline.messages[0].parts).toEqual(msg('A').parts)
})

it('isolates a broken subscriber and orders replacements and removals', () => {
  const projection = new MessageProjection<TopicProjectionState>({ ...state, messages: [msg('A')] })
  let view = projection.snapshot()
  projection.subscribe(() => {
    throw new Error('closed window')
  })
  projection.subscribe((update) => {
    view = applyMessageProjectionUpdate(view, update)!
  })
  projection.update({ ...state, messages: [{ ...msg('new'), id: 'other' }, msg('replacement')] }, true)
  expect(view.messages.map((message) => message.id)).toEqual(['other', 'm'])
  projection.update({ ...state, messages: [msg('only')] }, true)
  expect(view.messages.map((message) => message.id)).toEqual(['m'])
  expect(view.messages[0].parts).toEqual(msg('only').parts)
})

it('reuses unchanged history and tool parts while isolating mutations to new producer values', () => {
  const history = { ...msg('history'), id: 'history' }
  const tool: CherryUIMessage['parts'][number] = {
    type: 'dynamic-tool',
    toolName: 'read',
    toolCallId: 'call',
    state: 'output-available',
    input: {},
    output: { rows: ['large saved output'] }
  }
  const message: CherryUIMessage = { ...msg('A'), parts: [tool, { type: 'text', text: 'A' }] }
  const projection = new MessageProjection<TopicProjectionState>({ ...state, messages: [history, message] })
  const before = projection.snapshot()
  message.parts[1] = { type: 'text', text: 'AB' }
  projection.update({ ...state, messages: [history, message] }, true)
  const after = projection.snapshot()
  expect(after.messages[0]).toBe(before.messages[0])
  expect(after.messages[1].parts[0]).toBe(before.messages[1].parts[0])
  expect(before.messages[1].parts[1]).toEqual({ type: 'text', text: 'A' })
  message.parts[1] = { type: 'text', text: 'caller edit' }
  tool.output = { rows: ['caller edit'] }
  expect(after.messages[1].parts[1]).toEqual({ type: 'text', text: 'AB' })
  expect(after.messages[1].parts[0]).toMatchObject({ output: { rows: ['large saved output'] } })
  projection.dispose()
})

it('captures only the latest unobserved update when a baseline is requested', () => {
  const projection = new MessageProjection<TopicProjectionState>({ ...state, messages: [] })
  let reads = 0
  for (const text of ['A', 'AB', 'ABC'])
    projection.update(() => {
      reads++
      return { ...state, messages: [msg(text)] }
    })
  expect(reads).toBe(0)
  expect(projection.snapshot().messages[0].parts).toEqual(msg('ABC').parts)
  expect(reads).toBe(1)
  projection.dispose()
})
