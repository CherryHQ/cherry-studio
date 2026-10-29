import { ThreadFeed, type Observation, type ObservationPayload, type ThreadSnapshot } from '@cherrystudio/agent-runtime'

import type { ClaudeNativeMessage, ClaudeObservation, ClaudeObservationSink } from './types'

/** Keeps typed native payloads and normalized changes in the same bounded delivery queue. */
export class ClaudeFeed {
  private readonly state: ThreadFeed
  private readonly native = new Map<string, ClaudeNativeMessage>()
  private readonly retracted = new Set<string>()
  private readonly pendingRetractions = new Set<string>()
  private readonly taskRuns = new Map<string, string>()
  private readonly observers = new Set<(batch: ClaudeObservation) => void>()
  private ended = false
  private legacy: NonNullable<ClaudeObservation['legacy']> = {}

  constructor(private readonly report: (error: unknown) => void) {
    this.state = new ThreadFeed(
      {
        type: 'snapshot',
        coverage: 'live-only',
        messages: [],
        inputs: [],
        subagents: [],
        activity: { scope: 'foreground', state: 'unknown' }
      },
      report
    )
  }

  get snapshot(): ThreadSnapshot {
    return this.state.snapshot
  }

  private baseline(): ClaudeObservation {
    return {
      events: [this.snapshot],
      legacy: structuredClone(this.legacy),
      native: structuredClone([...this.native.values()]),
      retracted: [...this.retracted]
    }
  }

  publish(
    events: readonly ObservationPayload[],
    native: readonly ClaudeNativeMessage[] = [],
    legacy?: ClaudeObservation['legacy']
  ): void {
    if (this.ended) return
    if (legacy) this.legacy = structuredClone(legacy)
    native = native.filter((value) => !value.message.uuid || !this.retracted.has(value.message.uuid))
    for (const event of events) this.state.publish(event)
    for (const value of native) {
      const message = value.message
      if (message.type === 'stream_event') continue
      if (
        'task_id' in message &&
        message.task_id &&
        'run_id' in message &&
        message.run_id &&
        message.run_id !== this.taskRuns.get(message.task_id)
      ) {
        this.taskRuns.set(message.task_id, message.run_id)
        for (const [key, previous] of this.native) {
          if ('task_id' in previous.message && previous.message.task_id === message.task_id) this.native.delete(key)
        }
      }
      const key =
        message.type === 'system' && 'subtype' in message
          ? `${message.subtype}:${'task_id' in message ? message.task_id : ''}`
          : message.uuid
      if (key && !(value.source === 'archive' && this.native.get(key)?.source === 'live'))
        this.native.set(key, structuredClone(value))
    }
    const batch = { events, native, legacy: structuredClone(this.legacy), retracted: [...this.pendingRetractions] }
    this.pendingRetractions.clear()
    for (const send of this.observers) send(batch)
  }

  forget(uuid: string): void {
    this.native.delete(uuid)
    this.retracted.add(uuid)
    this.pendingRetractions.add(uuid)
  }

  observe(sink: ClaudeObservationSink): Observation {
    if (this.ended) throw new Error('Observation source is closed')
    let stopped = false
    let draining = false
    let started = false
    let pending = [this.baseline()]
    const stop = () => {
      stopped = true
      pending = []
      this.observers.delete(send)
    }
    const drain = () => {
      if (draining || stopped) return
      draining = true
      queueMicrotask(async () => {
        try {
          while (!stopped && pending.length) {
            started = true
            const batch = pending.shift()!
            await sink(batch)
            if (batch.events.some((event) => event.type === 'closed')) stop()
          }
        } catch (error) {
          stop()
          this.report(error)
        } finally {
          draining = false
        }
      })
    }
    const send = (batch: ClaudeObservation) => {
      if (stopped) return
      pending.push(structuredClone(batch))
      if (pending.length > 100) {
        const closed = batch.events.filter((event) => event.type === 'closed')
        pending = [
          ...(started ? [] : [pending[0]]),
          { events: [{ type: 'gap', reason: 'overflow' }], native: [], retracted: [] },
          this.baseline(),
          ...(closed.length ? [{ events: closed, native: [], retracted: [] }] : [])
        ]
      }
      drain()
    }
    this.observers.add(send)
    drain()
    return { stop: async () => stop() }
  }

  close(reason: 'shutdown' | 'source-lost'): void {
    if (this.ended) return
    this.publish([{ type: 'closed', reason }])
    this.ended = true
  }
}
