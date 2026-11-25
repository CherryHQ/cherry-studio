import { isToolUIPart } from 'ai'

import { snapshotToolPart } from './acceptedToolPart'
import type {
  InputId,
  LivePartInput,
  Observation,
  ObservationPayload,
  ObservationSink,
  ProjectionEvents,
  RuntimeMessage,
  ThreadSnapshot
} from './contracts'
import { immutable } from './immutable'
import { stagePartUpdate } from './stagePartUpdate'
import { projectionEvents } from './textPartUpdates'

/** Reuses accepted parts when the producer identifies the changed positions. */
export function snapshotRuntimeMessage(
  message: RuntimeMessage,
  previous?: RuntimeMessage,
  changedParts?: readonly number[]
): RuntimeMessage {
  const changed = changedParts && new Set(changedParts)
  const parts = message.parts.map((part, index) => {
    if (previous?.parts[index] && changed && !changed.has(index)) return previous.parts[index]
    return isToolUIPart(part) && part.state === 'output-available' ? snapshotToolPart(part) : immutable(part)
  })
  return immutable(parts.every((part, index) => part === message.parts[index]) ? message : { ...message, parts })
}

/** Bounded delivery for normalized facts; never schedules native execution. */
export class ThreadFeed {
  private observers = new Set<{
    send(event: ObservationPayload): void
    stop(): void
  }>()
  private ended = false
  private value: Omit<ThreadSnapshot, 'messages'> & { messages: RuntimeMessage[] }
  private cachedSnapshot?: ThreadSnapshot
  private readonly messageIndices = new Map<string, number>()
  private readonly partChanges = new Map<
    string,
    { parts: Map<number, RuntimeMessage['parts'][number]>; length: number }
  >()

  constructor(
    value: ThreadSnapshot,
    private readonly report: (error: unknown) => void
  ) {
    this.cachedSnapshot = immutable({
      ...value,
      messages: value.messages.map((message) => snapshotRuntimeMessage(message))
    })
    this.value = { ...this.cachedSnapshot, messages: this.cachedSnapshot.messages.slice() }
    this.indexMessages()
  }

  /** The current frozen snapshot, shared with observers rather than copied. */
  get snapshot(): ThreadSnapshot {
    if (this.partChanges.size) {
      for (const id of this.partChanges.keys()) this.value.messages[this.messageIndices.get(id)!] = this.message(id)!
      this.partChanges.clear()
    }
    return (this.cachedSnapshot ??= immutable(this.value))
  }

  get state(): Omit<ThreadSnapshot, 'messages'> {
    const { type, inputs, activity, contextUsage, subagents } = this.value
    return immutable({ type, inputs, activity, contextUsage, subagents })
  }

  get messageIds(): string[] {
    return this.value.messages.map((message) => message.id)
  }

  private indexMessages(): void {
    this.messageIndices.clear()
    this.value.messages.forEach((message, index) => this.messageIndices.set(message.id, index))
  }

  message(id: string | undefined): RuntimeMessage | undefined {
    if (id === undefined) return
    const index = this.messageIndices.get(id)
    if (index === undefined) return
    const message = this.value.messages[index]
    const changes = this.partChanges.get(id)
    if (!changes) return message
    const parts = message.parts.slice()
    for (const [partIndex, part] of changes.parts) parts[partIndex] = part
    return immutable({ ...message, parts })
  }

  messageInputId(id: string): InputId | undefined {
    const index = this.messageIndices.get(id)
    return index === undefined ? undefined : this.value.messages[index].metadata?.inputId
  }

  hasStreamingText(id: string, part: number): boolean {
    const current = this.part(id, part)
    return (current?.type === 'text' || current?.type === 'reasoning') && current.state === 'streaming'
  }

  partCount(id: string): number | undefined {
    const index = this.messageIndices.get(id)
    return index === undefined
      ? undefined
      : (this.partChanges.get(id)?.length ?? this.value.messages[index].parts.length)
  }

  part(id: string, part: number): RuntimeMessage['parts'][number] | undefined {
    const index = this.messageIndices.get(id)
    return index === undefined
      ? undefined
      : (this.partChanges.get(id)?.parts.get(part) ?? this.value.messages[index].parts[part])
  }

  publishPart(input: LivePartInput): LivePartInput | undefined {
    const id = input.ref.id
    const length = this.partCount(id)
    if (this.ended || length === undefined) return
    const staged = stagePartUpdate(input, (index) => this.part(id, index))
    if (!staged) return
    if (staged.parts.size) {
      const changes = this.partChanges.get(id) ?? { parts: new Map(), length }
      for (const [index, part] of staged.parts) {
        changes.parts.set(index, part)
        changes.length = Math.max(changes.length, index + 1)
      }
      this.partChanges.set(id, changes)
    }
    this.cachedSnapshot = undefined
    for (const observer of this.observers) observer.send(staged.event)
    return staged.event
  }

  publish(event: Exclude<ObservationPayload, LivePartInput>): Exclude<ObservationPayload, LivePartInput> | undefined {
    if (this.ended) return
    let next = event
    if (event.type === 'message.reconcile')
      next = {
        ...event,
        message: snapshotRuntimeMessage(event.message)
      }
    else if (event.type === 'snapshot')
      next = { ...event, messages: event.messages.map((message) => snapshotRuntimeMessage(message)) }
    next = immutable(next)
    switch (next.type) {
      case 'snapshot':
        this.partChanges.clear()
        this.value = { ...next, messages: next.messages.slice() }
        this.indexMessages()
        break
      case 'message.reconcile': {
        this.partChanges.delete(next.message.id)
        if (!next.replaces?.length) {
          const at = this.messageIndices.get(next.message.id) ?? this.value.messages.length
          this.value.messages[at] = next.message
          this.messageIndices.set(next.message.id, at)
          break
        }
        const replaced = new Set([next.message.id, ...next.replaces.map((ref) => ref.id)])
        for (const ref of next.replaces) this.partChanges.delete(ref.id)
        const messages = this.value.messages.filter((item) => !replaced.has(item.id))
        const at = this.value.messages.findIndex((item) => replaced.has(item.id))
        messages.splice(at < 0 ? messages.length : at, 0, next.message)
        this.value = { ...this.value, messages }
        this.indexMessages()
        break
      }
      case 'message.remove':
        this.partChanges.delete(next.ref.id)
        this.value = { ...this.value, messages: this.value.messages.filter((item) => item.id !== next.ref.id) }
        this.indexMessages()
        break
      case 'input.changed':
        this.value = {
          ...this.value,
          inputs: [
            ...this.value.inputs.filter(
              (input) =>
                !(next.input.inputId !== undefined && input.inputId === next.input.inputId) &&
                !(next.input.nativeInput !== undefined && input.nativeInput?.id === next.input.nativeInput.id)
            ),
            next.input
          ]
        }
        break
      case 'context.changed':
        if (JSON.stringify(this.value.contextUsage) === JSON.stringify(next.result)) return
        this.value = { ...this.value, contextUsage: next.result }
        break
      case 'activity.changed':
        this.value = { ...this.value, activity: next.activity }
        break
      case 'subagent.upsert':
        this.value = {
          ...this.value,
          subagents: [...(this.value.subagents ?? []).filter((item) => item.id !== next.subagent.id), next.subagent]
        }
        break
    }
    this.cachedSnapshot = next.type === 'snapshot' ? next : undefined
    for (const observer of this.observers) observer.send(next)
    return next
  }

  observe(sink: ObservationSink): Observation {
    return this.observeCaptured(sink, (event) => ({ value: event }))
  }

  /** The feed selects content. Runtime facets can attach only their own metadata to each revision. */
  observeProjection<M extends object>(
    sink: (frame: M & { readonly events: ProjectionEvents }) => void | Promise<void>,
    capture: (
      event: ObservationPayload,
      delivery: 'baseline' | 'update' | 'recovery'
    ) => {
      value: M & { events?: never }
      retain?: boolean
    }
  ): Observation {
    return this.observeCaptured(sink, (event, delivery) => {
      const { value, retain } = capture(event, delivery)
      return { value: { ...value, events: projectionEvents(event) }, retain }
    })
  }

  /**
   * Capture cloneable adapter metadata synchronously on publication without mutating the supplied facts.
   * Each captured value is frozen before asynchronous delivery can advance past it; published facts
   * and unchanged messages are shared, not copied, so pending frames do not multiply history.
   */
  observeCaptured<T>(
    sink: (value: T) => void | Promise<void>,
    capture: (event: ObservationPayload, delivery: 'baseline' | 'update' | 'recovery') => { value: T; retain?: boolean }
  ): Observation {
    if (this.ended) throw new Error('Observation source is closed')
    let stopped = false
    let running = false
    let started = false
    let sent = 1
    let delivered = 0
    let lost = false
    type Delivery = { value: T; through: number; shouldClose: boolean; recovery?: T }
    const captureFrame = (event: ObservationPayload, delivery: Parameters<typeof capture>[1]) =>
      immutable(capture(event, delivery))
    let pending: Delivery[] = [
      { value: captureFrame(this.snapshot, 'baseline').value, through: sent, shouldClose: false }
    ]
    const barriers = new Set<{ through: number; resolve(): void; reject(error: Error): void }>()
    const settle = () => {
      for (const barrier of barriers) {
        if (delivered < barrier.through && !stopped) continue
        barriers.delete(barrier)
        if (delivered >= barrier.through) barrier.resolve()
        else barrier.reject(new Error('Observation stopped before delivery drained'))
      }
    }
    const report = (error: unknown) => {
      try {
        this.report(error)
      } catch {
        /* Reporting cannot affect execution. */
      }
    }
    const stop = () => {
      stopped = true
      pending = []
      this.observers.delete(observer)
      settle()
    }
    const schedule = () => {
      if (running || stopped) return
      running = true
      queueMicrotask(async () => {
        try {
          while (!stopped && pending.length) {
            started = true
            const { value, through, shouldClose } = pending.shift()!
            await sink(value)
            delivered = Math.max(delivered, through)
            settle()
            if (shouldClose) stop()
          }
        } catch (error) {
          stop()
          report(error)
        } finally {
          running = false
        }
      })
    }
    const observer = {
      send: (event: ObservationPayload) => {
        if (stopped || lost) return
        const captured = captureFrame(event, 'update')
        const next: Delivery = {
          value: captured.value,
          through: ++sent,
          shouldClose: event.type === 'closed',
          ...(captured.retain && { recovery: captureFrame(this.snapshot, 'recovery').value })
        }
        pending.push(next)
        if (pending.length > 100) {
          const retained = pending
            .filter((item) => item.recovery !== undefined)
            .map((item) => ({ ...item, value: item.recovery! }))
          const gap: ObservationPayload = { type: 'gap', reason: 'overflow' }
          const snapshot = this.snapshot
          if (retained.length > 1000) {
            lost = true
            const closed: ObservationPayload = { type: 'closed', reason: 'source-lost' }
            pending = [
              ...(started ? [] : [pending[0]]),
              { value: captureFrame(gap, 'update').value, through: delivered, shouldClose: false },
              { value: captureFrame(closed, 'update').value, through: sent, shouldClose: true }
            ]
            report(new Error('Observation exceeded recoverable delivery backlog'))
            schedule()
            return
          }
          pending = [
            ...(started ? [] : [pending[0]]),
            { value: captureFrame(gap, 'update').value, through: delivered, shouldClose: false },
            ...retained,
            ...(retained.at(-1)?.through === sent
              ? []
              : [
                  {
                    value: captureFrame(snapshot, 'recovery').value,
                    through: next.shouldClose ? sent - 1 : sent,
                    shouldClose: false
                  }
                ]),
            ...(next.shouldClose ? [next] : [])
          ]
        }
        schedule()
      },
      stop
    }
    this.observers.add(observer)
    schedule()
    return {
      drain: () =>
        new Promise<void>((resolve, reject) => {
          barriers.add({ through: sent, resolve, reject })
          settle()
        }),
      stop: async () => stop()
    }
  }

  close(reason: 'shutdown' | 'source-lost'): void {
    if (this.ended) return
    this.publish({ type: 'closed', reason })
    this.ended = true
  }
}
