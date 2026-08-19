import { toAttemptId } from '@shared/ai/attempt'
import { describe, expect, it } from 'vitest'

import { TopicStreamAggregate } from '../TopicStreamAggregate'
import { toContinuationLeaseId } from '../topicStreamState'

const lease = toContinuationLeaseId('continuation-1')

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
    aggregate.openContinuationLease(lease, 'chat-steer')
    aggregate.transitionAttempt(attempt.id, { type: 'complete' })
    aggregate.transitionAttempt(attempt.id, { type: 'persisted' })

    expect(aggregate.areAttemptsDurablySettled()).toBe(true)
    expect(aggregate.isQuiescent()).toBe(false)
    expect(aggregate.status()).toBe('streaming')

    expect(aggregate.consumeContinuationLease(lease, attempt.id)).toBe(true)

    expect(aggregate.isQuiescent()).toBe(true)
    expect(aggregate.status()).toBe('done')
  })

  it('turns a failed continuation into a quiescent error outcome', () => {
    const aggregate = new TopicStreamAggregate('topic-1')
    const attempt = aggregate.reserveAttempt(toAttemptId(1))
    aggregate.transitionAttempt(attempt.id, { type: 'launch' })
    aggregate.transitionAttempt(attempt.id, { type: 'complete' })
    aggregate.transitionAttempt(attempt.id, { type: 'persisted' })
    aggregate.openContinuationLease(lease, 'agent-runtime')

    aggregate.releaseContinuationLease(lease, 'source-error')

    expect(aggregate.isQuiescent()).toBe(true)
    expect(aggregate.status()).toBe('error')
  })

  it('settles a lease exactly once: the first terminal transition wins (L2)', () => {
    const aggregate = new TopicStreamAggregate('topic-1')
    const attempt = aggregate.reserveAttempt(toAttemptId(1))
    aggregate.transitionAttempt(attempt.id, { type: 'launch' })
    aggregate.transitionAttempt(attempt.id, { type: 'complete' })
    aggregate.transitionAttempt(attempt.id, { type: 'persisted' })
    aggregate.openContinuationLease(lease, 'chat-steer')

    expect(aggregate.consumeContinuationLease(lease, attempt.id)).toBe(true)
    expect(aggregate.releaseContinuationLease(lease, 'stop')).toBe(false)
    expect(aggregate.continuationLease(lease)?.state).toBe('consumed')
    // A settled lease cannot reopen the topic.
    expect(aggregate.isQuiescent()).toBe(true)
    expect(aggregate.status()).toBe('done')
  })

  it('reserves a continuation attempt and consumes its exact lease in one commit', () => {
    const aggregate = new TopicStreamAggregate('topic-1')
    aggregate.openContinuationLease(lease, 'agent-runtime')
    const attemptId = toAttemptId(2)

    const prepared = aggregate.prepare({
      type: 'reserve-continuation-dispatch',
      attemptIds: [attemptId],
      leaseId: lease
    })
    aggregate.commit(prepared)

    expect(aggregate.attemptState(attemptId)).toEqual({ phase: 'reserved' })
    expect(aggregate.continuationLease(lease)).toMatchObject({ state: 'consumed', attemptId })
  })

  it('pushes ring eviction pause on the approval edges, never on inner changes (T8)', () => {
    const aggregate = new TopicStreamAggregate('topic-1')
    const pushed: Array<{ attemptId: number; paused: boolean }> = []
    aggregate.setFlagEffectSink((effect) => pushed.push({ attemptId: effect.attemptId, paused: effect.paused }))
    const attempt = aggregate.reserveAttempt(toAttemptId(1))
    aggregate.transitionAttempt(attempt.id, { type: 'launch' })

    aggregate.setApprovalPending(attempt.id, 'tool-1', true)
    aggregate.setApprovalPending(attempt.id, 'tool-2', true)
    aggregate.setApprovalPending(attempt.id, 'tool-1', false)
    aggregate.setApprovalPending(attempt.id, 'tool-2', false)

    // Only the empty↔non-empty edges flip the ring; a parallel approval must not resume eviction.
    expect(pushed).toEqual([
      { attemptId: attempt.id, paused: true },
      { attemptId: attempt.id, paused: false }
    ])
  })
})
