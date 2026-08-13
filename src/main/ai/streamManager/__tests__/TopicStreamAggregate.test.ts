import { toAttemptId } from '@shared/ai/attempt'
import { describe, expect, it } from 'vitest'

import { TopicStreamAggregate } from '../TopicStreamAggregate'

describe('TopicStreamAggregate', () => {
  it('does not quiesce while any admitted attempt is still finalizing', () => {
    const aggregate = new TopicStreamAggregate('topic-1')
    const slow = aggregate.reserveAttempt(toAttemptId(1))
    const fast = aggregate.reserveAttempt(toAttemptId(2))

    aggregate.transitionAttempt(slow.id, { type: 'launch' })
    aggregate.transitionAttempt(fast.id, { type: 'launch' })
    aggregate.transitionAttempt(slow.id, { type: 'complete' })
    aggregate.transitionAttempt(fast.id, { type: 'complete' })
    aggregate.transitionAttempt(fast.id, { type: 'persisted' })

    expect(aggregate.isQuiescent()).toBe(false)
    expect(aggregate.status()).toBe('pending')

    aggregate.transitionAttempt(slow.id, { type: 'persisted' })

    expect(aggregate.isQuiescent()).toBe(true)
    expect(aggregate.status()).toBe('done')
    expect(aggregate.attemptWatermark()).toBe(fast.id)
  })

  it('keeps a durably settled attempt parked while an approval gate is unresolved', () => {
    const aggregate = new TopicStreamAggregate('topic-1')
    const attempt = aggregate.reserveAttempt(toAttemptId(1))

    aggregate.transitionAttempt(attempt.id, { type: 'launch' })
    aggregate.setApprovalPending(attempt.id, 'tool-1', true)
    aggregate.transitionAttempt(attempt.id, { type: 'complete' })
    aggregate.transitionAttempt(attempt.id, { type: 'persisted' })

    expect(aggregate.isQuiescent()).toBe(false)
    expect(aggregate.status()).toBe('awaiting-approval')

    aggregate.setApprovalPending(attempt.id, 'tool-1', false)

    expect(aggregate.isQuiescent()).toBe(true)
    expect(aggregate.status()).toBe('done')
  })

  it('does not quiesce when neither the final projection nor an error marker is durable', () => {
    const aggregate = new TopicStreamAggregate('topic-1')
    const attempt = aggregate.reserveAttempt(toAttemptId(1))

    aggregate.transitionAttempt(attempt.id, { type: 'launch' })
    aggregate.transitionAttempt(attempt.id, { type: 'complete' })
    aggregate.transitionAttempt(attempt.id, {
      type: 'persist-failed',
      error: { name: 'Error', message: 'db unavailable', stack: null },
      durableErrorWritten: false
    })

    expect(aggregate.attemptState(attempt.id)?.phase).toBe('persistence-blocked')
    expect(aggregate.areAttemptsDurablySettled()).toBe(false)
    expect(aggregate.isQuiescent()).toBe(false)
  })

  it('keeps a durable topic open until its continuation is consumed', () => {
    const aggregate = new TopicStreamAggregate('topic-1')
    const attempt = aggregate.reserveAttempt(toAttemptId(1))
    aggregate.transitionAttempt(attempt.id, { type: 'launch' })
    aggregate.queueContinuation('continuation-1')
    aggregate.transitionAttempt(attempt.id, { type: 'complete' })
    aggregate.transitionAttempt(attempt.id, { type: 'persisted' })

    expect(aggregate.areAttemptsDurablySettled()).toBe(true)
    expect(aggregate.isQuiescent()).toBe(false)
    expect(aggregate.status()).toBe('streaming')

    expect(aggregate.makeContinuationEligible('continuation-1')).toBe(true)
    expect(aggregate.startContinuation('continuation-1')).toBe(true)
    expect(aggregate.finishContinuation('continuation-1', 'consumed')).toBe(true)

    expect(aggregate.isQuiescent()).toBe(true)
    expect(aggregate.status()).toBe('done')
  })

  it('turns a failed continuation into a quiescent error outcome', () => {
    const aggregate = new TopicStreamAggregate('topic-1')
    const attempt = aggregate.reserveAttempt(toAttemptId(1))
    aggregate.transitionAttempt(attempt.id, { type: 'launch' })
    aggregate.transitionAttempt(attempt.id, { type: 'complete' })
    aggregate.transitionAttempt(attempt.id, { type: 'persisted' })
    aggregate.queueContinuation('continuation-1')
    aggregate.makeContinuationEligible('continuation-1')
    aggregate.startContinuation('continuation-1')

    aggregate.finishContinuation('continuation-1', 'failed')

    expect(aggregate.isQuiescent()).toBe(true)
    expect(aggregate.status()).toBe('error')
  })
})
