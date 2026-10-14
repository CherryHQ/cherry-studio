import type { Usage } from '@earendil-works/pi-ai'

import type { AgentRuntimeSession } from './session'
import type { SubagentOutcome } from './subagent'
import { type RunResult, runSubagent } from './subagentRun'
import type { AgentRuntimeEvent } from './transcriptTap'

/** State entry of the parent: one snapshot per change of a subagent's run. */
export const SUBAGENT_STATE_TYPE = 'cherry.subagent-state'

/** Background subagents one parent may run at once (Claude Code's default). */
export const DEFAULT_MAX_BACKGROUND = 20

export type SubagentStatus = 'running' | 'awaiting_approval' | 'finished'

/** One subagent of the parent session, as the parent's extension tracks it. */
export interface SubagentRecord {
  sessionId: string
  parentToolCallId: string
  description: string
  fork: boolean
  /** Whether the latest run is in the background (a continuation always is). */
  background: boolean
  modelKey: string
  /** The latest run, from 1. */
  run: number
  status: SubagentStatus
  outcome?: SubagentOutcome
}

/** Data of a `cherry.subagent-state` entry. */
export interface SubagentState {
  sessionId: string
  parentToolCallId: string
  description: string
  fork: boolean
  background: boolean
  modelKey: string
  run: number
  status: 'running' | 'finished'
  outcome?: SubagentOutcome
  report?: string
  reason?: string
  partial?: string
  usage?: Usage
}

/** A background subagent as the host shows it; carried by the parent's `subagents` event. */
export interface SubagentView {
  sessionId: string
  parentToolCallId: string
  description: string
  status: SubagentStatus
  outcome?: SubagentOutcome
}

/** What the registry needs from the parent session. */
export interface RegistryHost {
  appendState(state: SubagentState): void
  emit(event: AgentRuntimeEvent): void
  maxBackground: number
}

interface LiveRun {
  child: AgentRuntimeSession
  controller: AbortController
  done: Promise<void>
}

const snapshot = (record: SubagentRecord, result?: RunResult): SubagentState => ({
  sessionId: record.sessionId,
  parentToolCallId: record.parentToolCallId,
  description: record.description,
  fork: record.fork,
  background: record.background,
  modelKey: record.modelKey,
  run: record.run,
  status: record.status === 'finished' ? 'finished' : 'running',
  ...(record.outcome === undefined ? {} : { outcome: record.outcome }),
  ...(result === undefined
    ? {}
    : {
        ...(result.report === undefined ? {} : { report: result.report }),
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        ...(result.partial === undefined ? {} : { partial: result.partial }),
        usage: result.usage
      })
})

/** The parent's subagents: their state, live runs and the background cap. */
export class SubagentRegistry {
  private readonly records = new Map<string, SubagentRecord>()
  private readonly live = new Map<string, LiveRun>()
  /** Background launches past the cap check that have not started yet. */
  private launching = 0
  private closing = false

  constructor(private readonly host: RegistryHost) {}

  get(sessionId: string): SubagentRecord | undefined {
    return this.records.get(sessionId)
  }

  /** Background subagents running or waiting for an approval. */
  runningBackground(): number {
    let count = 0
    for (const record of this.records.values()) if (record.background && record.status !== 'finished') count++
    return count
  }

  /** Holds a background slot until the launch starts or fails; throws at the cap. */
  reserveBackground(): () => void {
    const running = this.runningBackground() + this.launching
    if (running >= this.host.maxBackground)
      throw new Error(
        `${running} background subagents are already running; wait for one to finish before starting another.`
      )
    this.launching++
    let held = true
    return () => {
      if (held) this.launching--
      held = false
    }
  }

  views(): SubagentView[] {
    return [...this.records.values()]
      .filter((record) => record.background)
      .map((record) => ({
        sessionId: record.sessionId,
        parentToolCallId: record.parentToolCallId,
        description: record.description,
        status: record.status,
        ...(record.outcome === undefined ? {} : { outcome: record.outcome })
      }))
  }

  /** Runs `task` on `child` in the background; the parent's turn does not wait for it or stop it. */
  startBackground(record: SubagentRecord, child: AgentRuntimeSession, task: string): void {
    record.background = true
    record.status = 'running'
    delete record.outcome
    this.records.set(record.sessionId, record)
    this.host.appendState(snapshot(record))
    this.changed()
    const controller = new AbortController()
    const done = runSubagent(child, task, controller.signal).then((result) => this.finish(record, child, result))
    this.live.set(record.sessionId, { child, controller, done })
  }

  /** Session shutdown: stops every live run and disposes its session, writing nothing. */
  async close(): Promise<void> {
    this.closing = true
    const runs = [...this.live.values()]
    for (const run of runs) run.controller.abort()
    await Promise.all(runs.map((run) => run.done))
  }

  private async finish(record: SubagentRecord, child: AgentRuntimeSession, result: RunResult): Promise<void> {
    this.live.delete(record.sessionId)
    // A failing shutdown of the subagent's session must not keep its result from the parent.
    await child.dispose().catch(() => undefined)
    // Rebuilt from the transcript, a run whose last snapshot is `running` is interrupted.
    if (this.closing) return
    record.status = 'finished'
    record.outcome = result.end
    this.host.appendState(snapshot(record, result))
    this.changed()
  }

  private changed(): void {
    this.host.emit({ type: 'subagents', subagents: this.views() })
  }
}
