import type { JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import type { UsageFact } from '../core/facts'
import type { BoundPorts, HarnessPorts, PortMethod } from '../ports/harness'

export type ScriptedToolCall = { readonly name: string; readonly args: JsonValue }
/** One model reply: text with optional tool calls and usage, or a failed request. */
export type ScriptedReply =
  | { readonly text: string; readonly toolCalls?: readonly ScriptedToolCall[]; readonly usage?: UsageFact }
  | { readonly error: string }

/** What an adapter's test setup implements so the contract cases can drive its harness. */
export interface ContractHarness {
  /** Creates a root conversation; `onOpen(reopened: false)` has run for it when this resolves. */
  createThread(): Promise<ThreadId>
  /** Runs `use` with outbound ports bound to a fresh job-like call on `thread`; they expire when `use` settles. */
  withCall<T>(thread: ThreadId, use: (ports: BoundPorts) => Promise<T>): Promise<T>
  /** Appends replies the model gives `thread`'s runs, in order; a request past the end fails its run. */
  script(thread: ThreadId, replies: readonly ScriptedReply[]): void
  /**
   * Delivers a person's text as user input; if the conversation is busy it stays in the inbox and is handled with
   * leftover semantics.
   */
  sendUser(thread: ThreadId, text: string): Promise<void>
  /** Compacts `thread` now (a compaction entry appears), then calls `onCompacted`. */
  compact(thread: ThreadId): Promise<void>
  /** Resolves once no run is active and no job is live; inbox items a failed run left do not count. */
  settle(): Promise<void>
  /**
   * Loses everything in memory and reopens from storage: install runs again, 'abandon' jobs are dropped,
   * `onOpen(reopened: true)` runs for every conversation, then runs and 'resume' jobs continue.
   */
  restart(): Promise<void>
  /** Calls `onClose` for every conversation, then shuts down. */
  close(): Promise<void>
}
/** Opens a fresh harness; `install` registers handlers at open and again after each restart. */
export type OpenContractHarness = (install: (ports: HarnessPorts) => void) => Promise<ContractHarness>
/** A capability a case needs; a harness without it skips the case (coding-agent: restart; Durable: context-filter). */
export type ContractNeed = 'restart' | 'context-filter'
export interface ContractCase {
  readonly name: string
  readonly covers: readonly PortMethod[]
  readonly needs: readonly ContractNeed[]
  run(open: OpenContractHarness): Promise<void>
}
