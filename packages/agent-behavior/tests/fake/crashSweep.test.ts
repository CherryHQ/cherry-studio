import { describe, expect, it } from 'vitest'

import type { JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import { callTool, childSpec, echoTool, message, reply, runRecordOf } from '../../src/contract/fixtures'
import { callKeyOf } from '../../src/core/facts'
import { keys } from '../../src/core/keys'
import { createFakeHarness, type FakeHarness } from '../../src/fake/fakeHarness'
import type { JobHandler } from '../../src/ports/harness'

const CALL = callKeyOf('sweep:call-1')
const SPAWN = keys.subagentSpawn(CALL)

/** A design §7.5-shaped report job: spawn a background child, message it, await the answer, memoize, record the end. */
const reportJob: JobHandler = async (ports, job) => {
  const parent = job.scope
  await ports.ledger.transact(parent, (f) => ({
    ops: f.keysSeen.has(SPAWN) ? [] : [{ type: 'spawn-child', spec: childSpec('background', 'sweep'), key: SPAWN }],
    effects: [],
    result: null
  }))
  const child = runRecordOf(await ports.ledger.read(parent), SPAWN)!.sessionId
  const messageKey = keys.subagentMessage(child, 1)
  const { run } = await ports.helpers.message(child, message('do it'), messageKey)
  const answer = await ports.helpers.awaitAnswer(child, run, messageKey)
  const length = await ports.memory.remember(keys.verdictMemo(CALL), async () => answer.text.length)
  const end = keys.subagentEnd(child, run)
  const record = {
    ...childSpec('background', 'sweep').record,
    sessionId: child,
    status: 'finished' as const,
    outcome: 'completed' as const,
    report: `${answer.text} (${length})`
  }
  await ports.ledger.transact(parent, (f) => ({
    ops: f.keysSeen.has(end)
      ? []
      : [{ type: 'append-record', thread: parent, record: { type: 'subagent-run', value: record }, key: end }],
    effects: [],
    result: null
  }))
}

/** A parent with the report job ensured; `crashAt` counts from the ensuring call's await point, which is point 1. */
async function prepared(crashAt?: number): Promise<{ fake: FakeHarness; parent: ThreadId; from: number }> {
  const fake = createFakeHarness({
    install: (p) => {
      p.tools.register(echoTool())
      p.jobs.register('subagent-report', reportJob)
    },
    scripts: (_thread, lineage) =>
      lineage.kind === 'subagent' ? [callTool('echo', { text: 'x' }), reply('report')] : []
  })
  const parent = await fake.createThread()
  // Armed before the ensuring call: the job starts on the commit's microtask and passes await points before it returns.
  const from = fake.awaitPoints
  if (crashAt !== undefined) fake.crashAt(crashAt)
  await fake.withCall(parent, (p) =>
    p.ledger.transact(parent, () => ({
      ops: [
        {
          type: 'ensure-job',
          job: { kind: 'subagent-report', scope: parent, input: null, onRestart: 'resume' },
          key: keys.subagentReport(SPAWN)
        }
      ],
      effects: [],
      result: null
    }))
  )
  return { fake, parent, from }
}

/** Item ids are allocated by a global counter, so the interleaving of threads after a restart may shift them. */
const withoutItemIds = (log: JsonValue): JsonValue =>
  JSON.parse(
    JSON.stringify(log, (name, value: unknown) =>
      name === 'id' && typeof value === 'string' && value.startsWith('item-') ? undefined : value
    )
  )

describe('crash sweep', () => {
  // Catches crash recovery that loses or repeats work (I4, I5): crashing at every await point of a keyed report job and
  // restarting must reproduce the uncrashed log, and the child must receive exactly one input (Review focus 5).
  it('recovers to the uncrashed log from a crash at every await point', async () => {
    const baseline = await prepared()
    await baseline.fake.settle()
    const points = baseline.fake.awaitPoints - baseline.from
    const expected = withoutItemIds(baseline.fake.persistentLog())
    const finished = await baseline.fake.withCall(baseline.parent, (p) => p.ledger.read(baseline.parent))
    const child = runRecordOf(finished, SPAWN)!.sessionId
    expect(runRecordOf(finished, keys.subagentEnd(child, 1))?.report).toBe('report (6)')
    expect(points).toBeGreaterThan(5)
    // Point 1 is the ensuring call: a crash there commits no job, so there is nothing to recover.
    for (let n = 2; n <= points; n++) {
      const { fake, parent } = await prepared(n)
      const crashed = await Promise.race([fake.settle().then(() => false), fake.whenCrashed().then(() => true)])
      expect(crashed, `the crash at await point ${n} fired`).toBe(true)
      await fake.restart()
      await fake.settle()
      expect(withoutItemIds(fake.persistentLog()), `crash at await point ${n}`).toEqual(expected)
      const recovered = runRecordOf(await fake.withCall(parent, (p) => p.ledger.read(parent)), SPAWN)!.sessionId
      const inputs = (await fake.withCall(recovered, (p) => p.ledger.read(recovered))).history.filter(
        (e) => e.kind === 'marker'
      )
      expect(inputs.length, `child inputs after a crash at await point ${n}`).toBe(1)
    }
  })
})
