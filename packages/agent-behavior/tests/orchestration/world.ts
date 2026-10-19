import type { ThreadId } from '@cherrystudio/agent-runtime'

import type { ScriptedReply } from '../../src/contract/harness'
import type { JobKind } from '../../src/core/decisions'
import type { ConversationFacts, HistoryEntry, MarkerFact, PolicyRecord } from '../../src/core/facts'
import type { ApprovalHostFacts, HostSettingsSnapshot } from '../../src/core/hostFacts'
import { createFakeHarness, type FakeHarness } from '../../src/fake/fakeHarness'
import { createScriptedHost, type ScriptedHost, type ScriptedHostOptions } from '../../src/fake/scriptedHost'
import type { Entries } from '../../src/orchestration/entries'
import { install } from '../../src/orchestration/install'
import type { BoundPorts, HarnessPorts, ToolDefinition } from '../../src/ports/harness'
import type { HostPorts } from '../../src/ports/host'

export const SETTINGS: HostSettingsSnapshot = {
  goalDefaults: { maxGoalRounds: 8, maxGoalRoundsCeiling: 50, blockedAfter: 3 },
  autonomy: 'auto',
  permissionMode: 'default',
  attendance: 'stream',
  maxBackground: 4,
  offloadThreshold: 20_000
}
/** Every call runs without asking unless a test says otherwise. */
export const ALLOWED: ApprovalHostFacts = {
  category: 'other',
  disabled: false,
  autoApproved: true,
  approvalRequired: false,
  nonBypassable: false,
  withinAllowedRoots: true,
  destructive: false
}

export type WorldOptions = {
  readonly settings?: Partial<HostSettingsSnapshot>
  readonly host?: Omit<ScriptedHostOptions, 'settings'>
  readonly scripts?: (thread: ThreadId, lineage: ConversationFacts['lineage']) => readonly ScriptedReply[]
  /** Registers test-only tools or handlers after the package installed (at open and after every restart). */
  readonly extra?: (ports: HarnessPorts) => void
  /** Wraps what the package receives, as the scenario runner's recorder does. */
  readonly wrap?: (ports: HarnessPorts) => HarnessPorts
  /** Wraps the ports a host entry receives. */
  readonly wrapCall?: (ports: BoundPorts) => BoundPorts
  /** Replaces host ports the package gets, keeping the scripted host's controls. */
  readonly patchHost?: (host: ScriptedHost) => HostPorts
}
export type World = {
  readonly fake: FakeHarness
  readonly host: ScriptedHost
  /** Runs a host entry with the ports of one host call on `thread`. */
  enter<T>(thread: ThreadId, use: (entries: Entries, ports: BoundPorts) => Promise<T>): Promise<T>
  read(thread: ThreadId): Promise<ConversationFacts>
}

/** The most commits one tool call or job run may make; the fake answers in microtasks, so a spin never times out. */
const COMMIT_CAP = 200
function capped(ports: BoundPorts): BoundPorts {
  let commits = 0
  return {
    ...ports,
    ledger: {
      ...ports.ledger,
      transact: (thread, decide) =>
        ++commits > COMMIT_CAP
          ? Promise.reject(new Error(`More than ${COMMIT_CAP} commits in one call: a decision loop spins`))
          : ports.ledger.transact(thread, decide)
    }
  }
}
const capCommits = (ports: HarnessPorts): HarnessPorts => ({
  ...ports,
  tools: { register: (tool) => ports.tools.register({ ...tool, run: (call, bound) => tool.run(call, capped(bound)) }) },
  jobs: { register: (kind, handler) => ports.jobs.register(kind, (bound, job) => handler(capped(bound), job)) }
})

/** A fake harness with the package installed on a scripted host. */
export function world(options: WorldOptions = {}): World {
  const host = createScriptedHost({
    settings: { ...SETTINGS, ...options.settings },
    approvalFacts: () => ALLOWED,
    ...options.host
  })
  let entries: Entries | undefined
  const fake = createFakeHarness({
    scripts: options.scripts,
    install: (ports) => {
      const wrapped = capCommits(options.wrap ? options.wrap(ports) : ports)
      entries = install(wrapped, options.patchHost?.(host) ?? host).entries
      options.extra?.(ports)
    }
  })
  return {
    fake,
    host,
    enter: (thread, use) =>
      fake.withCall(thread, (ports) => use(entries!, options.wrapCall ? options.wrapCall(ports) : ports)),
    read: (thread) => fake.withCall(thread, (ports) => ports.ledger.read(thread))
  }
}

export const records = <T extends PolicyRecord['type']>(facts: ConversationFacts, type: T) =>
  facts.history.flatMap((entry) =>
    entry.kind === 'record' && entry.record.type === type ? [entry.record as Extract<PolicyRecord, { type: T }>] : []
  )
export const markers = <T extends MarkerFact['type']>(facts: ConversationFacts, type: T) =>
  facts.history.flatMap((entry) =>
    entry.kind === 'marker' && entry.marker.type === type
      ? [entry as Extract<HistoryEntry, { kind: 'marker' }> & { readonly marker: Extract<MarkerFact, { type: T }> }]
      : []
  )
export const runRecords = (facts: ConversationFacts) => records(facts, 'subagent-run').map(({ value }) => value)

/** For `WorldOptions.wrap`: job handlers of `kind` receive `wrapBound` of their ports. */
export const wrapJob =
  (kind: JobKind, wrapBound: (ports: BoundPorts) => BoundPorts) =>
  (ports: HarnessPorts): HarnessPorts => ({
    ...ports,
    jobs: {
      register: (registered, handler) =>
        ports.jobs.register(registered, registered === kind ? (bound, job) => handler(wrapBound(bound), job) : handler)
    }
  })

/** For `WorldOptions.wrap`: the tool `name` runs through `around`. */
export const wrapTool =
  (name: string, around: (run: ToolDefinition['run']) => ToolDefinition['run']) =>
  (ports: HarnessPorts): HarnessPorts => ({
    ...ports,
    tools: {
      register: (tool) =>
        ports.tools.register(
          tool.name === name ? { ...tool, run: around((call, bound) => tool.run(call, bound)) } : tool
        )
    }
  })
