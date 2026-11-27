import { isDeepStrictEqual } from 'node:util'

import { isToolUIPart } from 'ai'

import type {
  Activity,
  LivePartInput,
  MessageObservation,
  NativePartUpdate,
  ObservationPayload,
  RuntimeError,
  RuntimeMessage,
  Thread
} from '@cherrystudio/agent-runtime'
import {
  applyMessageParts,
  applyRuntimePartEdit,
  partEdits,
  cloneObservationValue,
  snapshotRuntimeMessage,
  snapshotToolPart
} from '@cherrystudio/agent-runtime'
import { loggerService } from '@logger'
import type { CherryUIMessage } from '@shared/data/types/message'

const logger = loggerService.withContext('ThreadMessageProjection')
type Gap = Extract<ObservationPayload, { type: 'gap' }>['reason']
type Closed = Extract<ObservationPayload, { type: 'closed' }>['reason']
interface ProjectionState {
  activity: Activity
  gap?: Gap
  closed?: Closed
  diagnostic?: RuntimeError
}
interface ThreadMessageView extends ProjectionState {
  messages: readonly CherryUIMessage[]
}
export type MessageDecorator = (
  message: CherryUIMessage,
  source: RuntimeMessage,
  unchangedParts?: ReadonlySet<number>
) => CherryUIMessage

export function projectRuntimeMessage(
  source: RuntimeMessage,
  parts: CherryUIMessage['parts'],
  decorate?: MessageDecorator,
  unchanged?: ReadonlySet<number>
): CherryUIMessage {
  const pending =
    source.metadata?.completeness === 'partial' ||
    source.parts.some(
      (part) =>
        part.type === 'dynamic-tool' &&
        (part.state === 'input-streaming' ||
          part.state === 'input-available' ||
          part.state === 'approval-requested' ||
          part.state === 'approval-responded' ||
          (part.state === 'output-available' && part.preliminary))
    )
  const normalized: CherryUIMessage = {
    id: source.id,
    role: source.role,
    parts,
    metadata: { status: pending ? 'pending' : 'success' }
  }
  const decorated = decorate?.(normalized, source, unchanged) ?? normalized
  return {
    ...decorated,
    parts: decorated.parts.map((part) =>
      isToolUIPart(part) && part.state === 'output-available' ? snapshotToolPart(part) : part
    )
  }
}

type CapturedObservation =
  | Omit<Extract<ObservationPayload, { type: 'snapshot' }>, 'inputs' | 'contextUsage' | 'subagents'>
  | Exclude<
      ObservationPayload,
      MessageObservation | NativePartUpdate | { type: 'snapshot' | 'input.changed' | 'subagent.upsert' }
    >
  | {
      type: 'source'
      message: RuntimeMessage
      replaces?: Extract<MessageObservation, { type: 'message.reconcile' }>['replaces']
      changedParts?: readonly number[]
    }

type AcceptedPartValue = {
  type: 'part-value'
  ref: NativePartUpdate['ref']
  part: number
  value: RuntimeMessage['parts'][number]
}

/** Main-owned current view. Native execution, product IDs and archive writes belong to its caller. */
export class ThreadMessageProjection {
  private entries = new Map<string, { source: RuntimeMessage; view: CherryUIMessage }>()
  private admitted = new Map<string, RuntimeMessage>()
  private readonly partUpdates = new Map<string, Map<number, AcceptedPartValue>>()
  private state: ProjectionState = { activity: { state: 'unknown' } }
  private pending: Promise<void> = Promise.resolve()
  private disposed = false
  private view?: ThreadMessageView

  constructor(
    readonly thread: Thread,
    private readonly decorate?: MessageDecorator
  ) {}

  snapshot(): ThreadMessageView {
    return (this.view ??= {
      ...this.state,
      messages: [...this.entries.values()].map((entry) => entry.view)
    })
  }

  part(nativeId: string, index: number): RuntimeMessage['parts'][number] | undefined {
    return this.partUpdates.get(nativeId)?.get(index)?.value ?? this.admitted.get(nativeId)?.parts[index]
  }

  drain(): Promise<void> {
    if (this.partUpdates.size) return this.accept([])
    return this.pending
  }

  stageParts(event: LivePartInput, length: number): ReadonlyMap<number, AcceptedPartValue> | undefined {
    const { ref } = event
    this.assertThread(ref.session)
    const source = this.admitted.get(ref.id)
    if (!source) return undefined
    const previous = this.partUpdates.get(ref.id)
    const accepted = new Map<number, AcceptedPartValue>()
    for (const edit of partEdits(event)) {
      const part = edit.part
      if (!Number.isSafeInteger(part) || part < 0 || part > length) return undefined
      const before = accepted.get(part)?.value ?? previous?.get(part)?.value ?? source.parts[part]
      if (event.type === 'message.tool-output' && before?.type !== 'dynamic-tool') return undefined
      const value = applyRuntimePartEdit(before, edit)
      if (!value) return undefined
      if (part === length) length++
      accepted.set(part, { type: 'part-value', ref, part, value })
    }
    if (previous) for (const [part, entry] of accepted) previous.set(part, entry)
    else this.partUpdates.set(ref.id, accepted)
    return accepted
  }

  async accept(
    event: ObservationPayload | readonly ObservationPayload[],
    refresh: readonly string[] | true = []
  ): Promise<void> {
    if (this.disposed) throw new Error('Thread projection is closed')
    if ('type' in event && event.type === 'subagent.upsert' && refresh !== true && !refresh.length) {
      this.assertThread(event.subagent.parent)
      return this.pending
    }
    const events: (ObservationPayload | AcceptedPartValue)[] = [...this.partUpdates.values()].flatMap((parts) => [
      ...parts.values()
    ])
    this.partUpdates.clear()
    events.push(...('type' in event ? [event] : event))
    const captured = events.flatMap((item): CapturedObservation | [] => {
      if (item.type === 'subagent.upsert') {
        this.assertThread(item.subagent.parent)
        return []
      }
      if (item.type === 'input.changed') return []
      if (item.type === 'message.parts') {
        this.assertThread(item.ref.session)
        const before = this.admitted.get(item.ref.id)
        const next = before && applyMessageParts(before, item.changes)
        if (!next || next === before) return []
        const changedParts = item.changes.map((edit) => edit.part)
        const message = snapshotRuntimeMessage(next, before, changedParts)
        this.admitted.set(message.id, message)
        return { type: 'source', message, changedParts }
      }
      if (
        item.type === 'part-value' ||
        item.type === 'message.text-open' ||
        item.type === 'message.text-append' ||
        item.type === 'message.text-finish' ||
        item.type === 'message.tool-output'
      ) {
        this.assertThread(item.ref.session)
        const before = this.admitted.get(item.ref.id)
        if (!before || item.part > before.parts.length) return []
        const old = before.parts[item.part]
        if (item.type === 'message.tool-output' && old?.type !== 'dynamic-tool') return []
        const part = item.type === 'part-value' ? item.value : applyRuntimePartEdit(old, partEdits(item)[0])
        if (!part) return []
        const parts = before.parts.slice()
        parts[item.part] = part
        const message = snapshotRuntimeMessage({ ...before, parts }, before, [item.part])
        this.admitted.set(message.id, message)
        return { type: 'source', message, changedParts: [item.part] }
      }
      if (item.type === 'snapshot') {
        item.subagents?.forEach((relation) => this.assertThread(relation.parent))
        const messages = item.messages.map((message) => {
          const previous = this.admitted.get(message.id)
          return previous && isDeepStrictEqual(previous, message) ? previous : snapshotRuntimeMessage(message)
        })
        this.admitted = new Map(messages.map((message) => [message.id, message]))
        return {
          type: 'snapshot',
          activity: cloneObservationValue(item.activity),
          messages
        }
      }
      if (item.type === 'message.reconcile') {
        const message = snapshotRuntimeMessage(item.message)
        for (const ref of item.replaces ?? []) if (ref.id !== message.id) this.admitted.delete(ref.id)
        this.admitted.set(message.id, message)
        return { type: 'source', message, replaces: cloneObservationValue(item.replaces) }
      }
      if (item.type === 'message.remove') this.admitted.delete(item.ref.id)
      return cloneObservationValue(item)
    })
    const accepted = this.pending.then(() => {
      const invalidated = new Set(refresh === true ? this.entries.keys() : refresh)
      try {
        for (const item of captured) {
          const refreshed =
            item.type === 'snapshot'
              ? invalidated
              : item.type === 'source' && invalidated.has(item.message.id)
                ? new Set([item.message.id])
                : new Set<string>()
          this.reduce(item, refreshed)
          if (item.type === 'snapshot') invalidated.clear()
          else if (item.type === 'source') invalidated.delete(item.message.id)
        }
        if (invalidated.size) this.reduce(undefined, invalidated)
      } catch (error) {
        const state = this.state
        this.state = {
          ...state,
          gap: 'mapping-reset',
          closed: 'consumer-error',
          diagnostic: { operation: 'project', code: 'projection-failed', message: String(error) }
        }
        this.view = undefined
        logger.warn('Thread projection requires a new observation baseline', { thread: this.thread, error })
        throw error
      }
    })
    this.pending = accepted.catch(() => {})
    return accepted
  }

  async close(): Promise<void> {
    this.disposed = true
    await this.pending
    this.admitted.clear()
    this.partUpdates.clear()
  }

  private assertThread(thread: Thread): void {
    if (thread.backendId !== this.thread.backendId || thread.id !== this.thread.id)
      throw new Error('Observation belongs to a different thread')
  }

  private reduce(event?: CapturedObservation, refresh: ReadonlySet<string> = new Set()): void {
    if (this.state.closed === 'consumer-error' && event?.type !== 'snapshot') return
    if (event?.type === 'source') event.replaces?.forEach((ref) => this.assertThread(ref.session))
    if (event?.type === 'message.remove') this.assertThread(event.ref.session)
    const state = this.state
    let nextState = state
    let candidates = new Map<string, RuntimeMessage>()
    let removed: string[] = []
    let order: string[] | undefined
    let orderChanged = false
    if (event?.type === 'snapshot') {
      candidates = new Map(event.messages.map((message) => [message.id, message]))
      removed = [...this.entries.keys()].filter((id) => !candidates.has(id))
      order = [...candidates.keys()]
      orderChanged = !isDeepStrictEqual([...this.entries.keys()], order)
      nextState = { activity: event.activity }
    } else if (event?.type === 'source' || event?.type === 'message.remove') {
      if (this.state.gap || this.state.closed) return
      if (event.type === 'message.remove') {
        removed = this.entries.has(event.ref.id) ? [event.ref.id] : []
        orderChanged = removed.length > 0
      } else {
        candidates.set(event.message.id, event.message)
        if (event.replaces?.some((ref) => ref.id !== event.message.id && this.entries.has(ref.id))) {
          const replaced = new Set<string>(event.replaces.map((ref) => ref.id))
          replaced.add(event.message.id)
          order = []
          let inserted = false
          for (const id of this.entries.keys()) {
            if (replaced.has(id)) {
              if (!inserted) order.push(event.message.id)
              inserted = true
            } else order.push(id)
          }
          removed = [...replaced].filter((id) => id !== event.message.id && this.entries.has(id))
          orderChanged = true
        } else orderChanged = !this.entries.has(event.message.id)
      }
    } else if (event?.type === 'activity.changed') nextState = { ...state, activity: event.activity }
    else if (event?.type === 'diagnostic') nextState = { ...state, diagnostic: event.error }
    else if (event?.type === 'gap' || event?.type === 'closed') {
      nextState = event.type === 'gap' ? { ...state, gap: event.reason } : { ...state, closed: event.reason }
    }
    for (const id of refresh) {
      const source = this.entries.get(id)?.source
      if (source && !candidates.has(id) && event?.type !== 'snapshot') candidates.set(id, source)
    }
    // Decorators may throw; commit only after every affected message has been projected.
    const projected = [...candidates.values()].map((source) => {
      const previous = this.entries.get(source.id)
      if (previous?.source === source && !refresh.has(source.id)) return previous
      return {
        source,
        view: this.project(
          source,
          refresh.has(source.id),
          event?.type === 'snapshot' ||
            (event?.type === 'source' && event.changedParts === undefined) ||
            refresh.has(source.id)
        )
      }
    })
    const changed = projected.some((entry) => entry.view !== this.entries.get(entry.view.id)?.view)
    for (const id of removed) this.entries.delete(id)
    for (const entry of projected) this.entries.set(entry.source.id, entry)
    if (order) this.entries = new Map(order.map((id) => [id, this.entries.get(id)!]))
    this.state = nextState
    if (changed || orderChanged || !isDeepStrictEqual(state, nextState)) this.view = undefined
  }

  private project(source: RuntimeMessage, refresh = false, reconcile = false): CherryUIMessage {
    const before = this.entries.get(source.id)
    const unchanged = new Set<number>()
    const parts = source.parts.map((part, index) => {
      if (!refresh && before?.source.parts[index] === part && before.view.parts[index]) {
        unchanged.add(index)
        return before.view.parts[index]
      }
      return cloneObservationValue(part) as CherryUIMessage['parts'][number]
    })
    const message = projectRuntimeMessage(source, parts, this.decorate, unchanged)
    const previous = before?.view
    if (!previous) return message
    const stable = message.parts.map((part, index) => {
      const old = previous.parts[index]
      if (old === part) return old
      if (reconcile && isDeepStrictEqual(old, part)) return old
      if (
        old &&
        (part.type === 'text' || part.type === 'reasoning') &&
        old.type === part.type &&
        isDeepStrictEqual(old, part)
      )
        return old
      return part
    })
    if (
      previous.role === message.role &&
      isDeepStrictEqual(previous.metadata, message.metadata) &&
      stable.length === previous.parts.length &&
      stable.every((part, index) => part === previous.parts[index])
    )
      return previous
    return { ...message, parts: stable }
  }
}
