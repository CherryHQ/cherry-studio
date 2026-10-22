import { describe, expect, expectTypeOf, it } from 'vitest'

import type { Delegation } from '@cherrystudio/agent-runtime'

import {
  delegationStatus,
  type DelegationStatus,
  pendingResults,
  readSubagents,
  resolveChild,
  runningBackground,
  subagentViews,
  suppressed
} from '../../../src/core/subagents/subagentLedger'
import { facts, marker, run, runEntry, thread, turnStop, user, usage } from '../history'

const finished = (child: string, patch = {}) =>
  runEntry(run(child, { status: 'finished', outcome: 'completed', ...patch }))

describe('subagent ledger', () => {
  // Catches the slot count skipping children spawned in this batch whose report job has not started them yet:
  // parallel spawns would pass the cap (fixture 9). A run that ended unrecorded frees its slot; foreground takes none.
  it('counts spawned-but-unstarted background children as running', () => {
    const spawned = [runEntry(run('c0')), runEntry(run('c1')), runEntry(run('f', { background: false }))]
    expect(runningBackground(facts(spawned)).map(({ child }) => child)).toEqual(['c1', 'c0'])
    const ended = facts(spawned, { children: { c0: { running: false, runUsage: [usage(1)] } } })
    expect(runningBackground(ended).map(({ child }) => child)).toEqual(['c1'])
  })

  // Catches a result delivered twice, one the model already got from stop_subagent, or a foreground run notified.
  it('lists finished background runs no notification delivered, in the order they ended', () => {
    const history = [
      runEntry(run('a')),
      finished('b'),
      finished('a'),
      finished('m', { modelStopped: true }),
      finished('f', { background: false }),
      marker({
        type: 'subagent-notification',
        runs: [{ sessionId: thread('b'), run: 1, outcome: 'completed' }],
        quiet: false
      })
    ]
    expect(pendingResults(history).map((r) => r.sessionId)).toEqual(['a'])
  })

  // Catches suppression ending at a quiet delivery (no turn started) or surviving the next turn (R5, S-a).
  it('suppresses waking from a user stop until a turn starts', () => {
    const stop = turnStop('reopen')
    const quiet = marker({ type: 'subagent-notification', runs: [], quiet: true })
    expect(suppressed([user(), stop, quiet])).toBe(true)
    expect(suppressed([stop, user()])).toBe(false)
  })

  // Catches a shared tool origin merging two distinct child identities.
  it('resolves each child by its own id even when the tool origin is shared', () => {
    const ledgers = readSubagents([
      finished('old', { parentToolCallId: 'k' }),
      runEntry(run('new', { parentToolCallId: 'k' }))
    ])
    expect(resolveChild(ledgers, 'old')?.child).toBe('old')
    expect(resolveChild(ledgers, 'new')?.child).toBe('new')
    expect(resolveChild(ledgers, 'nope')).toBeUndefined()
  })

  // Catches a child waiting for an approval shown as running, or a finished child still shown as running (Y7, A-d).
  it('shows background children with their approval state', () => {
    const history = [runEntry(run('a')), finished('b'), runEntry(run('f', { background: false }))]
    const pending = [{ call: { thread: thread('a'), key: 'x' as never }, state: 'pending' as const }]
    expect(
      subagentViews(facts(history, { children: { a: { running: true, runUsage: [usage(0)] } } }), pending)
    ).toEqual([
      { sessionId: 'a', parentToolCallId: 'call-a', description: 'task a', status: 'awaiting_approval' },
      { sessionId: 'b', parentToolCallId: 'call-b', description: 'task b', status: 'finished', outcome: 'completed' }
    ])
  })

  // Catches the projection drifting from agent-runtime's `Delegation.status`, which adapters assign it to (D40).
  it('projects a run record onto the delegation status', () => {
    expectTypeOf<DelegationStatus>().toEqualTypeOf<Delegation['status']>()
    expect([delegationStatus(run('a')), delegationStatus(run('a', { status: 'finished' }))]).toEqual([
      'active',
      'completed'
    ])
  })
})
