import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ActiveExecution } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'

import { useAgentSteerPresentation } from '../useAgentSteerPresentation'

const answer = (text: string): CherryUIMessage => ({
  id: 'answer',
  role: 'assistant',
  parts: [{ type: 'text', text, state: 'streaming' }]
})
const steer: CherryUIMessage = { id: 'steer', role: 'user', parts: [{ type: 'text', text: 'Use Python' }] }
const execution: ActiveExecution = {
  executionId: createUniqueModelId('provider', 'model'),
  attemptId: 1,
  anchorMessageId: 'answer'
}

describe('steer presentation', () => {
  it('holds the already visible prefix while late text stays in its original message', () => {
    const initial = answer('Before steer')
    const { result, rerender } = renderHook(useAgentSteerPresentation, {
      initialProps: { topicId: 'topic', messages: [initial], partsByMessageId: {}, activeExecutions: [execution] }
    })
    rerender({ topicId: 'topic', messages: [initial, steer], partsByMessageId: {}, activeExecutions: [execution] })
    const late = answer('Before steer. Late output.')
    rerender({ topicId: 'topic', messages: [late, steer], partsByMessageId: {}, activeExecutions: [execution] })

    expect(result.current.answer).toEqual([{ type: 'text', text: 'Before steer', state: 'done' }])
    expect(late.parts).toEqual([{ type: 'text', text: 'Before steer. Late output.', state: 'streaming' }])
  })

  it('restores the live reply if the pending user row is rejected', () => {
    const initial = answer('Initial')
    const { result, rerender } = renderHook(useAgentSteerPresentation, {
      initialProps: {
        topicId: 'topic',
        messages: [initial, steer],
        partsByMessageId: {},
        activeExecutions: [execution]
      }
    })
    expect(result.current.answer).toBeDefined()
    rerender({
      topicId: 'topic',
      messages: [answer('Still running')],
      partsByMessageId: {},
      activeExecutions: [execution]
    })
    expect(result.current).toEqual({})
  })

  it('releases the held view at native handoff and leaves the successor live', () => {
    const initial = answer('Initial')
    const { result, rerender } = renderHook(useAgentSteerPresentation, {
      initialProps: {
        topicId: 'topic',
        messages: [initial, steer],
        partsByMessageId: {},
        activeExecutions: [execution]
      }
    })
    const successor: CherryUIMessage = { id: 'successor', role: 'assistant', parts: [{ type: 'text', text: 'Python' }] }
    rerender({
      topicId: 'topic',
      messages: [answer('Initial plus late output'), steer, successor],
      partsByMessageId: {},
      activeExecutions: [{ ...execution, attemptId: 2, anchorMessageId: 'successor' }]
    })
    expect(result.current.answer).toBeUndefined()
    expect(result.current.successor).toBeUndefined()
  })

  it('derives a boundary for another observer without leaking snapshots between topics', () => {
    const { result, rerender } = renderHook(useAgentSteerPresentation, {
      initialProps: {
        topicId: 'topic',
        messages: [answer('Observed'), steer],
        partsByMessageId: {},
        activeExecutions: [execution]
      }
    })
    expect(result.current.answer).toEqual([{ type: 'text', text: 'Observed', state: 'done' }])
    rerender({
      topicId: 'another-topic',
      messages: [answer('Unrelated')],
      partsByMessageId: {},
      activeExecutions: [execution]
    })
    expect(result.current).toEqual({})
  })
})
