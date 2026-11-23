import type { ConversationMessage } from './extraction'
import { utf8Length } from './files'

export interface TurnRef {
  userId: string
  responseId: string
  inputVersion: string
  responseVersion: string
  createdAt: number
}
interface Pending extends TurnRef {
  receivedAt: number
}
export interface ExtractionProgress {
  generation: number
  submitted: Record<string, string>
  pending: Pending[]
  settledAt: number
  settledIds: string[]
  recent?: TurnRef[]
  members?: string[]
  end?: string
  retryAt: number
  attempts: number
  sourceHash?: string
  intent?: { path: string; before: string | null; after: string | null }[]
}

/** The host serializes updates for each trusted owner/conversation key. */
export interface MemoryStateStore<T> {
  update<R>(key: string, operation: (previous: T | undefined) => { state: T; value: R }): Promise<R>
}

export function nextDaily(at: number): number {
  const date = new Date(at)
  date.setHours(21, 0, 0, 0)
  if (date.getTime() <= at) date.setDate(date.getDate() + 1)
  return date.getTime()
}

/** Use the successful reply as the endpoint. Gaps consume positions and never pull older turns in. */
export function automaticWindow(turns: readonly ({ user: ConversationMessage; reply: ConversationMessage } | null)[]) {
  const window = turns.slice(-8)
  const messages: ConversationMessage[] = []
  const contextGaps: { afterMessageId: string | null; beforeMessageId: string | null }[] = []
  let leftContextIncomplete = turns.length > 8
  let bytes = 0
  for (let i = window.length - 1; i >= 0; i--) {
    const turn = window[i]
    if (!turn) {
      contextGaps.unshift({
        afterMessageId: window[i - 1]?.reply.id ?? null,
        beforeMessageId: window[i + 1]?.user.id ?? null
      })
      continue
    }
    const sizes = [utf8Length(turn.user.text), utf8Length(turn.reply.text)]
    if (sizes.some((n) => n > 8000) || bytes + sizes[0] + sizes[1] > 32000) {
      leftContextIncomplete = true
      break
    }
    bytes += sizes[0] + sizes[1]
    messages.unshift(turn.user, turn.reply)
  }
  return { messages, contextGaps, leftContextIncomplete }
}

export class ExtractionQueue {
  constructor(
    private readonly states: MemoryStateStore<ExtractionProgress>,
    private readonly now: () => number
  ) {}
  private change<R>(key: string, fn: (s: ExtractionProgress) => R) {
    return this.states.update(key, (previous) => {
      const state: ExtractionProgress = previous ?? {
        generation: 0,
        submitted: {},
        pending: [],
        settledAt: -1,
        settledIds: [],
        retryAt: 0,
        attempts: 0
      }
      return { state, value: fn(state) }
    })
  }
  recordSubmission(key: string, id: string, inputVersion: string) {
    return this.change(key, (s) => {
      s.submitted[JSON.stringify(id)] ??= inputVersion
    })
  }
  admit(key: string, turn: TurnRef, selected: ReadonlySet<string>) {
    return this.change(key, (s) => {
      const idx = s.pending.findIndex((p) => p.userId === turn.userId)
      if (
        !selected.has(turn.userId) ||
        turn.createdAt < s.settledAt ||
        (turn.createdAt === s.settledAt && s.settledIds.includes(turn.userId))
      )
        return false
      if ((s.pending[idx]?.inputVersion ?? s.submitted[JSON.stringify(turn.userId)]) !== turn.inputVersion) return false
      if (s.pending[idx]?.responseId === turn.responseId && s.pending[idx]?.responseVersion === turn.responseVersion)
        return false
      const receivedAt = s.pending[idx]?.receivedAt ?? this.now()
      if (idx >= 0 || s.pending.some((t) => !selected.has(t.userId))) {
        s.generation++
        delete s.members
        delete s.end
        delete s.intent
      }
      s.pending = s.pending.filter((t) => selected.has(t.userId) && t.userId !== turn.userId)
      s.pending.push({ ...turn, receivedAt })
      s.pending.sort((a, b) => a.createdAt - b.createdAt)
      delete s.submitted[JSON.stringify(turn.userId)]
      return true
    })
  }
  due(key: string) {
    return this.change(key, (s) => {
      if (!s.pending.length || this.now() < s.retryAt) return undefined
      const cutoff = nextDaily(s.pending.reduce((first, t) => Math.min(first, t.receivedAt), Infinity))
      if (!s.end) {
        if (s.pending.length < 8 && this.now() < cutoff) return undefined
        const eligible = this.now() >= cutoff ? s.pending.filter((t) => t.receivedAt <= cutoff) : s.pending
        s.members = eligible.slice(0, 8).map((t) => t.userId)
        s.end = s.members[s.members.length - 1]
      }
      s.members ??= s.pending.slice(0, s.pending.findIndex((t) => t.userId === s.end) + 1).map((t) => t.userId)
      return {
        generation: s.generation,
        end: s.end,
        ancestors: s.recent ?? [],
        turns: s.pending.filter((t) => s.members!.includes(t.userId)),
        intent: s.intent,
        sourceHash: s.sourceHash
      }
    })
  }
  async check(key: string, generation: number) {
    await this.change(key, (s) => {
      if (s.generation !== generation) throw Error('Extraction invalidated')
    })
  }
  prepare(key: string, generation: number, sourceHash: string, intent: NonNullable<ExtractionProgress['intent']>) {
    return this.change(key, (s) => {
      if (s.generation !== generation) throw Error('Extraction invalidated')
      s.sourceHash = sourceHash
      s.intent = intent
    })
  }
  finish(key: string, generation: number, end: string) {
    return this.change(key, (s) => {
      if (s.generation !== generation || s.end !== end) throw Error('Extraction invalidated')
      const completed = s.pending.filter((t) => s.members?.includes(t.userId))
      s.pending = s.pending.filter((t) => !s.members?.includes(t.userId))
      s.recent = [...(s.recent ?? []), ...completed].slice(-8)
      const last = completed[completed.length - 1].createdAt
      s.settledIds = [
        ...(s.settledAt >= last ? s.settledIds : []),
        ...completed.filter((t) => t.createdAt === last).map((t) => t.userId)
      ]
      s.settledAt = Math.max(s.settledAt, last)
      s.generation++
      s.attempts = 0
      s.retryAt = 0
      delete s.members
      delete s.end
      delete s.intent
    })
  }
  defer(key: string, generation: number) {
    return this.change(key, (s) => {
      if (s.generation !== generation) return
      s.attempts++
      s.retryAt = s.attempts % 3 === 0 ? nextDaily(this.now()) : this.now() + 600000
    })
  }
  invalidate(key: string) {
    return this.change(key, (s) => {
      s.generation++
      s.recent = []
      s.pending = []
      s.submitted = {}
      delete s.members
      delete s.end
      delete s.intent
      s.attempts = 0
      s.retryAt = 0
    })
  }
}
