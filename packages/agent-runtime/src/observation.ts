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
      case 'delegation.upsert':
        this.value = {
          ...this.value,
          delegations: [
            ...(this.value.delegations ?? []).filter((item) => item.ref.id !== next.delegation.ref.id),
            next.delegation
          ]
        }
        break
    }
    for (const observer of this.observers) observer.send(next)
  }

  observe(sink: ObservationSink): Observation {
    if (this.ended) throw new Error('Observation source is closed')
    let stopped = false
    let running = false
    let started = false
    let pending: ObservationPayload[] = [this.snapshot]
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
    }
    const schedule = () => {
      if (running || stopped) return
      running = true
      queueMicrotask(async () => {
        try {
          while (!stopped && pending.length) {
            started = true
            const event = pending.shift()!
            await sink(event)
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
        if (stopped) return
        pending.push(structuredClone(event))
        if (pending.length > 100)
          pending = [
            ...(started ? [] : [pending[0]]),
            { type: 'gap', reason: 'overflow' },
            this.snapshot,
            ...(event.type === 'closed' ? [event] : [])
          ]
        schedule()
      },
      stop
    }
    this.observers.add(observer)
    schedule()
    return { stop: async () => stop() }
  }

  close(reason: 'shutdown' | 'source-lost'): void {
    if (this.ended) return
    this.publish({ type: 'closed', reason })
    this.ended = true
  }
}
