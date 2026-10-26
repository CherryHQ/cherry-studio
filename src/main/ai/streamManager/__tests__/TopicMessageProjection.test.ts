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
  const result = { modelId: 'p::a' as const, attemptId: 1, finalMessage: message('complete text') }
  if (status === 'success') projection.onDone({ ...result, status })
  else if (status === 'paused') projection.onPaused({ ...result, status })
  else projection.onError({ ...result, status, error: { name: 'Error', message: 'provider failed', stack: '' } })
  const view = projection.snapshot()
  expect(view.messages[0].parts[0]).toMatchObject({ text: 'complete text' })
  expect(view.executions[0].status).toBe(status === 'success' ? 'done' : status)
  if (status === 'error') expect(view.messages[0].parts.at(-1)).toMatchObject({ type: 'data-error' })
  projection.dispose()
})
