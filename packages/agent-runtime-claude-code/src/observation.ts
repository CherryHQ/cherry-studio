import { ThreadFeed, type Observation, type ObservationPayload, type ThreadSnapshot } from '@cherrystudio/agent-runtime'

import type { ClaudeControl, ClaudeControlState } from './control'
import type { ClaudeInvocation, ClaudeNativeMessage, ClaudeObservation, ClaudeObservationSink } from './types'

/** Keeps typed native payloads and normalized changes in the same bounded delivery queue. */
export class ClaudeFeed {
  private readonly state: ThreadFeed
  private readonly native = new Map<string, ClaudeNativeMessage>()
  private readonly retracted = new Set<string>()
  private readonly live = new Set<string>()
  private readonly replaces = new Map<string, string>()
  private readonly pendingRetractions = new Set<string>()
  private readonly taskRuns = new Map<string, string>()
  private readonly observers = new Set<(batch: ClaudeObservation) => void>()
  private ended = false
  private legacy: NonNullable<ClaudeObservation['legacy']> = {}
  private controlState?: ClaudeControlState['snapshot']

  constructor(private readonly report: (error: unknown) => void) {
    this.state = new ThreadFeed(
      {
        type: 'snapshot',
        messages: [],
        inputs: [],
        subagents: [],
        activity: { state: 'unknown' }
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
      state: { aborted: this.controlState?.aborted ?? false },
      controls: this.controlState?.backgroundTasks
        ? [
            { type: 'background-tasks', tasks: this.controlState.backgroundTasks },
            { type: 'background-work-state', active: this.controlState.backgroundWorkActive === true },
            { type: 'background-results', result: this.controlState.backgroundResults }
          ]
        : [],
      live: [...this.live],
      replaces: Object.fromEntries(this.replaces),
      legacy: structuredClone(this.legacy),
      native: structuredClone([...this.native.values()]),
      retracted: [...this.retracted]
    }
  }

  publish(
    events: readonly ObservationPayload[],
    native: readonly ClaudeNativeMessage[] = [],
    legacy?: ClaudeObservation['legacy'],
    invocations: readonly ClaudeInvocation[] = [],
    controls: readonly ClaudeControl[] = [],
    state?: ClaudeControlState['snapshot']
  ): void {
    if (this.ended) return
    if (state) this.controlState = state
    if (legacy) this.legacy = structuredClone(legacy)
    const replaces: Record<string, string> = {}
    native = native
      .filter((value) => !value.message.uuid || !this.retracted.has(value.message.uuid))
      .map((value) =>
        value.source === 'live' && value.message.type === 'assistant' && value.message.error
          ? { ...value, isApiErrorMessage: true as const }
          : value
      )
    for (const event of events) {
      this.state.publish(event)
      if (event.type === 'message.upsert') {
        if (native.some((entry) => entry.source === 'live')) this.live.add(event.message.id)
        for (const ref of event.replaces ?? []) {
          this.replaces.set(ref.id, event.message.id)
          replaces[ref.id] = event.message.id
          this.live.delete(ref.id)
        }
      } else if (event.type === 'message.remove') this.live.delete(event.ref.id)
    }
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
          ? message.subtype === 'permission_denied'
            ? `${message.subtype}:${message.tool_use_id}`
            : `${message.subtype}:${'task_id' in message ? message.task_id : ''}`
          : message.uuid
      if (key && !(value.source === 'archive' && this.native.get(key)?.source === 'live'))
        this.native.set(key, structuredClone(value))
    }
    const batch: ClaudeObservation = {
      events,
      controls,
      state: { aborted: this.controlState?.aborted ?? false },
      invocations,
      native,
      live: events.flatMap((event) =>
        event.type === 'message.upsert' && this.live.has(event.message.id) ? [event.message.id] : []
      ),
      replaces,
      legacy: structuredClone(this.legacy),
      retracted: [...this.pendingRetractions]
    }
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
    let lost = false
    let draining = false
    let started = false
    let sent = 1
    let delivered = 0
    const historical = new Set(this.snapshot.messages.map((message) => message.id))
    const capture = (batch: ClaudeObservation, baseline = false): ClaudeObservation => ({
      ...structuredClone(batch),
      live: baseline ? [] : batch.live?.filter((id) => !historical.has(id))
    })
    type Delivery = { batch: ClaudeObservation; through: number; recovery?: ClaudeObservation }
    let pending: Delivery[] = [{ batch: capture(this.baseline(), true), through: sent }]
    const barriers = new Set<{ through: number; resolve(): void; reject(error: Error): void }>()
    const settle = () => {
      for (const barrier of barriers) {
        if (delivered < barrier.through && !stopped) continue
        barriers.delete(barrier)
        if (delivered >= barrier.through) barrier.resolve()
        else barrier.reject(new Error('Observation stopped before delivery drained'))
      }
    }
    const stop = () => {
      stopped = true
      pending = []
      this.observers.delete(send)
      settle()
    }
    const drain = () => {
      if (draining || stopped) return
      draining = true
      queueMicrotask(async () => {
        try {
          while (!stopped && pending.length) {
            started = true
            const { batch, through } = pending.shift()!
            await sink(batch)
            delivered = Math.max(delivered, through)
            settle()
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
      if (stopped || lost) return
      for (const [previous, replacement] of Object.entries(batch.replaces ?? {}))
        if (historical.has(previous)) historical.add(replacement)
      const recover = () => capture({ ...this.baseline(), controls: batch.controls, invocations: batch.invocations })
      const critical = Boolean(batch.controls?.length || batch.invocations?.length)
      pending.push({ batch: capture(batch), through: ++sent, ...(critical && { recovery: recover() }) })
      if (pending.length > 100) {
        const closed = batch.events.filter((event) => event.type === 'closed')
        const retained = pending.filter((item) => item.recovery).map((item) => ({ ...item, batch: item.recovery! }))
        if (retained.length > 1000) {
          lost = true
          pending = [
            {
              batch: {
                events: [
                  { type: 'gap', reason: 'overflow' },
                  { type: 'closed', reason: 'source-lost' }
                ],
                native: [],
                retracted: []
              },
              through: sent
            }
          ]
          this.report(new Error('Claude observer exceeded recoverable control backlog'))
          drain()
          return
        }
        pending = [
          ...(started ? [] : [pending[0]]),
          { batch: { events: [{ type: 'gap', reason: 'overflow' }], native: [], retracted: [] }, through: delivered },
          ...retained,
          ...(retained.at(-1)?.through === sent
            ? []
            : [{ batch: recover(), through: closed.length ? sent - 1 : sent }]),
          ...(closed.length ? [{ batch: { events: closed, native: [], retracted: [] }, through: sent }] : [])
        ]
      }
      drain()
    }
    this.observers.add(send)
    drain()
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
    this.publish([{ type: 'closed', reason }])
    this.ended = true
  }
}
