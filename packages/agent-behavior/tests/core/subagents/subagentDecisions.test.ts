import { describe, expect, it } from 'vitest'

import type { JsonValue } from '@cherrystudio/agent-runtime'

import type { HistoryEntry } from '../../../src/core/facts'
import { keys } from '../../../src/core/keys'
import {
  allowRequest,
  budgetStops,
  decideMessage,
  decideRunEnd,
  decideSpawn,
  decideSteerWithdrawn,
  decideStop,
  decideUserStopSubagent,
  reportTarget
} from '../../../src/core/subagents/subagentDecisions'
import { continuedText } from '../../../src/core/subagents/subagentText'
import {
  apply,
  assistant,
  call,
  facts,
  type FactsOptions,
  goal,
  goalEntry,
  inputs,
  MODELS,
  roundEntry,
  run,
  runEntry,
  usage,
  user
} from '../history'

const k = call('k1')
const spawn = (
  args: JsonValue,
  history: HistoryEntry[] = [user(), assistant('x')],
  options: FactsOptions = {},
  extra = {}
) => decideSpawn(facts(history, options), inputs({ args, ...extra }), k)
const job = { description: 'd', prompt: 'p' }

describe('spawning', () => {
  // Catches a subagent starting subagents, a fork switching models, a named model resolved by a fuzzy match (D16), or
  // a child without the model it must run on (S9: the named one, the parent's for a fork, else the host default).
  it('refuses what the subagent tool forbids and picks the model the child runs on', () => {
    expect(
      spawn(job, [], { lineage: { kind: 'subagent', parent: 'p' as never, origin: run('x') } }).result
    ).toMatchObject({ kind: 'refused' })
    expect(spawn({ ...job, fork: true, model: 'm' }).result).toMatchObject({
      kind: 'refused',
      text: expect.stringContaining('fork')
    })
    const candidates = [
      { key: 'a/m', provider: 'A', model: 'M', exact: true },
      { key: 'b/m', provider: 'B', model: 'M', exact: true }
    ]
    expect(spawn({ ...job, model: 'M' }, undefined, {}, { models: { ...MODELS, candidates } }).result).toMatchObject({
      text: expect.stringContaining('Ask the user which one')
    })
    const one = spawn(
      { ...job, model: 'M' },
      undefined,
      {},
      { models: { ...MODELS, candidates: candidates.slice(0, 1) } }
    )
    expect(one.ops[0]).toMatchObject({ type: 'spawn-child', spec: { origin: { modelKey: 'a/m' } } })
    expect(spawn(job).ops[0]).toMatchObject({
      spec: { origin: { modelKey: 'p/child' }, record: { modelKey: 'p/child' } }
    })
    expect(spawn({ ...job, fork: true }).ops[0]).toMatchObject({ spec: { origin: { modelKey: 'p/parent' } } })
  })

  // Catches a background spawn without its report job (its result would never arrive), a fork from the wrong entry,
  // or a used-up goal budget refusing foreground work that today runs.
  it('spawns background children with a report job and forks at the calling message', () => {
    const history = [user(), assistant('x')]
    const background = spawn({ ...job, background: true, fork: true }, history)
    expect(background.ops).toMatchObject([
      {
        type: 'spawn-child',
        key: 'subagent-spawn:k1',
        spec: { boundary: 'background', fork: { from: 'parent', at: history[1].id } }
      },
      {
        type: 'ensure-job',
        key: 'subagent-report:subagent-spawn:k1',
        job: { kind: 'subagent-report', onRestart: 'resume' }
      }
    ])
    const spent = [
      goalEntry(goal({ budget: { tokens: 1 } })),
      roundEntry({ id: 'r', goalId: 'g1', revision: 1, round: 1, kind: 'work' }),
      goalEntry(goal({ budget: { tokens: 1 }, admittedRound: 'r' })),
      assistant('x', { usage: usage(5) })
    ]
    expect(spawn({ ...job, background: true }, spent).result).toMatchObject({
      kind: 'refused',
      text: expect.stringContaining('budget')
    })
    expect(spawn(job, spent).result).toMatchObject({ kind: 'spawn', background: false })
  })

  // Catches parallel spawns in one batch passing the cap before their report jobs start the children (fixture 9).
  it('refuses a background spawn once spawned children fill the slots', () => {
    const capped = inputs({ args: { ...job, background: true }, settings: { ...inputs().settings, maxBackground: 1 } })
    const history = apply([user(), assistant('x')], decideSpawn(facts([user(), assistant('x')]), capped, k), ['c1'])
    expect(decideSpawn(facts(history), capped, call('k2')).result).toMatchObject({
      kind: 'refused',
      text: expect.stringMatching(/^1 background subagents are already running/)
    })
  })

  // Catches a replay-safe rerun creating a second child instead of finding the one it created (design §7.5).
  it('finds the child a rerun already spawned', () => {
    const history = apply([user(), assistant('x')], spawn({ ...job, background: true }), ['c1'])
    expect(spawn({ ...job, background: true }, history)).toMatchObject({
      ops: [],
      result: { kind: 'spawn', child: 'c1' }
    })
    expect(reportTarget(facts(history), { runKey: keys.subagentSpawn(k), run: 1, text: '' })).toEqual({
      child: 'c1',
      run: 1
    })
  })
})

describe('messaging and stopping', () => {
  const live = { children: { a: { running: true, runUsage: [usage(0)] } } }
  const message = (history: HistoryEntry[], options: FactsOptions = {}) =>
    decideMessage(facts(history, options), inputs({ args: { id: 'a', message: 'more' } }), k)

  // Catches a message to a running child starting a second run, or a finished background child not continuing in
  // place as its next run.
  it('steers a running child and continues a finished one in the background', () => {
    expect(message([runEntry(run('a'))], live)).toMatchObject({
      ops: [{ record: { type: 'subagent-steer', value: { sessionId: 'a', run: 1 } }, key: 'subagent-steer:k1:1' }],
      effects: [{ type: 'message-child', key: 'subagent-steer:k1:1', run: 1 }]
    })
    const interrupted = [runEntry(run('a', { status: 'finished', outcome: 'interrupted' }))]
    const continued = message(interrupted)
    expect(continued.result).toMatchObject({ kind: 'continued', from: 'a', child: 'a', run: 2 })
    expect(continued.ops).toMatchObject([
      { type: 'append-record', record: { value: { run: 2, background: true, status: 'running' } } },
      {
        type: 'ensure-job',
        key: 'subagent-report:subagent-msg:a:2',
        job: { input: { text: expect.stringMatching(/^Your previous run was interrupted/) } }
      }
    ])
    expect(message(apply(interrupted, continued))).toMatchObject({ ops: [], result: { run: 2 } })
  })

  // Catches a rerun of a steer the child took and then finished with (H3): deciding afresh found the child finished
  // and continued it with the same message, so the child received it twice. Only a withdrawn steer is decided again.
  it('sends a recorded steer again on a rerun and decides afresh only once it was withdrawn', () => {
    const steered = message([runEntry(run('a'))], live)
    const finished = [
      ...apply([runEntry(run('a'))], steered),
      runEntry(run('a', { status: 'finished', outcome: 'completed' }))
    ]
    const rerun = message(finished)
    expect(rerun.result).toMatchObject({ kind: 'queued', child: 'a' })
    expect(rerun.effects).toEqual(steered.effects)
    const withdrawn = apply(finished, decideSteerWithdrawn(facts(finished), k))
    expect(message(withdrawn).result).toMatchObject({ kind: 'continued', child: 'a', run: 2 })
  })

  // Catches a message sent into a run that is being stopped, where the stop would drop it (Y5): the call waits for
  // that run's end and decides again.
  it('waits for a run that is being stopped before continuing', () => {
    expect(message([runEntry(run('a', { stoppedBy: 'budget' }))], live)).toEqual({
      ops: [],
      effects: [],
      result: { kind: 'stopping', child: 'a', run: 1, key: 'subagent-msg:a:1' }
    })
  })

  // Catches a finished foreground child continued inside the tool call that owned it (S-j, AC10): it is forked from its
  // whole history into a new background child, and a rerun finds that child instead of forking again.
  it('forks a finished foreground child into a new background child', () => {
    const finished = [runEntry(run('a', { status: 'finished', outcome: 'completed', background: false, fork: false }))]
    const forked = message(finished, { children: { a: { lastItem: 'a-9' as never } } })
    expect(forked.ops).toMatchObject([
      {
        type: 'spawn-child',
        key: 'subagent-continue:k1',
        spec: { boundary: 'background', fork: { from: 'a', at: 'a-9' }, record: { background: true, run: 1 } }
      },
      {
        type: 'ensure-job',
        key: 'subagent-report:subagent-continue:k1',
        job: { input: { runKey: 'subagent-continue:k1', run: 1 } }
      }
    ])
    expect(forked.result).toEqual({ kind: 'continued', from: 'a', key: 'subagent-continue:k1', run: 1 })
    const after = apply(finished, forked, ['b'])
    expect(message(after)).toMatchObject({ ops: [], result: { kind: 'continued', from: 'a', child: 'b', run: 1 } })
    expect(continuedText('a', 'b')).toContain('use id b from now on')
  })

  // Catches continuing a child the user stopped (agent-runtime-pi README subagents), or stop_subagent on a finished
  // child aborting nothing.
  it('refuses to continue a user-stopped child and reports a child that is not running', () => {
    const stopped = [runEntry(run('a', { status: 'finished', outcome: 'stopped', stoppedBy: 'user' }))]
    expect(message(stopped).result).toMatchObject({
      kind: 'refused',
      text: expect.stringContaining('stopped by the user')
    })
    const stop = decideStop(facts(stopped), inputs({ args: { id: 'a' } }))
    expect(stop.result).toMatchObject({
      kind: 'not-running',
      result: { text: 'Subagent a is not running (stopped by the user).' }
    })
  })

  // Catches a model stop that loses a user's earlier stop, or that is not recorded before the run winds down (Y4).
  it('records who stopped a run before stopping it', () => {
    const userStopped = [runEntry(run('a', { stoppedBy: 'user' }))]
    const stop = decideStop(facts(userStopped, live), inputs({ args: { id: 'a' } }))
    expect(stop.ops).toMatchObject([
      { record: { value: { stoppedBy: 'user', modelStopped: true } }, key: 'subagent-stop:a:1:model' }
    ])
    expect(stop.effects).toEqual([{ type: 'stop-child', child: 'a', run: 1 }])
    expect(decideUserStopSubagent(facts([runEntry(run('f', { background: false }))]), 'f' as never).result).toBe(false)
  })

  // Catches a stop that waits for a run no input has reached (G-C4): the wait would never end, and the report job would
  // start the stopped run afterwards anyway.
  it('ends a run no input has reached as stopped, without waiting', () => {
    const history = [runEntry(run('a'))]
    const stop = decideStop(facts(history), inputs({ args: { id: 'a' } }))
    expect(stop.result).toMatchObject({ kind: 'ended', result: { isError: false, details: { stopped: true, run: 1 } } })
    expect(stop.ops).toMatchObject([
      { record: { value: { status: 'finished', outcome: 'stopped', modelStopped: true } }, key: 'subagent-end:a:1' }
    ])
    expect(stop.effects).toEqual([])
    const input = { runKey: keys.subagentMessage('a' as never, 1), run: 1, text: '', child: 'a' as never }
    expect(reportTarget(facts(apply(history, stop)), input)).toBeUndefined()
  })

  // Catches a person's or the budget's stop leaving a run no input has reached to its report job, which would start it
  // anyway, while message_subagent waited on a message never sent (G-C4 for every stopper).
  it('ends a run no input has reached for the person and the budget too', () => {
    const history = [runEntry(run('a'))]
    const user = decideUserStopSubagent(facts(history), 'a' as never)
    expect(user.ops).toMatchObject([
      { record: { value: { status: 'finished', outcome: 'stopped', stoppedBy: 'user' } }, key: 'subagent-end:a:1' },
      { type: 'ensure-job' }
    ])
    expect(user.effects).toEqual([])
    const budget = budgetStops(facts(history), ['a' as never])
    expect(budget.ops).toMatchObject([
      { record: { value: { status: 'finished', outcome: 'stopped', stoppedBy: 'budget' } }, key: 'subagent-end:a:1' }
    ])
    expect(budget.effects).toEqual([])
    expect(message(apply(history, budget)).result).toMatchObject({ kind: 'continued', run: 2 })
  })

  // Catches a steer for a run whose first input has not arrived: no run is going to take it, and starting one would
  // leave a run the parent never records (G-C5).
  it('refuses a message to a run that has not started yet', () => {
    expect(message([runEntry(run('a'))]).result).toMatchObject({
      kind: 'refused',
      text: expect.stringContaining('has not started its run yet')
    })
  })

  // Catches a stopped run recorded with its raw end, a second end record, or a model-stopped run waking the driver.
  it('records a run end once, as stopped when someone stopped it', () => {
    const history = [runEntry(run('a', { stoppedBy: 'budget' }))]
    const end = decideRunEnd(facts(history), 'a' as never, 1, { outcome: 'aborted', text: 'half' }, { partial: 'half' })
    expect(end.ops).toMatchObject([
      { record: { value: { status: 'finished', outcome: 'stopped', partial: 'half' } } },
      { type: 'ensure-job' }
    ])
    expect(decideRunEnd(facts(apply(history, end)), 'a' as never, 1, { outcome: 'aborted', text: '' }, {}).ops).toEqual(
      []
    )
    expect(
      reportTarget(facts(apply(history, end)), {
        runKey: keys.subagentMessage('a' as never, 1),
        run: 1,
        text: '',
        child: 'a' as never
      })
    ).toBeUndefined()
  })

  // Catches the 200-request cap missing a child, or capping the root conversation (D24).
  it('caps a child run at 200 requests', () => {
    expect(allowRequest(199, 'child')).toEqual({ ok: true })
    expect(allowRequest(200, 'child')).toMatchObject({ ok: false })
    expect(allowRequest(500, 'root')).toEqual({ ok: true })
  })
})
