import { afterEach, expect, it, vi } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { TopicMessageProjection } from '../TopicMessageProjection'

const message = (text: string): CherryUIMessage => ({
  id: 'native',
  role: 'assistant',
  parts: [{ type: 'text', text, state: 'streaming' }]
})
afterEach(() => vi.useRealTimers())

// A retry may reuse both model and message IDs; late frames/terminals must still be rejected.
it('fences attempt replacement and preserves independently running siblings', () => {
  vi.useFakeTimers()
  const projection = new TopicMessageProjection('topic', (value) => value)
  projection.begin(
    [
      { executionId: 'p::a', attemptId: 1, anchorMessageId: 'a' },
      { executionId: 'p::b', attemptId: 2, anchorMessageId: 'b' }
    ],
    true
  )
  projection.accumulate('p::a', 1, message('old'))
  projection.accumulate('p::b', 2, message('sibling'))
  projection.begin([{ executionId: 'p::a', attemptId: 3, anchorMessageId: 'a' }], false)
  projection.accumulate('p::a', 3, message('new'))
  projection.onDone({ status: 'success', modelId: 'p::a', attemptId: 1, finalMessage: message('stale') })
  projection.accumulate('p::a', 1, message('stale chunk'))
  const view = projection.snapshot()
  expect(view.messages.map((item) => [item.id, item.parts[0]])).toEqual([
    ['b', expect.objectContaining({ text: 'sibling' })],
    ['a', expect.objectContaining({ text: 'new' })]
  ])
  expect(view.executions.map((execution) => [execution.attemptId, execution.status])).toEqual([
    [3, 'active'],
    [2, 'active']
  ])
  projection.dispose()
})

// Terminal publication must contain all accepted text even when its coalescing timer has not fired.
it.each(['success', 'paused', 'error'] as const)('flushes the final message with %s state', (status) => {
  vi.useFakeTimers()
  const projection = new TopicMessageProjection('topic', (value) => value)
  projection.begin([{ executionId: 'p::a', attemptId: 1, anchorMessageId: 'a' }], true)
  projection.accumulate('p::a', 1, message('complete text'))
  const result = {
    modelId: 'p::a' as const,
    attemptId: 1,
    userMessageId: 'queued-user',
    finalMessage: message('complete text')
  }
  if (status === 'success') projection.onDone({ ...result, status })
  else if (status === 'paused') projection.onPaused({ ...result, status })
  else projection.onError({ ...result, status, error: { name: 'Error', message: 'provider failed', stack: '' } })
  const view = projection.snapshot()
  expect(view.messages[0].parts[0]).toMatchObject({ text: 'complete text' })
  expect(view.executions[0].status).toBe(status === 'success' ? 'done' : status)
  expect(view.executions[0]).toMatchObject({ userMessageId: 'queued-user' })
  if (status === 'error') expect(view.messages[0].parts.at(-1)).toMatchObject({ type: 'data-error' })
  projection.dispose()
})

const countingProjection = () => {
  const calls = { count: 0 }
  const projection = new TopicMessageProjection('topic', (value) => {
    calls.count += 1
    return { ...value, metadata: { projected: true } } as CherryUIMessage
  })
  projection.begin([{ executionId: 'p::a', attemptId: 1, anchorMessageId: 'a' }], true)
  return { projection, calls }
}

// Renderer projection serializes finished tool outputs; running it per chunk stalls long tool-heavy streams.
it('projects once per coalesced batch instead of once per chunk', () => {
  vi.useFakeTimers()
  const { projection, calls } = countingProjection()
  const updates: unknown[] = []
  projection.subscribe((update) => updates.push(update))
  for (const text of ['a', 'ab', 'abc', 'abcd']) projection.accumulate('p::a', 1, message(text))
  expect(calls.count).toBe(0)
  vi.advanceTimersByTime(80)
  expect(calls.count).toBe(1)
  expect(updates).toHaveLength(1)
  expect(projection.snapshot().messages[0]).toMatchObject({ metadata: { projected: true }, parts: [{ text: 'abcd' }] })
  projection.dispose()
})

it('defers projection of an unobserved stream until a subscriber reads the snapshot', () => {
  vi.useFakeTimers()
  const { projection, calls } = countingProjection()
  projection.accumulate('p::a', 1, message('first'))
  projection.accumulate('p::a', 1, message('latest'))
  vi.advanceTimersByTime(1000)
  expect(calls.count).toBe(0)
  const view = projection.snapshot()
  expect(calls.count).toBe(1)
  expect(view.messages[0]).toMatchObject({ id: 'a', metadata: { projected: true }, parts: [{ text: 'latest' }] })
  expect(view.executions[0]).toMatchObject({ messageId: 'a' })
  projection.dispose()
})
