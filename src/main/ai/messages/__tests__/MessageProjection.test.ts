import { setImmediate } from 'node:timers/promises'
import { setFlagsFromString } from 'node:v8'
import { runInNewContext } from 'node:vm'

import { afterEach, expect, it, vi } from 'vitest'

import {
  applyMessageProjectionUpdate,
  type StructuralProjectionUpdate,
  type TopicProjectionState
} from '@shared/ai/messageProjection'
import type { CherryUIMessage } from '@shared/data/types/message'

import { MessageProjection } from '../MessageProjection'

const msg = (text: string): CherryUIMessage => ({ id: 'm', role: 'assistant', parts: [{ type: 'text', text }] })
const state: TopicProjectionState = { kind: 'topic', topicId: 'root', executions: [] }
afterEach(() => vi.useRealTimers())

setFlagsFromString('--expose_gc')
const collectGarbage = runInNewContext('gc') as () => void
async function retainedHeap(): Promise<number> {
  await setImmediate()
  collectGarbage()
  await setImmediate()
  collectGarbage()
  return process.memoryUsage().heapUsed
}

it('isolates image parts without allocating one full image string per projection', async () => {
  const url = JSON.parse(JSON.stringify(`data:image/png;base64,${'A'.repeat(4 * 1024 * 1024)}`)) as string
  const source: CherryUIMessage = { id: 'image', role: 'user', parts: [{ type: 'file', mediaType: 'image/png', url }] }
  const before = await retainedHeap()
  const projections = Array.from({ length: 12 }, () => new MessageProjection({ ...state, messages: [source] }))
  const retained = (await retainedHeap()) - before
  source.parts.length = 0

  expect(
    projections.every((projection) => {
      const part = projection.snapshot().messages[0].parts[0]
      return part.type === 'file' && part.url === url
    })
  ).toBe(true)
  expect(retained).toBeLessThan(16 * 1024 * 1024)
  projections.forEach((projection) => projection.dispose())
})

// A dropped coalesced batch must never create an undetectable hole in the receiver's revision sequence.
it('numbers published batches, emits suffixes, and retains immutable baselines', () => {
  vi.useFakeTimers()
  const projection = new MessageProjection<TopicProjectionState>({ ...state, messages: [msg('A')] })
  const baseline = projection.snapshot()
  const updates: StructuralProjectionUpdate<TopicProjectionState>[] = []
  projection.subscribe((update) => {
    if (update.type === 'parts') throw new Error('Expected a structural update')
    updates.push(update)
  })
  projection.updateAccepted({ ...state, messages: [msg('AB')] })
  projection.updateAccepted({ ...state, messages: [msg('ABC')] })
  vi.advanceTimersByTime(80)
  expect(updates).toHaveLength(1)
  expect(updates[0]).toMatchObject({ revision: 1, patches: [{ type: 'append', text: 'BC' }] })
  expect(applyMessageProjectionUpdate(baseline, updates[0])?.messages[0].parts).toEqual(msg('ABC').parts)
  expect(baseline.messages[0].parts).toEqual(msg('A').parts)
  projection.updateAccepted({ ...state, messages: [msg('ABCD')] })
  const latest = projection.snapshot()
  expect(latest.revision).toBe(2)
  expect(latest.messages[0].parts).toEqual(msg('ABCD').parts)
  projection.dispose()
})

// Partial application would corrupt the next valid revision, even if recovery later succeeds.
it('rejects a gap or invalid append without mutating the previous view', () => {
  const projection = new MessageProjection<TopicProjectionState>({ ...state, messages: [msg('A')] })
  const baseline = projection.snapshot()
  const update: StructuralProjectionUpdate<TopicProjectionState> = {
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
    if (update.type === 'parts') throw new Error('Expected a structural update')
    view = applyMessageProjectionUpdate(view, update)!
  })
  projection.updateAccepted({ ...state, messages: [{ ...msg('new'), id: 'other' }, msg('replacement')] }, true)
  expect(view.messages.map((message) => message.id)).toEqual(['other', 'm'])
  projection.updateAccepted({ ...state, messages: [msg('only')] }, true)
  expect(view.messages.map((message) => message.id)).toEqual(['m'])
  expect(view.messages[0].parts).toEqual(msg('only').parts)
})

it('captures only the latest unobserved update when a baseline is requested', () => {
  const projection = new MessageProjection<TopicProjectionState>({ ...state, messages: [] })
  let reads = 0
  for (const text of ['A', 'AB', 'ABC'])
    projection.updateAccepted(() => {
      reads++
      return { ...state, messages: [msg(text)] }
    })
  expect(reads).toBe(0)
  expect(projection.snapshot().messages[0].parts).toEqual(msg('ABC').parts)
  expect(reads).toBe(1)
  projection.dispose()
})
// Text growth must not revisit settled output bodies or replace unaffected card/part identities.
it('publishes accepted text suffixes without traversing settled results or resending order', () => {
  const output = Object.defineProperty({}, 'body', {
    enumerable: true,
    get: () => {
      throw new Error('Unchanged output was traversed')
    }
  })
  const settled: CherryUIMessage = {
    id: 'tool',
    role: 'assistant',
    parts: [
      { type: 'dynamic-tool', toolCallId: 'call', toolName: 'Read', state: 'output-available', input: {}, output }
    ]
  }
  const projection = new MessageProjection<TopicProjectionState>({ ...state, messages: [] })
  projection.updateAccepted({ ...state, messages: [settled, msg('A')] }, true)
  const baseline = projection.snapshot()
  const updates: StructuralProjectionUpdate<TopicProjectionState>[] = []
  projection.subscribe((update) => {
    if (update.type === 'parts') throw new Error('Expected a structural update')
    updates.push(update)
  })
  projection.updateAccepted({ ...state, messages: [settled, msg('AB')] }, true)
  expect(updates[0].order).toBeUndefined()
  expect(updates[0].patches).toEqual([{ type: 'append', messageId: 'm', part: 0, text: 'B' }])
  const view = applyMessageProjectionUpdate(baseline, updates[0])!
  expect(view.messages[0]).toBe(baseline.messages[0])
  expect(view.messages[1].parts).toEqual(msg('AB').parts)
  projection.dispose()
})

// Replacement values may share an identical bounded preview, so a content patch alone cannot invalidate detail readers.
it('coalesces targeted result changes in the ordered batch even when the compact view is unchanged', () => {
  vi.useFakeTimers()
  const projection = new MessageProjection<TopicProjectionState>({ ...state, messages: [msg('same preview')] })
  const baseline = projection.snapshot()
  const updates: StructuralProjectionUpdate<TopicProjectionState>[] = []
  projection.subscribe((update) => {
    if (update.type === 'parts') throw new Error('Expected a structural update')
    updates.push(update)
  })
  const ref = { topicId: 'root', messageId: 'm', toolCallId: 'call' }
  projection.invalidateToolResults([ref])
  projection.invalidateToolResults([ref])
  vi.advanceTimersByTime(80)
  expect(updates).toHaveLength(1)
  expect(updates[0]).toMatchObject({ revision: 1, patches: [{ type: 'tool-result', ref }] })
  expect(updates[0].order).toBeUndefined()
  const view = applyMessageProjectionUpdate(baseline, updates[0])!
  expect(view.messages).toBe(baseline.messages)
  expect(applyMessageProjectionUpdate(view, updates[0])).toBe(view)
  expect(applyMessageProjectionUpdate(baseline, { ...updates[0], revision: 2 })).toBeUndefined()
  projection.dispose()
})
