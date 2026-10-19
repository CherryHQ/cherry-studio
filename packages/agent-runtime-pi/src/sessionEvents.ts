import { getCurrentTools, type Message } from '@earendil-works/pi-ai'
import {
  type AgentSessionEvent,
  buildSessionContext,
  type SessionEntry,
  type SessionManager
} from '@earendil-works/pi-coding-agent'

import type { SubagentView } from './subagentRegistry'

const TOOL_LOADOUT_STATE = 'cherry.tool-loadout'

export type CompactionReason = 'manual' | 'threshold' | 'overflow'
export type AgentRuntimeEvent =
  | { type: 'subagents'; subagents: SubagentView[] }
  | { type: 'session-append'; entries: SessionEntry[] }
  | { type: 'input-placed'; inputId: string; entryId: string }
  | { type: 'compaction-start'; reason: CompactionReason }
  | { type: 'compaction-end'; reason: CompactionReason; entryId?: string; error?: string }
  | { type: 'turn-complete'; headEntryId: string | undefined; aborted: boolean }

/** Observes native entries; the session manager remains the only persistence writer. */
export class SessionEvents {
  private cursor: number
  private baseTools: Set<string> | undefined
  activatedTools: string[] = []
  summaryFailure: string | undefined

  constructor(
    private readonly manager: SessionManager,
    private readonly listener: (event: AgentRuntimeEvent) => void
  ) {
    this.cursor = manager.getEntryCount()
    const state = manager
      .getBranch()
      .findLast((entry) => entry.type === 'custom' && entry.customType === TOOL_LOADOUT_STATE)
    const data = state?.type === 'custom' ? state.data : undefined
    if (data && typeof data === 'object' && 'activated' in data && Array.isArray(data.activated)) {
      this.activatedTools = data.activated.filter((name): name is string => typeof name === 'string')
    }
  }

  setBaseTools(names: readonly string[]): void {
    this.baseTools = new Set(names)
  }

  handle(event: AgentSessionEvent): void {
    const entries = this.flush()
    switch (event.type) {
      case 'input_placed':
        this.listener({ type: 'input-placed', inputId: event.inputId, entryId: event.entryId })
        break
      case 'compaction_start':
        this.summaryFailure = undefined
        this.listener({ type: 'compaction-start', reason: event.reason })
        break
      case 'compaction_end': {
        const entryId = entries.findLast((entry) => entry.type === 'compaction')?.id
        const error = event.errorMessage ?? this.summaryFailure
        this.summaryFailure = undefined
        this.listener({
          type: 'compaction-end',
          reason: event.reason,
          ...(entryId ? { entryId } : {}),
          ...(error ? { error } : {})
        })
        break
      }
      case 'agent_settled':
        this.listener({
          type: 'turn-complete',
          headEntryId: this.manager.getLeafId() ?? undefined,
          aborted: event.aborted
        })
        break
    }
  }

  flush(): SessionEntry[] {
    if (this.manager.getEntryCount() === this.cursor) return []
    const start = this.cursor
    const entries = this.manager.getEntries().slice(start)
    for (const entry of entries) {
      if (entry.type === 'message' && entry.message.role === 'system') this.saveToolLoadout(entry.id)
    }
    const appended = this.manager.getEntries().slice(start)
    this.cursor = this.manager.getEntryCount()
    const copied: SessionEntry[] = JSON.parse(JSON.stringify(appended))
    this.listener({ type: 'session-append', entries: copied })
    return copied
  }

  private saveToolLoadout(entryId: string): void {
    if (!this.baseTools) return
    const { messages } = buildSessionContext(this.manager.getEntries(), entryId)
    const activated = getCurrentTools(messages as Message[])
      .map((tool) => tool.name)
      .filter((name) => !this.baseTools!.has(name))
    if (
      activated.length === this.activatedTools.length &&
      activated.every((name, i) => name === this.activatedTools[i])
    )
      return
    this.activatedTools = activated
    this.manager.appendCustomEntry(TOOL_LOADOUT_STATE, { activated })
  }
}
