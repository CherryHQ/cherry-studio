import { isToolUIPart } from 'ai'

import type { Observation, ObservationPayload, ObservationSink, RuntimeMessage, ThreadSnapshot } from './contracts'

const immutableOutputs = new WeakSet<object>()
const acceptedToolParts = new WeakSet<object>()

export function isAcceptedToolOutput(value: unknown): boolean {
  return typeof value === 'object' && value !== null && immutableOutputs.has(value)
}

export function isAcceptedToolPart(value: unknown): boolean {
  return typeof value === 'object' && value !== null && acceptedToolParts.has(value)
}

/** Establishes immutable part ownership after adapter decoration, including primitive result values. */
export function snapshotToolPart<T extends RuntimeMessage['parts'][number]>(part: T): T {
  if (isAcceptedToolPart(part)) return part
  const accepted = cloneObservationValue(part)
  if (freezeOutput(accepted)) acceptedToolParts.add(accepted)
  return accepted
}

function freezeOutput(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null || immutableOutputs.has(value) || seen.has(value)) return true
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    return false
  seen.add(value)
  const children = Object.values(value).map((item) => freezeOutput(item, seen))
  if (!children.every(Boolean)) return false
  Object.freeze(value)
  immutableOutputs.add(value)
  return true
}

/** Copies delivery containers while sharing only deeply frozen, accepted JSON tool payloads. */
export function cloneObservationValue<T>(value: T): T {
  const copies = new WeakMap<object, object>()
  const clone = (item: unknown): unknown => {
    if (typeof item === 'function' || typeof item === 'symbol') return structuredClone(item)
    if (typeof item !== 'object' || item === null || immutableOutputs.has(item)) return item
    const known = copies.get(item)
    if (known) return known
    if (Array.isArray(item)) {
      const result: unknown[] = []
      copies.set(item, result)
      for (const child of item) result.push(clone(child))
      return result
    }
    if (Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null)
      return structuredClone(item)
    const result: Record<string, unknown> = {}
    copies.set(item, result)
    for (const [key, child] of Object.entries(item))
      Object.defineProperty(result, key, { value: clone(child), enumerable: true, writable: true, configurable: true })
    return result
  }
  return clone(value) as T
}

/** A changed index is a native acceptance boundary; untouched parts reuse the previous owned snapshot. */
export function snapshotRuntimeMessage(
  message: RuntimeMessage,
  previous?: RuntimeMessage,
  changedParts?: readonly number[]
): RuntimeMessage {
  const changed = changedParts && new Set(changedParts)
  return {
    ...cloneObservationValue({ ...message, parts: [] }),
    parts: message.parts.map((part, index) => {
      if (previous?.parts[index] && changed && !changed.has(index)) return previous.parts[index]
      if (isAcceptedToolPart(part)) return part
      if (!isToolUIPart(part) || part.state !== 'output-available') return cloneObservationValue(part)
      const output = cloneObservationValue(part.output)
      freezeOutput(output)
      return snapshotToolPart({ ...cloneObservationValue({ ...part, output: undefined }), output })
    })
  }
}

function snapshotObservation(event: ObservationPayload, previous?: ThreadSnapshot): ObservationPayload {
  if (event.type === 'message.upsert')
    return {
      ...cloneObservationValue({ ...event, message: undefined }),
      message: snapshotRuntimeMessage(
        event.message,
        previous?.messages.find((message) => message.id === event.message.id),
        event.changedParts
      )
    }
  if (event.type === 'snapshot')
    return {
      ...cloneObservationValue({ ...event, messages: [] }),
      messages: event.messages.map((message) => snapshotRuntimeMessage(message))
    }
  return cloneObservationValue(event)
}

/** Bounded delivery for normalized facts; never schedules native execution. */
export class ThreadFeed {
  private observers = new Set<{
    send(event: ObservationPayload): void
    stop(): void
  }>()
  private ended = false

  constructor(
    private value: ThreadSnapshot,
    private readonly report: (error: unknown) => void
  ) {
    this.value = {
      ...cloneObservationValue({ ...value, messages: [] }),
      messages: value.messages.map((message) => snapshotRuntimeMessage(message))
    }
  }

  get snapshot(): ThreadSnapshot {
    return structuredClone(this.value)
  }

  /** Adapters can read owned snapshots without copying history; mutations go through publish(). */
  get current(): Omit<ThreadSnapshot, 'messages'> & {
    readonly messages: readonly (Omit<RuntimeMessage, 'parts'> & {
      readonly parts: readonly RuntimeMessage['parts'][number][]
    })[]
  } {
    return this.value
  }

  publish(event: ObservationPayload): ObservationPayload | undefined {
    if (this.ended) return
    const next = snapshotObservation(event, this.value)
    switch (next.type) {
      case 'snapshot':
        this.value = next
        break
      case 'message.upsert': {
        const replaced = new Set([next.message.id, ...(next.replaces ?? []).map((ref) => ref.id)])
        const messages = this.value.messages.filter((item) => !replaced.has(item.id))
        const at = this.value.messages.findIndex((item) => replaced.has(item.id))
        messages.splice(at < 0 ? messages.length : at, 0, next.message)
        this.value = { ...this.value, messages }
        break
      }
      case 'message.remove':
        this.value = { ...this.value, messages: this.value.messages.filter((item) => item.id !== next.ref.id) }
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
    for (const observer of this.observers) observer.send(next)
    return cloneObservationValue(next)
  }

  observe(sink: ObservationSink): Observation {
    return this.observeCaptured(sink, (event) => ({ value: event }))
  }

  /**
   * Capture cloneable adapter metadata synchronously on publication without mutating the supplied facts.
   * The feed copies each captured value before asynchronous delivery can advance past it.
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
      cloneObservationValue(capture(event, delivery))
    let pending: Delivery[] = [{ value: captureFrame(this.value, 'baseline').value, through: sent, shouldClose: false }]
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
          ...(captured.retain && { recovery: captureFrame(this.value, 'recovery').value })
        }
        pending.push(next)
        if (pending.length > 100) {
          const retained = pending
            .filter((item) => item.recovery !== undefined)
            .map((item) => ({ ...item, value: item.recovery! }))
          const gap: ObservationPayload = { type: 'gap', reason: 'overflow' }
          const snapshot = this.value
          if (retained.length > 1000) {
            lost = true
            const closed: ObservationPayload = { type: 'closed', reason: 'source-lost' }
            pending = [
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
