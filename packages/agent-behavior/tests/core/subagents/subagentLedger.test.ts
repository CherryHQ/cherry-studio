import { describe, expect, it } from 'vitest'

import { callKeyOf } from '../../../src/core/facts'
import { keys } from '../../../src/core/keys'
import {
  delegationStatus,
  pendingResults,
  readSubagents,
  resolveChild,
  runningBackground,
  subagentResults,
  subagentViews,
  suppressed
} from '../../../src/core/subagents/subagentLedger'
import { assistant, callTo, facts, marker, run, runEntry, thread, turnStop, user, usage } from '../history'

const finished = (child: string, patch = {}) =>
  runEntry(run(child, { status: 'finished', outcome: 'completed', ...patch }))

describe('subagent ledger', () => {
  it('keeps a result pending through report delivery and the parent notification run', () => {
    const call = callTo('subagent', { background: true }, 'spawn')
    const record = run('child', { parentToolCallId: call.callKey })
    const history = [user(), assistant('', { calls: [call] }), runEntry(record, keys.subagentSpawn(call.callKey))]
    const expected = { active: true, pending: ['spawn'], notification: [] }
    expect(subagentResults(history, false)).toEqual(expected)
    history.push(runEntry({ ...record, status: 'finished', outcome: 'completed' }))
    expect(subagentResults(history, false)).toEqual(expected)
    history.push(
      marker({
        type: 'subagent-notification',
        runs: [{ sessionId: thread('child'), run: 1, outcome: 'completed' }],
        quiet: false
      })
    )
    expect(subagentResults(history, false)).toEqual({ active: true, pending: ['spawn'], notification: ['spawn'] })
    expect(subagentResults(history, true)).toEqual({ active: true, pending: ['spawn'], notification: ['spawn'] })
    history.push(assistant('Final report'))
    expect(subagentResults(history, false)).toEqual({ active: false, pending: [], notification: ['spawn'] })
  })

  it('attributes a continued child to the continuation call and does not wake for quiet delivery', () => {
    const spawn = callTo('subagent', { background: true }, 'spawn')
    const next = callTo('message_subagent', { id: 'child', message: 'Continue' }, 'continue')
    const record = run('child', { parentToolCallId: spawn.callKey })
    const history = [
      user(),
      assistant('', { calls: [spawn] }),
      runEntry(record, keys.subagentSpawn(spawn.callKey)),
      runEntry({ ...record, status: 'finished', modelStopped: true }),
      user(),
      assistant('', { calls: [next] }),
      runEntry({ ...record, run: 2 }, keys.subagentContinue(next.callKey))
    ]
    expect(subagentResults(history, false)).toEqual({ active: true, pending: ['continue'], notification: [] })
    history.push(
      runEntry({ ...record, run: 2, status: 'finished', outcome: 'stopped' }),
      marker({
        type: 'subagent-notification',
        runs: [{ sessionId: thread('child'), run: 2, outcome: 'stopped' }],
        quiet: true
      })
    )
    expect(subagentResults(history, false)).toEqual({ active: false, pending: [], notification: [] })
  })

  it('does not report missing continuation provenance as drained or reuse the creation call', () => {
    const call = callTo('subagent', {}, 'spawn')
    expect(
      subagentResults(
        [assistant('', { calls: [call] }), runEntry(run('child', { parentToolCallId: call.callKey, run: 2 }))],
        false
      )
    ).toBeUndefined()
  })

  it('retains a child-panel continuation without assigning it to the original parent reply', () => {
    const call = callTo('subagent', {}, 'spawn')
    const history = [
      assistant('', { calls: [call] }),
      runEntry(
        run('child', { parentToolCallId: call.callKey, run: 2 }),
        keys.subagentContinue(callKeyOf('host-message:["parent","input"]'))
      )
    ]
    expect(subagentResults(history, false)).toEqual({ active: true, pending: [], notification: [] })
  })

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

  // Catches a running record projected as completed, or a finished one still reported active.
  it('projects a run record onto the delegation status', () => {
    expect([delegationStatus(run('a')), delegationStatus(run('a', { status: 'finished' }))]).toEqual([
      'active',
      'completed'
    ])
  })
})
