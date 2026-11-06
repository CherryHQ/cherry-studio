import type { Observation, ObservationPayload, ObservationSink, ThreadSnapshot } from './contracts'

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
    this.value = structuredClone(value)
  }

  get snapshot(): ThreadSnapshot {
    return structuredClone(this.value)
  }

  publish(event: ObservationPayload): void {
    if (this.ended) return
    const next = structuredClone(event)
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
  }

  observe(sink: ObservationSink): Observation {
    return this.observeCaptured(sink, (event) => ({ value: event }))
  }

  /** Capture adapter-owned metadata on publication, before asynchronous delivery can advance past it. */
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
    type Delivery = { event: ObservationPayload; value: T; through: number; recovery?: T }
    const initial = this.snapshot
    let pending: Delivery[] = [{ event: initial, value: capture(initial, 'baseline').value, through: sent }]
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
            const { event, value, through } = pending.shift()!
            await sink(value)
            delivered = Math.max(delivered, through)
            settle()
            if (event.type === 'closed') stop()
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
        const captured = capture(event, 'update')
        pending.push({
          event: structuredClone(event),
          value: captured.value,
          through: ++sent,
          ...(captured.retain && { recovery: capture(this.snapshot, 'recovery').value })
        })
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
              { event: gap, value: capture(gap, 'update').value, through: delivered },
              { event: closed, value: capture(closed, 'update').value, through: sent }
            ]
            report(new Error('Observation exceeded recoverable delivery backlog'))
            schedule()
            return
          }
          pending = [
            ...(started ? [] : [pending[0]]),
            { event: gap, value: capture(gap, 'update').value, through: delivered },
            ...retained,
            ...(retained.at(-1)?.through === sent
              ? []
              : [
                  {
                    event: snapshot,
                    value: capture(snapshot, 'recovery').value,
                    through: event.type === 'closed' ? sent - 1 : sent
                  }
                ]),
            ...(event.type === 'closed' ? [{ event, value: captured.value, through: sent }] : [])
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
