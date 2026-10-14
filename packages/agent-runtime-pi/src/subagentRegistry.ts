import type { Usage } from '@earendil-works/pi-ai'
import type { SessionEntry } from '@earendil-works/pi-coding-agent'

import type { ToolApprovalEvent } from './ports'
import type { AgentRuntimeSession } from './session'
import type { SubagentDetails, SubagentOutcome, SubagentStopper } from './subagent'
import { type PendingDelivery, SUBAGENT_NOTIFICATION_TYPE, type SubagentNotificationDetails } from './subagentDelivery'
import {
  type RunResult,
  type RunStart,
  runSubagent,
  SUBAGENT_TOOL_NAME,
  type SubagentInbox,
  zeroUsage
} from './subagentRun'
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
  /** Set when the latest run was stopped. */
  stoppedBy?: SubagentStopper
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
  stoppedBy?: SubagentStopper
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
  /** Shortens a finished run's texts for the snapshot and the notification. */
  shorten(record: SubagentRecord, result: RunResult): Promise<RunResult>
  /** A background run ended and its snapshot is written; not called for runs the model stopped. */
  finished(record: SubagentRecord, result: RunResult): void
}

interface LiveRun {
  controller: AbortController
  inbox: SubagentInbox
  /** Settles with the run's result once its session is disposed and its end is recorded. */
  done: Promise<RunResult>
  /** Tool calls executing in its session, which approval events name. */
  calls: Set<string>
  /** A foreground run only: hands it to the background, where it goes on. */
  toBackground?: () => void
}

/** Ids listed in status messages and errors (spec §5.4). */
const LISTED = 20

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
  ...(record.stoppedBy === undefined ? {} : { stoppedBy: record.stoppedBy }),
  ...(result === undefined
    ? {}
    : {
        ...(result.report === undefined ? {} : { report: result.report }),
        ...(result.reason === undefined ? {} : { reason: result.reason }),
        ...(result.partial === undefined ? {} : { partial: result.partial }),
        usage: result.usage
      })
})

const fromState = (state: SubagentState): SubagentRecord => ({
  sessionId: state.sessionId,
  parentToolCallId: state.parentToolCallId,
  description: state.description,
  fork: state.fork,
  background: state.background,
  modelKey: state.modelKey,
  run: state.run,
  status: state.status,
  ...(state.outcome === undefined ? {} : { outcome: state.outcome }),
  ...(state.stoppedBy === undefined ? {} : { stoppedBy: state.stoppedBy })
})

/**
 * The parent's subagents as its branch records them (spec §4.3), least recently active first, and
 * the run ends that never reached the parent. A run whose last snapshot is `running` was cut off
 * with the session that held it: it is `interrupted`.
 */
export function restoreSubagents(
  entries: readonly SessionEntry[],
  parentModelKey: string
): { records: SubagentRecord[]; undelivered: PendingDelivery[] } {
  const calls = new Map<string, string>()
  const records = new Map<string, SubagentRecord>()
  const last = new Map<string, SubagentState>()
  const delivered = new Set<string>()
  const touch = <T>(map: Map<string, T>, key: string, value: T) => {
    map.delete(key)
    map.set(key, value)
  }
  for (const entry of entries) {
    if (entry.type === 'message' && entry.message.role === 'assistant')
      for (const block of entry.message.content)
        if (block.type === 'toolCall' && block.name === SUBAGENT_TOOL_NAME)
          calls.set(block.id, String(block.arguments.description ?? '').trim())
    if (
      entry.type === 'message' &&
      entry.message.role === 'toolResult' &&
      entry.message.toolName === SUBAGENT_TOOL_NAME
    ) {
      const details = entry.message.details as SubagentDetails | undefined
      // A background launch wrote its snapshot before its result.
      if (!details?.sessionId || records.has(details.sessionId)) continue
      touch(records, details.sessionId, {
        sessionId: details.sessionId,
        parentToolCallId: entry.message.toolCallId,
        description: calls.get(entry.message.toolCallId) ?? '',
        fork: details.fork,
        background: details.background,
        modelKey: parentModelKey,
        run: 1,
        status: 'finished',
        ...('outcome' in details ? { outcome: details.outcome } : {})
      })
    }
    if (entry.type === 'custom' && entry.customType === SUBAGENT_STATE_TYPE) {
      const state = entry.data as SubagentState
      touch(last, state.sessionId, state)
      touch(records, state.sessionId, fromState(state))
    }
    if (entry.type === 'custom_message' && entry.customType === SUBAGENT_NOTIFICATION_TYPE)
      for (const item of (entry.details as SubagentNotificationDetails).subagents)
        delivered.add(`${item.sessionId}:${item.run}`)
  }
  const undelivered: PendingDelivery[] = []
  for (const state of last.values()) {
    const record = records.get(state.sessionId)!
    if (state.status === 'running') {
      record.status = 'finished'
      record.outcome = 'interrupted'
    }
    if (delivered.has(`${state.sessionId}:${state.run}`) || state.stoppedBy === 'model') continue
    undelivered.push({
      sessionId: state.sessionId,
      run: state.run,
      description: state.description,
      outcome: record.outcome!,
      ...(state.stoppedBy === undefined ? {} : { stoppedBy: state.stoppedBy }),
      ...(state.report === undefined ? {} : { report: state.report }),
      ...(state.reason === undefined ? {} : { reason: state.reason }),
      ...(state.partial === undefined ? {} : { partial: state.partial }),
      usage: state.usage ?? zeroUsage(),
      // After a rebuild the user speaks first; the results ride with their message.
      wake: false
    })
  }
  return { records: [...records.values()], undelivered }
}

/** The parent's subagents: their state, live runs and the background cap. */
export class SubagentRegistry {
  private readonly records = new Map<string, SubagentRecord>()
  private readonly live = new Map<string, LiveRun>()
  /** Background launches past the cap check that have not started yet. */
  private launching = 0
  /** Continuations being set up, by subagent. */
  private readonly starting = new Map<string, Promise<unknown>>()
  private closing = false

  constructor(private readonly host: RegistryHost) {}

  get(sessionId: string): SubagentRecord | undefined {
    return this.records.get(sessionId)
  }

  /** Session start: the subagents the rebuilt branch records, least recently active first. */
  restore(records: readonly SubagentRecord[]): void {
    for (const record of records) this.track(record)
  }

  /** The most recently active subagents first, at most 20. */
  recent(): SubagentRecord[] {
    return [...this.records.values()].reverse().slice(0, LISTED)
  }

  /** Background subagents running or awaiting an approval, the most recently active first. */
  unfinished(): SubagentRecord[] {
    return [...this.records.values()].reverse().filter((record) => record.background && record.status !== 'finished')
  }

  /** Stops a running subagent; resolves with its run's result once its end is recorded. */
  stop(sessionId: string, by: SubagentStopper): Promise<RunResult> | undefined {
    const run = this.live.get(sessionId)
    const record = this.records.get(sessionId)
    if (!run || !record || record.status === 'finished') return undefined
    record.stoppedBy = by
    run.controller.abort()
    return run.done
  }

  /** A pending approval marks its subagent `awaiting_approval`; any other event, or the call ending, undoes it. */
  approval(event: ToolApprovalEvent): void {
    for (const [sessionId, run] of this.live)
      if (run.calls.has(event.toolCallId)) this.setWaiting(sessionId, event.kind === 'pending')
  }

  /** Resolves once the latest run of the subagent is over and recorded. */
  async recorded(sessionId: string): Promise<void> {
    await this.live.get(sessionId)?.done
  }

  /** The continuation of the subagent being set up, if any. */
  startingRun(sessionId: string): Promise<unknown> | undefined {
    return this.starting.get(sessionId)
  }

  /** Sets up the subagent's next run; until it is set up, other messages to it wait. */
  startRun<T>(sessionId: string, start: () => Promise<T>): Promise<T> {
    const started = start().finally(() => this.starting.delete(sessionId))
    this.starting.set(sessionId, started)
    return started
  }

  /** Queues `text` for a running subagent; false when its run has just ended. */
  message(sessionId: string, text: string): boolean {
    return this.live.get(sessionId)?.inbox.push(text) ?? false
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

  /**
   * Runs a foreground subagent within the parent's call: `signal` (the call's) stops it, and its
   * result is the call's. Resolves `undefined` when the user moves it to the background first:
   * the same run then goes on there, and its end is notified.
   */
  runForeground(
    record: SubagentRecord,
    child: AgentRuntimeSession,
    start: RunStart,
    inbox: SubagentInbox,
    signal: AbortSignal | undefined
  ): Promise<RunResult | undefined> {
    this.track(record)
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    else signal?.addEventListener('abort', onAbort, { once: true })
    const calls = this.watchCalls(record.sessionId, child)
    let moved = false
    let returnNow!: () => void
    const movedAway = new Promise<undefined>((resolve) => (returnNow = () => resolve(undefined)))
    const done = runSubagent(child, start, controller.signal, inbox).then(async (result) => {
      calls.stop()
      signal?.removeEventListener('abort', onAbort)
      this.end(record, result)
      if (moved) await this.record(record, child, result)
      else {
        await child.dispose().catch(() => undefined)
        this.live.delete(record.sessionId)
      }
      return result
    })
    const toBackground = () => {
      moved = true
      // From now on the parent's turn, aborted or not, does not reach it.
      signal?.removeEventListener('abort', onAbort)
      record.background = true
      this.host.appendState(snapshot(record))
      this.changed()
      returnNow()
    }
    this.live.set(record.sessionId, { controller, inbox, done, calls: calls.ids, toBackground })
    return Promise.race([done, movedAway])
  }

  /** The user moves a running foreground subagent to the background; false for any other. */
  moveToBackground(sessionId: string): boolean {
    const record = this.records.get(sessionId)
    const run = this.live.get(sessionId)
    if (!record || record.background || record.status === 'finished' || !run?.toBackground) return false
    run.toBackground()
    return true
  }

  /** Runs `child` in the background; the parent's turn does not wait for it or stop it. */
  startBackground(record: SubagentRecord, child: AgentRuntimeSession, start: RunStart, inbox: SubagentInbox): void {
    if (this.closing) {
      void child.dispose()
      return
    }
    record.background = true
    record.status = 'running'
    delete record.outcome
    delete record.stoppedBy
    this.track(record)
    this.host.appendState(snapshot(record))
    this.changed()
    const controller = new AbortController()
    const calls = this.watchCalls(record.sessionId, child)
    const done = runSubagent(child, start, controller.signal, inbox).then(async (result) => {
      calls.stop()
      // Finished at once, so a message sent from now on continues the subagent instead of joining this run.
      this.end(record, result)
      await this.record(record, child, result)
      return result
    })
    this.live.set(record.sessionId, { controller, inbox, done, calls: calls.ids })
  }

  /** Session shutdown: stops every live run and disposes its session, writing nothing. */
  async close(): Promise<void> {
    this.closing = true
    const runs = [...this.live.values()]
    for (const run of runs) run.controller.abort()
    await Promise.all(runs.map((run) => run.done))
  }

  private async record(record: SubagentRecord, child: AgentRuntimeSession, result: RunResult): Promise<void> {
    // A failing shutdown of the subagent's session must not keep its result from the parent.
    await child.dispose().catch(() => undefined)
    const shortened = this.closing ? result : await this.host.shorten(record, result)
    this.live.delete(record.sessionId)
    // Rebuilt from the transcript, a run whose last snapshot is `running` is interrupted.
    if (this.closing) return
    this.track(record)
    this.host.appendState(snapshot(record, shortened))
    this.changed()
    // The model that stopped it has its partial output from stop_subagent already.
    if (record.stoppedBy !== 'model') this.host.finished(record, shortened)
  }

  /** Follows the tool calls executing in a subagent's session, for its approval events. */
  private watchCalls(sessionId: string, child: AgentRuntimeSession): { ids: Set<string>; stop: () => void } {
    const ids = new Set<string>()
    const stop = child.session.subscribe((event) => {
      if (event.type === 'tool_execution_start') ids.add(event.toolCallId)
      if (event.type !== 'tool_execution_end') return
      ids.delete(event.toolCallId)
      this.setWaiting(sessionId, false)
    })
    return { ids, stop }
  }

  private setWaiting(sessionId: string, waiting: boolean): void {
    const record = this.records.get(sessionId)
    if (!record || record.status === 'finished') return
    const status = waiting ? 'awaiting_approval' : 'running'
    if (record.status === status) return
    record.status = status
    if (record.background) this.changed()
  }

  private end(record: SubagentRecord, result: RunResult): void {
    record.status = 'finished'
    record.outcome = record.stoppedBy ? 'stopped' : result.end
  }

  /** Adds `record` or moves it to the most recently active place. */
  private track(record: SubagentRecord): void {
    this.records.delete(record.sessionId)
    this.records.set(record.sessionId, record)
  }

  private changed(): void {
    this.host.emit({ type: 'subagents', subagents: this.views() })
  }
}
