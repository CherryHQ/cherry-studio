import { expect } from 'vitest'

import { assistantTexts, callTool, latch, reply, toolResults } from '../../../src/contract/fixtures'
import type { JobKind } from '../../../src/core/decisions'
import type { ConversationFacts } from '../../../src/core/facts'
import { capText } from '../../../src/core/subagents/subagentText'
import { startsTurn } from '../../../src/core/turns'
import type { HarnessPorts } from '../../../src/ports/harness'
import { markers, runRecords, wrapJob, wrapTool } from '../world'
import { deliveries, describeScenario, mostRunning } from './scenario'

const BACKGROUND = (description: string) => ({ description, prompt: `do ${description}`, background: true })
const ACKS = Array.from({ length: 4 }, (_, i) => reply(`ack ${i}`))
const finished = (facts: ConversationFacts) => runRecords(facts).filter((run) => run.status === 'finished')
/** For `WorldOptions.wrap`: `after` runs each time a job of `kind` returns. */
const afterJob =
  (kind: JobKind, after: () => void) =>
  (ports: HarnessPorts): HarnessPorts => ({
    ...ports,
    jobs: {
      register: (registered, handler) =>
        ports.jobs.register(
          registered,
          registered === kind
            ? async (bound, job) => {
                await handler(bound, job)
                after()
              }
            : handler
        )
    }
  })
/**
 * Every finished background run is delivered exactly once; a restart may cut a run (S-g), and a notification that
 * wakes the agent carries at least one result that wakes it.
 */
function deliveredOnce(facts: ConversationFacts, crashed: boolean) {
  const delivered = deliveries(facts)
  expect(delivered.map(({ sessionId, run }) => `${sessionId}:${run}`).sort()).toEqual(
    finished(facts)
      .map(({ sessionId, run }) => `${sessionId}:${run}`)
      .sort()
  )
  for (const { outcome } of delivered) expect(crashed ? ['completed', 'interrupted'] : ['completed']).toContain(outcome)
  for (const entry of facts.history)
    if (entry.kind === 'marker' && entry.marker.type === 'subagent-notification' && !entry.marker.quiet)
      expect(entry.marker.runs.some(({ outcome }) => outcome === 'completed')).toBe(true)
  return delivered
}

// Fixture 1.
describeScenario({
  name: 'a background subagent is spawned and its result delivered',
  catches: 'a result delivered twice or lost',
  options: { scripts: (_t, lineage) => (lineage.kind === 'subagent' ? [reply('found 3 files')] : []) },
  async setup(w) {
    const parent = await w.fake.createThread()
    w.fake.script(parent, [callTool('subagent', BACKGROUND('scan')), reply('waiting'), ...ACKS])
    return { parent }
  },
  async drive(w, { parent }) {
    await w.fake.sendUser(parent, 'go')
    await w.fake.settle()
  },
  async expect(w, { parent }, crashed) {
    const facts = await w.read(parent)
    expect(finished(facts)).toHaveLength(1)
    const [delivered] = deliveredOnce(facts, crashed)
    if (!crashed) expect(delivered.quiet).toBe(false)
  },
  roots: ({ parent }) => [parent]
})

// The G-C4 ruling's fixture: the report job's first read waits until the model's stop is in.
let firstRead = latch()
let stopAnswered = latch()
const heldRead = wrapJob('subagent-report', (ports) => ({
  ...ports,
  ledger: { ...ports.ledger, read: async (thread) => firstRead.promise.then(() => ports.ledger.read(thread)) }
}))
const stopWatched = wrapTool('stop_subagent', (run) => async (call, ports) => {
  const result = await run(call, ports)
  stopAnswered.release()
  return result
})
describeScenario({
  name: 'the model stops a background subagent before its first input',
  catches: 'a stop waiting for a run no input reached, or a stopped run that runs anyway (G-C4)',
  options: {
    wrap: (ports) => stopWatched(heldRead(ports)),
    scripts: (_t, lineage) => (lineage.kind === 'subagent' ? [reply('ran anyway')] : [])
  },
  async setup(w) {
    firstRead = latch()
    stopAnswered = latch()
    const parent = await w.fake.createThread()
    w.fake.script(parent, [
      callTool('subagent', BACKGROUND('scan')),
      callTool('stop_subagent', { id: 'thread-2' }),
      reply('stopped it'),
      ...ACKS
    ])
    return { parent }
  },
  async drive(w, { parent }) {
    await w.fake.sendUser(parent, 'go')
    await stopAnswered.promise
    firstRead.release()
    await w.fake.settle()
  },
  afterRestart: () => firstRead.release(),
  async expect(w, { parent }, crashed) {
    const facts = await w.read(parent)
    const [end] = finished(facts)
    const stopResult = toolResults(facts).find(({ tool }) => tool === 'stop_subagent')
    // After a restart the job may send the input before the model's stop arrives: then the stop finds a run to stop,
    // or one already done. Either way a run stopped did no work, and a run done was not stopped.
    if (crashed) {
      expect(['stopped', 'interrupted', 'completed']).toContain(end.outcome)
      if (end.outcome === 'stopped') expect(assistantTexts(await w.read(end.sessionId))).not.toContain('ran anyway')
      if (end.outcome === 'completed') expect(stopResult?.text).toMatch(/is not running/)
      return
    }
    expect(end.outcome).toBe('stopped')
    expect(markers(await w.read(end.sessionId), 'subagent-message')).toEqual([])
    expect(stopResult).toMatchObject({ isError: false })
  },
  roots: ({ parent }) => [parent]
})

// Fixture 2: the parent's hold is released once both report jobs have recorded their runs.
let reports = 0
let bothReported = latch()
const countReports = afterJob('subagent-report', () => {
  reports += 1
  if (reports === 2) bothReported.release()
})
describeScenario({
  name: 'two subagents finish while the parent works',
  catches: 'results that end together not merged into one message',
  options: {
    wrap: countReports,
    scripts: (thread, lineage) => (lineage.kind === 'subagent' ? [reply(`report of ${thread}`)] : [])
  },
  async setup(w) {
    reports = 0
    bothReported = latch()
    const parent = await w.fake.createThread()
    const spawn = (name: string) => ({ name: 'subagent', args: BACKGROUND(name) })
    w.fake.script(parent, [
      { text: '', toolCalls: [spawn('a'), spawn('b')] },
      callTool('hold', { id: 'parent' }),
      reply('both started'),
      ...ACKS
    ])
    return { parent }
  },
  async drive(w, { parent }, hold) {
    await w.fake.sendUser(parent, 'go')
    await hold.started('parent')
    await bothReported.promise
    hold.release('parent')
    await w.fake.settle()
  },
  afterRestart: (_prepared, hold) => hold.release('parent'),
  async expect(w, { parent }, crashed) {
    const facts = await w.read(parent)
    expect(deliveredOnce(facts, crashed)).toHaveLength(2)
    if (!crashed) expect(deliveries(facts).map(({ quiet }) => quiet)).toEqual([false, false])
    if (!crashed)
      expect(
        facts.history.filter((entry) => entry.kind === 'marker' && entry.marker.type === 'subagent-notification')
      ).toHaveLength(1)
  },
  roots: ({ parent }) => [parent]
})

// Fixture 3.
describeScenario({
  name: 'a result arrives after the person stopped the turn',
  catches: 'the agent woken while a stop suppresses results',
  options: {
    scripts: (thread, lineage) =>
      lineage.kind === 'subagent' ? [callTool('hold', { id: 'child' }), reply(`report of ${thread}`)] : []
  },
  async setup(w, hold) {
    const parent = await w.fake.createThread()
    w.fake.script(parent, [callTool('subagent', BACKGROUND('scan')), callTool('hold', { id: 'parent' }), ...ACKS])
    await w.fake.sendUser(parent, 'go')
    await hold.started('parent')
    await hold.started('child')
    await w.enter(parent, (entries, ports) => entries.userStop(ports, parent, 'stop-1'))
    return { parent }
  },
  async drive(w, _prepared, hold) {
    hold.release('child')
    await w.fake.settle()
  },
  afterRestart: (_prepared, hold) => hold.release('child'),
  async expect(w, { parent }, crashed) {
    const facts = await w.read(parent)
    const stop = facts.history.findIndex((entry) => entry.kind === 'record' && entry.record.type === 'turn-stop')
    expect(facts.history.slice(stop).filter(startsTurn)).toEqual([])
    const [delivered] = deliveredOnce(facts, crashed)
    expect(delivered.quiet).toBe(true)
  },
  roots: ({ parent }) => [parent]
})

// Fixture 9.
describeScenario({
  name: 'three background spawns in one reply with two slots',
  catches: 'more background subagents running than the cap allows',
  options: {
    settings: { maxBackground: 2 },
    scripts: (thread, lineage) =>
      lineage.kind === 'subagent' ? [callTool('hold', { id: 'children' }), reply(`report of ${thread}`)] : []
  },
  async setup(w) {
    const parent = await w.fake.createThread()
    const spawn = (name: string) => ({ name: 'subagent', args: BACKGROUND(name) })
    w.fake.script(parent, [
      { text: '', toolCalls: [spawn('a'), spawn('b'), spawn('c')] },
      callTool('hold', { id: 'parent' }),
      ...ACKS
    ])
    return { parent }
  },
  async drive(w, { parent }, hold) {
    await w.fake.sendUser(parent, 'go')
    await hold.started('parent')
    hold.release('children')
    hold.release('parent')
    await w.fake.settle()
  },
  afterRestart(_prepared, hold) {
    hold.release('children')
    hold.release('parent')
  },
  async expect(w, { parent }, crashed) {
    const facts = await w.read(parent)
    expect(mostRunning(facts)).toBeLessThanOrEqual(2)
    if (crashed) return
    const results = facts.history.flatMap((entry) => (entry.kind === 'tool-result' ? [entry] : []))
    expect(results[2]).toMatchObject({ text: capText(2), isError: true })
  },
  roots: ({ parent }) => [parent]
})
