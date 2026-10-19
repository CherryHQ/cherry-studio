import { describe, expect, it } from 'vitest'

import type { ThreadId } from '@cherrystudio/agent-runtime'

import { holds, type Holds } from '../../../src/contract/fixtures'
import type { Step } from '../../../src/core/decisions'
import { decideAtIdle } from '../../../src/core/driver/idle'
import { decodeEntry, encodeEntry } from '../../../src/core/entryCodec'
import type { ConversationFacts, HistoryEntry } from '../../../src/core/facts'
import type { ApprovalOutcome, CallInputs } from '../../../src/core/hostFacts'
import { pendingResults, subagentViews } from '../../../src/core/subagents/subagentLedger'
import type { BoundPorts, HarnessPorts } from '../../../src/ports/harness'
import { withoutEnvironment } from '../../core/purity'
import { type World, world, type WorldOptions } from '../world'

/** A scenario of design §12: an unswept setup, then the phase every crash point is chosen from. */
export type Scenario<P> = {
  readonly name: string
  /** The bug the scenario catches, in the words of design §12. */
  readonly catches: string
  readonly options?: Omit<WorldOptions, 'wrapCall'>
  /** `hold` is the run's own `hold` tool, registered in every conversation. */
  setup(w: World, hold: Holds): Promise<P>
  /**
   * Starts the work and settles; a crash may cut it at any await point. It waits only on ports and on latches its
   * wrappers release, never by polling: after a crash the runner drops it, and what it still does then must be
   * harmless.
   */
  drive(w: World, prepared: P, hold: Holds): Promise<void>
  /** Releases what a restart leaves waiting on the test (held tools), before the runner settles. */
  afterRestart?(prepared: P, hold: Holds): void
  /** What must hold at the end, with or without a crash in `drive` (I5's allowed outcomes). */
  expect(w: World, prepared: P, crashed: boolean): Promise<void>
  /** The root conversations whose end state the checks read. */
  roots(prepared: P): readonly ThreadId[]
}

type Decision = { readonly facts: ConversationFacts; decide(facts: ConversationFacts): Step; readonly step: Step }

/** Every transaction the package makes through `ports`, with the facts it decided on. */
function recording(ports: BoundPorts, log: Decision[]): BoundPorts {
  return {
    ...ports,
    ledger: {
      ...ports.ledger,
      transact: (thread, decide) =>
        ports.ledger.transact(thread, (facts) => {
          const step = decide(facts)
          log.push({ facts, decide, step })
          return step
        })
    }
  }
}
/** The ports `install` gets, so that every tool, job and lifecycle handler records its transactions. */
const recorded =
  (log: Decision[]) =>
  (ports: HarnessPorts): HarnessPorts => ({
    ...ports,
    tools: {
      register: (tool) => ports.tools.register({ ...tool, run: (call, p) => tool.run(call, recording(p, log)) })
    },
    jobs: { register: (kind, handler) => ports.jobs.register(kind, (p, job) => handler(recording(p, log), job)) },
    lifecycle: {
      register: (handlers) =>
        ports.lifecycle.register({
          onOpen: (thread, open, p) => handlers.onOpen(thread, open, recording(p, log)),
          onCompacting: handlers.onCompacting,
          onCompacted: (thread, p) => handlers.onCompacted(thread, recording(p, log)),
          onClose: (thread, p) => handlers.onClose(thread, recording(p, log))
        })
    }
  })

/** A fresh world and `hold` tool for one run of the scenario. */
function open<P>(scenario: Scenario<P>, log: Decision[] = []): { readonly w: World; readonly hold: Holds } {
  const hold = holds()
  const extra = (ports: HarnessPorts) => {
    ports.tools.register(hold.tool)
    scenario.options?.extra?.(ports)
  }
  const options = { ...scenario.options, extra }
  const wrap = (ports: HarnessPorts) => recorded(log)(scenario.options?.wrap?.(ports) ?? ports)
  return { w: world({ ...options, wrap, wrapCall: (ports) => recording(ports, log) }), hold }
}

/** The approval outcomes the host keeps for `facts.thread` and its children, as one decision on it gathers them. */
async function approvalsOf(w: World, facts: ConversationFacts): Promise<ApprovalOutcome[]> {
  const threads = [facts.thread, ...facts.children.keys()]
  return (await Promise.all(threads.map((thread) => w.host.approvals.outcomes(thread, [])))).flat()
}

async function inputsOf(w: World, facts: ConversationFacts): Promise<CallInputs> {
  const settings = w.host.settings
  return {
    now: 0,
    settings: {
      goalDefaults: settings.goalDefaults(),
      autonomy: settings.autonomy(),
      permissionMode: settings.permissionMode(facts.thread),
      attendance: settings.attendance(facts.thread),
      maxBackground: settings.maxBackground(),
      offloadThreshold: settings.offloadThreshold()
    },
    approvals: await approvalsOf(w, facts)
  }
}

/**
 * I1: what the run built up live is what a full recompute over the final history concludes: nothing is left to
 * deliver, the driver had nothing left to do when it exited, and the last views the host got are the current ones.
 */
async function sameAsRecompute(w: World, roots: readonly ThreadId[]): Promise<void> {
  for (const thread of roots) {
    const facts = await w.read(thread)
    expect(pendingResults(facts.history), `undelivered results on ${thread}`).toEqual([])
    expect(decideAtIdle(facts, await inputsOf(w, facts)).result.kind, `the driver's work on ${thread}`).toBe('done')
    const shown = w.host.emitted.filter((event) => event.type === 'subagents' && event.thread === thread).at(-1)
    if (shown?.type === 'subagents')
      expect(shown.views, `the views shown for ${thread}`).toEqual(subagentViews(facts, await approvalsOf(w, facts)))
  }
}

/** I4: no keyed write happened twice; every conversation holds each key at most once. */
function keysOnce(w: World): void {
  const log = w.fake.persistentLog() as { threads: { id: string; entries: { key?: string }[] }[] }
  for (const thread of log.threads) {
    const keyed = thread.entries.flatMap((entry) => (entry.key === undefined ? [] : [entry.key]))
    expect(keyed.length, `repeated keys on ${thread.id}`).toBe(new Set(keyed).size)
  }
}

const wire = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
/** An entry as an adapter stores and reads it back: custom kinds through the codec, the rest as JSON. */
function stored(entry: HistoryEntry): HistoryEntry {
  if (entry.kind !== 'record' && entry.kind !== 'marker') return wire(entry)
  const { kind, data } = encodeEntry(entry.kind === 'record' ? entry.record : entry.marker, entry.key)
  const text = entry.kind === 'marker' ? { text: entry.text } : {}
  const decoded = decodeEntry({ id: entry.id, kind, data: wire(data), ...text })
  if (!decoded) throw new Error(`${kind} did not decode`)
  return decoded
}
const storedFacts = (facts: ConversationFacts): ConversationFacts => ({
  thread: facts.thread,
  lineage: wire(facts.lineage),
  history: facts.history.map(stored),
  live: wire(facts.live),
  children: new Map(wire([...facts.children])),
  keysSeen: new Set(wire([...facts.keysSeen]))
})

/** Runs a scenario three ways (design §12): to the end, crashed at every await point, and replayed into the core. */
export function describeScenario<P>(scenario: Scenario<P>): void {
  describe(`${scenario.name} (catches ${scenario.catches})`, () => {
    // Catches the scenario's bug on an uninterrupted run, and live state a full recompute disagrees with (I1).
    it('runs to the end, and what it built up equals a full recompute', async () => {
      const { w, hold } = open(scenario)
      const prepared = await scenario.setup(w, hold)
      await scenario.drive(w, prepared, hold)
      await scenario.expect(w, prepared, false)
      await sameAsRecompute(w, scenario.roots(prepared))
      keysOnce(w)
    })

    // Catches work a crash at any await point of the driven phase loses or repeats (I4, I5: an allowed outcome, every
    // keyed write once). The crash is armed before the call that starts the work (Stage A Task 9).
    it('recovers from a crash at every await point', async () => {
      const baseline = open(scenario)
      const ready = await scenario.setup(baseline.w, baseline.hold)
      const from = baseline.w.fake.awaitPoints
      await scenario.drive(baseline.w, ready, baseline.hold)
      const points = baseline.w.fake.awaitPoints - from
      expect(points).toBeGreaterThan(0)
      for (let n = 1; n <= points; n++) {
        const { w, hold } = open(scenario)
        const prepared = await scenario.setup(w, hold)
        w.fake.crashAt(n)
        const driven = scenario.drive(w, prepared, hold).then(
          () => false,
          () => false
        )
        expect(await Promise.race([driven, w.fake.whenCrashed().then(() => true)]), `crash at point ${n}`).toBe(true)
        await w.fake.restart()
        scenario.afterRestart?.(prepared, hold)
        await w.fake.settle()
        await scenario.expect(w, prepared, true)
        await sameAsRecompute(w, scenario.roots(prepared))
        keysOnce(w)
      }
    })

    // Catches a decision that depends on more than the stored form of its facts (I2): replayed in reverse order with
    // clock and randomness unavailable, every decision the run made must come out the same.
    it('decides the same again from the stored facts', async () => {
      const log: Decision[] = []
      const { w, hold } = open(scenario, log)
      const prepared = await scenario.setup(w, hold)
      await scenario.drive(w, prepared, hold)
      expect(log.length).toBeGreaterThan(0)
      for (const { facts, decide, step } of [...log].reverse()) {
        const final = (await w.read(facts.thread)).history
        expect(final.slice(0, facts.history.length)).toEqual(facts.history)
        expect(withoutEnvironment(() => decide(storedFacts(facts)))).toEqual(step)
      }
    })
  })
}

/** Each delivered run, once per notification that carried it. */
export const deliveries = (facts: ConversationFacts) =>
  facts.history.flatMap((entry) =>
    entry.kind === 'marker' && entry.marker.type === 'subagent-notification'
      ? entry.marker.runs.map(({ sessionId, run, outcome }) => ({
          sessionId,
          run,
          outcome,
          quiet: entry.marker.type === 'subagent-notification' && entry.marker.quiet
        }))
      : []
  )
/** The most background runs that were recorded running at once. */
export function mostRunning(facts: ConversationFacts): number {
  const running = new Set<string>()
  let most = 0
  for (const entry of facts.history)
    if (entry.kind === 'record' && entry.record.type === 'subagent-run' && entry.record.value.background) {
      const { sessionId, run, status } = entry.record.value
      if (status === 'running') running.add(`${sessionId}:${run}`)
      else running.delete(`${sessionId}:${run}`)
      most = Math.max(most, running.size)
    }
  return most
}
