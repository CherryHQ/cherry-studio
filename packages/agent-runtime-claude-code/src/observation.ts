import {
  cloneHistoryData,
  HistoryRetention,
  ThreadFeed,
  type CapturedHistory,
  type Observation,
  type ObservationPayload,
  type ThreadSnapshot
} from '@cherrystudio/agent-runtime'

import type { ClaudeControl, ClaudeControlState } from './control'
import type { ClaudeInvocation, ClaudeNativeMessage, ClaudeObservation, ClaudeObservationSink } from './types'

type CapturedBatch = { batch: ClaudeObservation; snapshot?: CapturedHistory<ThreadSnapshot> }

/** Keeps typed native payloads and normalized changes in the same bounded delivery queue. */
export class ClaudeFeed {
  private readonly state: ThreadFeed
  private readonly native = new Map<string, ClaudeNativeMessage>()
  private readonly retracted = new Set<string>()
  private readonly live = new Set<string>()
  private readonly replaces = new Map<string, string>()
  private readonly pendingRetractions = new Set<string>()
  private readonly taskRuns = new Map<string, string>()
  private readonly observers = new Set<(batch: CapturedBatch, baseline: CapturedBatch) => void>()
  private ended = false
  private legacy: NonNullable<ClaudeObservation['legacy']> = {}
  private controlState?: ClaudeControlState['snapshot']

  constructor(
    private readonly report: (error: unknown) => void,
    private readonly onBacklog?: (error: Error) => void
  ) {
    this.state = new ThreadFeed(
      {
        type: 'snapshot',
        messages: [],
        inputs: [],
        subagents: [],
        activity: { state: 'unknown' }
      },
      report,
      cloneHistoryData
    )
  }

  get snapshot(): ThreadSnapshot {
    return this.state.snapshot
  }

  private baseline(): CapturedBatch {
    return {
      snapshot: this.state.captureSnapshot(),
      batch: {
        events: [],
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
        legacy: this.legacy,
        native: [...this.native.values()],
        retracted: [...this.retracted]
      }
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
    if (state) this.controlState = cloneHistoryData(state)
    // oxlint-disable-next-line no-restricted-globals -- Own the legacy map only when bindings change; ordinary deltas omit it.
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
        this.native.set(key, cloneHistoryData(value))
    }
    if (!this.observers.size) {
      this.pendingRetractions.clear()
      return
    }
    const batch: ClaudeObservation = {
      events: cloneHistoryData(events),
      controls: cloneHistoryData(controls),
      state: { aborted: this.controlState?.aborted ?? false },
      invocations: cloneHistoryData(invocations),
      native: cloneHistoryData(native),
      live: events.flatMap((event) =>
        event.type === 'message.upsert' && this.live.has(event.message.id) ? [event.message.id] : []
      ),
      replaces,
      legacy: legacy ? this.legacy : undefined,
      retracted: [...this.pendingRetractions]
    }
    this.pendingRetractions.clear()
    const baseline = this.baseline()
    for (const send of this.observers) send({ batch }, baseline)
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
    const historical = new Set(this.state.messageIds)
    const capture = ({ batch, snapshot }: CapturedBatch, baseline = false): CapturedBatch => ({
      snapshot,
      batch: { ...batch, live: baseline ? [] : batch.live?.filter((id) => !historical.has(id)) }
    })
    const retention = new HistoryRetention()
    const baseline = this.baseline()
    retention.setBaseline(baseline)
    type Delivery = { captured: CapturedBatch; through: number; recovery?: CapturedBatch }
    let pending: Delivery[] = [{ captured: capture(baseline, true), through: sent }]
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
      retention.clear()
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
            const { captured, through } = pending.shift()!
            const batch = cloneHistoryData(captured.batch)
            if (captured.snapshot) Object.assign(batch, { events: [captured.snapshot.read()] })
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
          if (!pending.length) retention.clear()
        }
      })
    }
    const send = (captured: CapturedBatch, baseline: CapturedBatch) => {
      if (stopped || lost) return
      const { batch } = captured
      for (const [previous, replacement] of Object.entries(batch.replaces ?? {}))
        if (historical.has(previous)) historical.add(replacement)
      const recover = () =>
        capture({ ...baseline, batch: { ...baseline.batch, controls: batch.controls, invocations: batch.invocations } })
      const critical = Boolean(batch.controls?.length || batch.invocations?.length)
      pending.push({ captured: capture(captured), through: ++sent, ...(critical && { recovery: recover() }) })
      if (pending.length > 1) retention.setBaseline(baseline)
      if (pending.length > 100 || retention.exceeds(pending)) {
        const closed = batch.events.filter((event) => event.type === 'closed')
        const retained = pending.filter((item) => item.recovery).map((item) => ({ ...item, captured: item.recovery! }))
        if (retained.length > 1000 || retention.exceeds(retained)) {
          lost = true
          pending = [
            ...(started ? [] : [pending[0]]),
            {
              captured: {
                batch: {
                  events: [
                    { type: 'gap', reason: 'overflow' },
                    { type: 'closed', reason: 'source-lost' }
                  ],
                  native: [],
                  retracted: []
                }
              },
              through: sent
            }
          ]
          retention.clear()
          const error = new Error('Claude observer exceeded recoverable control backlog')
          this.report(error)
          this.onBacklog?.(error)
          drain()
          return
        }
        pending = [
          ...(started ? [] : [pending[0]]),
          {
            captured: { batch: { events: [{ type: 'gap', reason: 'overflow' }], native: [], retracted: [] } },
            through: delivered
          },
          ...retained,
          ...(retained.at(-1)?.through === sent
            ? []
            : [{ captured: recover(), through: closed.length ? sent - 1 : sent }]),
          ...(closed.length
            ? [{ captured: { batch: { events: closed, native: [], retracted: [] } }, through: sent }]
            : [])
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
