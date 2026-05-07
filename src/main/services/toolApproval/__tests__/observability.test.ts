/**
 * Tests for the approval observability ring buffer.
 *
 * The ring buffer is in-memory per-process state. Each test resets the
 * map by calling `clearTopic` for any topic ids it uses, since the
 * module-level `recent` map is shared.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { type ApprovalDecisionEntry, clearTopic, getApprovalState, recordDecision } from '../observability'

const TOPIC_A = 'topic-a'
const TOPIC_B = 'topic-b'

function makeEntry(overrides: Partial<ApprovalDecisionEntry> = {}): ApprovalDecisionEntry {
  return {
    toolName: 'shell_exec',
    toolCallId: 'call-1',
    decision: 'approved',
    decidedAt: '2026-05-06T12:00:00.000Z',
    ...overrides
  }
}

beforeEach(() => {
  // Module state survives across tests in the same file.
  clearTopic(TOPIC_A)
  clearTopic(TOPIC_B)
})

describe('recordDecision', () => {
  it('appends entries most-recent-first', () => {
    recordDecision(TOPIC_A, makeEntry({ toolCallId: 'c1' }))
    recordDecision(TOPIC_A, makeEntry({ toolCallId: 'c2' }))

    const state = getApprovalState(TOPIC_A)
    expect(state.recentDecisions.map((e) => e.toolCallId)).toEqual(['c2', 'c1'])
  })

  it('evicts oldest entries when MAX_RECENT (5) is exceeded', () => {
    for (let i = 1; i <= 7; i++) {
      recordDecision(TOPIC_A, makeEntry({ toolCallId: `c${i}` }))
    }

    const state = getApprovalState(TOPIC_A)
    expect(state.recentDecisions).toHaveLength(5)
    // Newest first, oldest two (c1, c2) dropped.
    expect(state.recentDecisions.map((e) => e.toolCallId)).toEqual(['c7', 'c6', 'c5', 'c4', 'c3'])
  })

  it('keeps topic state isolated', () => {
    recordDecision(TOPIC_A, makeEntry({ toolCallId: 'a-1' }))
    recordDecision(TOPIC_B, makeEntry({ toolCallId: 'b-1' }))

    expect(getApprovalState(TOPIC_A).recentDecisions.map((e) => e.toolCallId)).toEqual(['a-1'])
    expect(getApprovalState(TOPIC_B).recentDecisions.map((e) => e.toolCallId)).toEqual(['b-1'])
  })

  it('is a no-op when topicId is empty', () => {
    recordDecision('', makeEntry())
    // Empty string is treated as "no topic"; nothing recorded under empty key.
    expect(getApprovalState('').recentDecisions).toEqual([])
  })

  it('preserves all decision fields including reason', () => {
    const entry = makeEntry({
      decision: 'denied',
      reason: 'Looks risky'
    })
    recordDecision(TOPIC_A, entry)

    expect(getApprovalState(TOPIC_A).recentDecisions[0]).toEqual(entry)
  })
})

describe('getApprovalState', () => {
  it('returns empty arrays for a topic that has never seen activity', () => {
    const state = getApprovalState('never-seen')
    expect(state.pendingApprovals).toEqual([])
    expect(state.recentDecisions).toEqual([])
  })

  it('returns empty pendingApprovals for V1 (no DB-backed pending query yet)', () => {
    recordDecision(TOPIC_A, makeEntry())
    expect(getApprovalState(TOPIC_A).pendingApprovals).toEqual([])
  })
})

describe('clearTopic', () => {
  it('drops the entry for the given topic', () => {
    recordDecision(TOPIC_A, makeEntry())
    expect(getApprovalState(TOPIC_A).recentDecisions).toHaveLength(1)

    clearTopic(TOPIC_A)
    expect(getApprovalState(TOPIC_A).recentDecisions).toEqual([])
  })

  it('does not affect other topics', () => {
    recordDecision(TOPIC_A, makeEntry({ toolCallId: 'a-1' }))
    recordDecision(TOPIC_B, makeEntry({ toolCallId: 'b-1' }))

    clearTopic(TOPIC_A)
    expect(getApprovalState(TOPIC_A).recentDecisions).toEqual([])
    expect(getApprovalState(TOPIC_B).recentDecisions.map((e) => e.toolCallId)).toEqual(['b-1'])
  })

  it('is a no-op for unknown topics', () => {
    expect(() => clearTopic('nope')).not.toThrow()
  })
})
