import type { SerializedError } from '@shared/types/error'
import { describe, expect, it } from 'vitest'

import { type AttemptEvent, type AttemptState, executionStatus, reduceTopicStatus, transition } from '../attemptMachine'

const error: SerializedError = { name: 'Error', message: 'boom', stack: null }
const events: AttemptEvent[] = [
  { type: 'launch' },
  { type: 'chunk', at: 10 },
  { type: 'complete' },
  { type: 'fail', error },
  { type: 'abort', reason: 'user-requested' },
  { type: 'persisted' },
  { type: 'persist-failed', error },
  { type: 'approval-changed', pending: true }
]

describe('attemptMachine', () => {
  it('moves a successful attempt through reserved, running, finalizing, and settled', () => {
    const launched = transition({ phase: 'reserved' }, { type: 'launch' })
    expect(launched).toEqual({ ok: true, state: { phase: 'running', firstChunkAt: null } })
    if (!launched.ok) return

    const chunked = transition(launched.state, { type: 'chunk', at: 10 })
    expect(chunked).toEqual({ ok: true, state: { phase: 'running', firstChunkAt: 10 } })
    if (!chunked.ok) return

    const finalizing = transition(chunked.state, { type: 'complete' })
    expect(finalizing).toEqual({
      ok: true,
      state: { phase: 'finalizing', firstChunkAt: 10, outcome: { kind: 'done' } }
    })
    if (!finalizing.ok) return

    expect(transition(finalizing.state, { type: 'persisted' })).toEqual({
      ok: true,
      state: { phase: 'settled', firstChunkAt: 10, outcome: { kind: 'done' } }
    })
  })

  it.each([
    [{ phase: 'reserved' } as AttemptState, ['launch']],
    [
      { phase: 'running', firstChunkAt: null } as AttemptState,
      ['chunk', 'complete', 'fail', 'abort', 'approval-changed']
    ],
    [
      { phase: 'finalizing', firstChunkAt: null, outcome: { kind: 'done' } } as AttemptState,
      ['persisted', 'persist-failed', 'approval-changed']
    ],
    [{ phase: 'settled', firstChunkAt: null, outcome: { kind: 'done' } } as AttemptState, []]
  ])('accepts only declared events from %s', (state, acceptedEvents) => {
    for (const event of events) {
      const result = transition(state, event)
      expect(result.ok, `${state.phase} + ${event.type}`).toBe(acceptedEvents.includes(event.type))
      if (!result.ok && state.phase === 'settled') expect(result.kind).toBe('stale')
    }
  })

  it('turns a persistence failure into the settled error outcome', () => {
    const state: AttemptState = { phase: 'finalizing', firstChunkAt: null, outcome: { kind: 'done' } }
    const result = transition(state, { type: 'persist-failed', error })

    expect(result).toEqual({
      ok: true,
      state: { phase: 'settled', firstChunkAt: null, outcome: { kind: 'error', error } }
    })
    if (result.ok) expect(executionStatus(result.state)).toBe('error')
  })

  it('reduces running, approval, and terminal attempt sets deterministically', () => {
    const noApprovals = new Set<string>()
    expect(
      reduceTopicStatus([{ state: { phase: 'running', firstChunkAt: null }, pendingApprovals: noApprovals }], 'active')
    ).toBe('pending')
    expect(
      reduceTopicStatus([{ state: { phase: 'running', firstChunkAt: 1 }, pendingApprovals: noApprovals }], 'active')
    ).toBe('streaming')
    expect(
      reduceTopicStatus(
        [
          {
            state: { phase: 'settled', firstChunkAt: null, outcome: { kind: 'done' } },
            pendingApprovals: new Set(['tool-1'])
          }
        ],
        'grace'
      )
    ).toBe('awaiting-approval')
    expect(
      reduceTopicStatus(
        [
          { state: { phase: 'settled', firstChunkAt: null, outcome: { kind: 'done' } }, pendingApprovals: noApprovals },
          {
            state: { phase: 'settled', firstChunkAt: null, outcome: { kind: 'error', error } },
            pendingApprovals: noApprovals
          }
        ],
        'grace'
      )
    ).toBe('error')
  })

  it('never regresses phase across generated event sequences', () => {
    const rank = { reserved: 0, running: 1, finalizing: 2, settled: 3 } as const
    let random = 0x18452
    const nextIndex = () => {
      random = (random * 1664525 + 1013904223) >>> 0
      return random % events.length
    }

    for (let sequence = 0; sequence < 250; sequence += 1) {
      let state: AttemptState = { phase: 'reserved' }
      for (let step = 0; step < 40; step += 1) {
        const previous = state
        const result = transition(state, events[nextIndex()])
        if (result.ok) {
          state = result.state
          expect(rank[state.phase]).toBeGreaterThanOrEqual(rank[previous.phase])
        } else {
          expect(state).toBe(previous)
          if (state.phase === 'settled') expect(result.kind).toBe('stale')
        }
      }
    }
  })
})
