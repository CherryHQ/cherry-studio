import { toAttemptId } from '@shared/ai/attempt'
import type { ActiveExecution } from '@shared/ai/transport'
import type { UniqueModelId } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'

import { projectActiveExecutions, TopicStreamProjection } from '../TopicAttemptProjection'

const model = 'provider::model' as UniqueModelId

function execution(attemptId: number, anchorMessageId = 'assistant-1'): ActiveExecution {
  return { executionId: model, attemptId, anchorMessageId }
}

describe('TopicStreamProjection', () => {
  it('keeps only the newest attempt active within one model-anchor slot', () => {
    const projection = new TopicStreamProjection('topic-1')

    expect(projection.register(execution(1)).accepted).toBe(true)
    const replacement = projection.register(execution(2))

    expect(replacement).toMatchObject({ accepted: true, replacedUnsettled: true })
    expect(projection.attempts.get(toAttemptId(1))?.phase).toBe('settled')
    expect(projection.attempts.get(toAttemptId(2))?.phase).toBe('active')
    expect(projection.register(execution(1)).accepted).toBe(false)
  })

  it('separates exact settlement from a monotonic topic watermark', () => {
    const projection = new TopicStreamProjection('topic-1')
    projection.register(execution(3, 'assistant-a'))
    projection.register(execution(4, 'assistant-b'))
    projection.settle(execution(3, 'assistant-a'))

    expect(projection.isSettled(3)).toBe(true)
    expect(projection.isSettled(4)).toBe(false)

    projection.advanceWatermark(4)
    projection.advanceWatermark(2)
    expect(projection.watermark).toBe(4)
    expect(projection.isSettled(4)).toBe(true)
  })

  it('compacts attempt records covered by the monotonic watermark', () => {
    const projection = new TopicStreamProjection('topic-1')
    for (let attemptId = 1; attemptId <= 100; attemptId++) {
      projection.register(execution(attemptId))
    }

    projection.advanceWatermark(100)
    projection.settle(execution(100))
    projection.register(execution(50))

    expect(projection.attempts.size).toBe(0)
    expect(projection.isSettled(50)).toBe(true)
    expect(projection.isSettled(100)).toBe(true)
  })

  it('applies the same newest-attempt-wins rule to delayed active snapshots', () => {
    expect(projectActiveExecutions([execution(8)], [execution(7), execution(9)])).toEqual([execution(9)])
  })
})
