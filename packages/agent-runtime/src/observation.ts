import type { Observation, ObservationPayload, ObservationSink, ThreadSnapshot } from './contracts'

/** Bounded delivery for normalized facts; never schedules native execution. */
export class ThreadFeed {
  private observers = new Set<{
    send(event: ObservationPayload): void
    stop(): void
    close(reason: 'shutdown' | 'source-lost'): void
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
      case 'item.upsert': {
        const replaced = new Set([next.item.ref.id, ...(next.replaces ?? []).map((ref) => ref.id)])
        const items = this.value.items.filter((item) => !replaced.has(item.ref.id))
        const at = this.value.items.findIndex((item) => replaced.has(item.ref.id))
        items.splice(at < 0 ? items.length : at, 0, next.item)
        this.value = { ...this.value, items }
        break
      }
      case 'item.remove':
        this.value = { ...this.value, items: this.value.items.filter((item) => item.ref.id !== next.ref.id) }
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
            await sink(pending.shift()!)
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
          pending = [...(started ? [] : [pending[0]]), { type: 'gap', reason: 'overflow' }, this.snapshot]
        schedule()
      },
      stop,
      close: (reason: 'shutdown' | 'source-lost') => {
        const canNotify = !running
        stop()
        if (canNotify) {
          try {
            Promise.resolve(sink({ type: 'closed', reason })).catch(report)
          } catch (error) {
            report(error)
          }
        }
      }
    }
    this.observers.add(observer)
    schedule()
    return { stop: async () => stop() }
  }

  close(reason: 'shutdown' | 'source-lost'): void {
    this.ended = true
    for (const observer of [...this.observers]) observer.close(reason)
  }
}
