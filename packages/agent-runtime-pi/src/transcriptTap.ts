import { getCurrentTools, type ImageContent, type Message, type TextContent } from '@earendil-works/pi-ai'
import {
  type AgentSessionEvent,
  buildSessionContext,
  type CompactionEntry,
  type SessionEntry,
  type SessionManager
} from '@earendil-works/pi-coding-agent'
import type { JSONValue } from 'ai'

import { AI_SDK_API } from './aiSdkProvider'
import { toModelMessage, toUserContent } from './modelMessages'
import type { TranscriptModel } from './rebuild'
import {
  STATE_TYPE_PREFIX,
  TOOL_LOADOUT_STATE,
  type TranscriptEntry,
  type TranscriptMessageEntry,
  type TranscriptStopReason
} from './transcript'

export type CompactionReason = 'manual' | 'threshold' | 'overflow'

export type AgentRuntimeEvent =
  /** New transcript entries in Pi order; every entry is emitted exactly once. */
  | { type: 'transcript-append'; entries: TranscriptEntry[] }
  | { type: 'compaction-start'; reason: CompactionReason }
  /** Follows the `transcript-append` of the new compaction entry. `error` is unset on success and abort. */
  | { type: 'compaction-end'; reason: CompactionReason; entryId?: string; error?: string }
  /** An agent run settled; every entry up to `headEntryId` has been emitted. */
  | { type: 'turn-complete'; headEntryId: string | undefined; aborted: boolean }

type Listener = (event: AgentRuntimeEvent) => void

const sameNames = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((n, i) => n === b[i])
// Emitted entries are copies in plain JSON, so the host can neither see nor mutate Pi's objects.
const plainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value))

const customMessageEntry = (
  base: { id: string; timestamp: number },
  message: { customType: string; content: string | (TextContent | ImageContent)[]; display: boolean; details?: unknown }
): TranscriptMessageEntry => ({
  ...base,
  kind: 'message',
  message: { role: 'user', content: toUserContent(message.content) },
  custom: { type: message.customType, display: message.display, details: message.details as JSONValue }
})

/**
 * Turns the Pi entries a session appends into transcript entries. It reads Pi's session as a
 * cursor after the replayed transcript and flushes on every session event, because Pi persists a
 * message only after notifying listeners of its `message_end`.
 */
export class TranscriptTap {
  private cursor: number
  private readonly known: Set<string>
  private head: string | undefined
  private baseTools: Set<string> | undefined
  private activatedTools: string[]
  /** Why the host summarizer failed during the running compaction. */
  summaryFailure: string | undefined

  constructor(
    private readonly sessionManager: SessionManager,
    private readonly model: TranscriptModel,
    replayed: { transcript: readonly TranscriptEntry[]; piEntryCount: number; activatedTools: string[] },
    private readonly listener: Listener
  ) {
    this.cursor = replayed.piEntryCount
    this.known = new Set(replayed.transcript.map((entry) => entry.id))
    this.head = replayed.transcript.at(-1)?.id
    this.activatedTools = replayed.activatedTools
  }

  /** The tools the session declares before any activation; loadout entries record the rest. */
  setBaseTools(names: readonly string[]): void {
    this.baseTools = new Set(names)
  }

  handle(event: AgentSessionEvent): void {
    switch (event.type) {
      case 'compaction_start':
        this.flush()
        this.summaryFailure = undefined
        this.listener({ type: 'compaction-start', reason: event.reason })
        return
      case 'compaction_end': {
        const entryId = this.flush().findLast((entry) => entry.kind === 'compaction')?.id
        // A failed host summarizer cancels the compaction, which Pi reports as an abort.
        const error = event.errorMessage ?? this.summaryFailure
        this.summaryFailure = undefined
        this.listener({
          type: 'compaction-end',
          reason: event.reason,
          ...(entryId === undefined ? {} : { entryId }),
          ...(error === undefined ? {} : { error })
        })
        return
      }
      case 'agent_settled':
        this.flush()
        this.listener({ type: 'turn-complete', headEntryId: this.head, aborted: event.aborted })
        return
      default:
        this.flush()
    }
  }

  /** Emits the entries Pi appended since the last flush and returns them. */
  flush(): TranscriptEntry[] {
    if (this.sessionManager.getEntryCount() === this.cursor) return []
    const appended = this.sessionManager.getEntries().slice(this.cursor)
    this.cursor += appended.length
    const entries: TranscriptEntry[] = []
    for (const piEntry of appended) {
      const entry = this.toTranscriptEntry(piEntry)
      if (!entry) continue
      entries.push(plainJson(entry))
      this.known.add(entry.id)
      this.head = entry.id
    }
    if (entries.length > 0) this.listener({ type: 'transcript-append', entries })
    return entries
  }

  private toTranscriptEntry(entry: SessionEntry): TranscriptEntry | undefined {
    const base = { id: entry.id, timestamp: Date.parse(entry.timestamp) }
    switch (entry.type) {
      case 'message': {
        const message = entry.message
        const at = { id: entry.id, timestamp: message.timestamp }
        switch (message.role) {
          case 'user':
          case 'toolResult': {
            const transcript: TranscriptMessageEntry = { ...at, kind: 'message', message: toModelMessage(message)! }
            if (message.role === 'toolResult' && message.details !== undefined)
              transcript.details = message.details as JSONValue
            return transcript
          }
          case 'assistant': {
            const fromModel =
              message.api === AI_SDK_API && message.provider === this.model.provider && message.model === this.model.id
            const { input, output, cacheRead, cacheWrite, reasoning } = message.usage
            return {
              ...at,
              kind: 'message',
              message: toModelMessage(message)!,
              ...(fromModel ? { modelKey: this.model.key } : {}),
              usage: { input, output, cacheRead, cacheWrite, ...(reasoning === undefined ? {} : { reasoning }) },
              stopReason: message.stopReason as TranscriptStopReason,
              ...(message.errorMessage === undefined ? {} : { errorMessage: message.errorMessage }),
              ...(message.responseId === undefined ? {} : { responseId: message.responseId })
            }
          }
          case 'system':
            return this.toolLoadout(entry.id, base.timestamp)
          case 'custom':
            return customMessageEntry(at, message)
          default:
            return undefined
        }
      }
      case 'custom_message':
        return customMessageEntry(base, entry)
      case 'custom':
        return entry.customType.startsWith(STATE_TYPE_PREFIX)
          ? { ...base, kind: 'state', type: entry.customType, data: entry.data as JSONValue }
          : undefined
      case 'compaction':
        return {
          ...base,
          kind: 'compaction',
          summary: entry.summary,
          firstKeptEntryId: this.firstKeptId(entry),
          tokensBefore: entry.tokensBefore,
          ...(entry.details === undefined ? {} : { details: entry.details as JSONValue })
        }
      case 'context_edit':
        // Pi itself only omits messages; replacing content is not carried (see README).
        return entry.replacement === null && this.known.has(entry.targetId)
          ? { ...base, kind: 'context-edit', targetId: entry.targetId, replacement: null }
          : undefined
      default:
        return undefined
    }
  }

  /** Records tools activated beyond the base tools when a Pi system entry changes the loadout. */
  private toolLoadout(entryId: string, timestamp: number): TranscriptEntry | undefined {
    if (!this.baseTools) return undefined
    const { messages } = buildSessionContext(this.sessionManager.getEntries(), entryId)
    const declared = getCurrentTools(messages as Message[]).map((tool) => tool.name)
    const activated = declared.filter((name) => !this.baseTools!.has(name))
    if (sameNames(activated, this.activatedTools)) return undefined
    this.activatedTools = activated
    return { id: entryId, timestamp, kind: 'state', type: TOOL_LOADOUT_STATE, data: { activated } }
  }

  /** Pi may keep from an entry the transcript leaves out; those carry no context, so the next kept entry is equivalent. */
  private firstKeptId(entry: CompactionEntry): string {
    if (this.known.has(entry.firstKeptEntryId)) return entry.firstKeptEntryId
    const path = this.sessionManager.getBranch(entry.id)
    const start = path.findIndex((candidate) => candidate.id === entry.firstKeptEntryId)
    return path.slice(start + 1).find((candidate) => this.known.has(candidate.id))?.id ?? entry.id
  }
}
