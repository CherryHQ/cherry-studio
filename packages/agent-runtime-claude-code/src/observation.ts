import {
  immutable,
  isLivePartInput,
  ThreadFeed,
  type Observation,
  type ObservationPayload,
  type ThreadSnapshot
} from '@cherrystudio/agent-runtime'

import type { ClaudeControl, ClaudeControlState } from './control'
import type { ClaudeInvocation, ClaudeNativeMessage, ClaudeObservation, ClaudeObservationSink } from './types'

/** Keeps typed native payloads and normalized changes in the same bounded delivery queue; deliveries share frozen values. */
export class ClaudeFeed {
  private readonly state: ThreadFeed
  private readonly native = new Map<string, ClaudeNativeMessage>()
  private readonly retracted = new Set<string>()
  private readonly live = new Set<string>()
  private readonly replaces = new Map<string, string>()
  private readonly pendingRetractions = new Set<string>()
  private readonly taskRuns = new Map<string, { runId?: string; keys: Set<string> }>()
  private readonly observers = new Set<(batch: ClaudeObservation) => void>()
  private ended = false
  private legacy: NonNullable<ClaudeObservation['legacy']> = {}

  constructor(
    private readonly report: (error: unknown) => void,
    private readonly control?: Pick<ClaudeControlState, 'snapshot' | 'sawAbortedMessage'>
  ) {
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
    const state = this.control?.snapshot
    return {
      events: [this.snapshot],
      state: { aborted: this.control?.sawAbortedMessage ?? false },
      controls: state
        ? [
            { type: 'background-tasks', tasks: state.backgroundTasks },
            { type: 'background-work-state', active: state.backgroundWorkActive === true },
            { type: 'background-results', result: state.backgroundResults }
          ]
        : [],
      live: [...this.live],
      replaces: Object.fromEntries(this.replaces),
      legacy: this.legacy,
      native: [...this.native.values()],
      retracted: [...this.retracted]
    }
  }

  publish(
    events: readonly ObservationPayload[],
    native: readonly ClaudeNativeMessage[] = [],
    legacy?: ClaudeObservation['legacy'],
    invocations: readonly ClaudeInvocation[] = [],
    controls: readonly ClaudeControl[] = []
  ): void {
    if (this.ended) return
    if (legacy) this.legacy = immutable(legacy)
    const replaces: Record<string, string> = {}
    // Freeze once; the state feed, the retained native map and every observer share these values.
    events = immutable(
      events.flatMap(
        (event) => (isLivePartInput(event) ? this.state.publishPart(event) : this.state.publish(event)) ?? []
      )
    )
    native = immutable(
      native
        .filter((value) => !value.message.uuid || !this.retracted.has(value.message.uuid))
        .map((value) =>
          value.source === 'live' && value.message.type === 'assistant' && value.message.error
            ? { ...value, isApiErrorMessage: true as const }
            : value
        )
    )
    const live = native.some((entry) => entry.source === 'live')
    for (const event of events) {
      if (event.type === 'message.reconcile') {
        if (live) this.live.add(event.message.id)
        for (const ref of event.replaces ?? []) {
          this.replaces.set(ref.id, event.message.id)
          replaces[ref.id] = event.message.id
          this.live.delete(ref.id)
        }
      } else if (isLivePartInput(event) && live) this.live.add(event.ref.id)
      else if (event.type === 'message.remove') this.live.delete(event.ref.id)
    }
    for (const value of native) {
      const message = value.message
      if (message.type === 'stream_event') continue
      const key =
        message.type === 'system' && 'subtype' in message
          ? message.subtype === 'permission_denied'
            ? `${message.subtype}:${message.tool_use_id}`
            : `${message.subtype}:${'task_id' in message ? message.task_id : ''}`
          : message.uuid
      if (!key) continue
      const previous = this.native.get(key)
      if (value.source === 'archive' && previous?.source === 'live') continue
      const taskId = 'task_id' in message ? message.task_id : undefined
      if (previous && 'task_id' in previous.message && previous.message.task_id && previous.message.task_id !== taskId)
        this.taskRuns.get(previous.message.task_id)?.keys.delete(key)
      if (taskId) {
        let task = this.taskRuns.get(taskId)
        if (!task) {
          task = { keys: new Set() }
          this.taskRuns.set(taskId, task)
        }
        if ('run_id' in message && message.run_id && task.runId !== message.run_id) {
          for (const stale of task.keys) this.native.delete(stale)
          task.keys.clear()
          task.runId = message.run_id
        }
        task.keys.add(key)
      }
      this.native.set(key, value)
    }
    const batch: ClaudeObservation = immutable({
      events,
      controls,
      state: { aborted: this.control?.sawAbortedMessage ?? false },
      invocations,
      native,
      live: events.flatMap((event) => {
        const id =
          event.type === 'message.reconcile' ? event.message.id : isLivePartInput(event) ? event.ref.id : undefined
        return id && this.live.has(id) ? [id] : []
      }),
      replaces,
      legacy: legacy ? this.legacy : undefined,
      retracted: [...this.pendingRetractions]
    })
    this.pendingRetractions.clear()
    for (const send of this.observers) send(batch)
  }

  forget(uuid: string): void {
    const previous = this.native.get(uuid)?.message
    if (previous && 'task_id' in previous && previous.task_id) this.taskRuns.get(previous.task_id)?.keys.delete(uuid)
    this.native.delete(uuid)
    this.retracted.add(uuid)
    this.pendingRetractions.add(uuid)
  }

  observe(sink: ClaudeObservationSink, needsRecovery?: (batch: ClaudeObservation) => boolean): Observation {
    if (this.ended) throw new Error('Observation source is closed')
    let stopped = false
    let lost = false
    let draining = false
    let sent = 1
    let delivered = 0
    let protectedThrough = sent
    let queuedFacts = 0
    const historical = new Set(this.snapshot.messages.map((message) => message.id))
    const capture = (batch: ClaudeObservation, baseline = false): ClaudeObservation =>
      immutable({
        ...batch,
        ...(!baseline &&
          needsRecovery?.(batch) &&
          !batch.events.some((event) => event.type === 'snapshot') && { recovery: this.snapshot }),
        live: baseline ? [] : batch.live?.filter((id) => !historical.has(id))
      })
    const carriesFacts = (batch: ClaudeObservation) => Boolean(batch.controls?.length || batch.invocations?.length)
    const recover = (batch?: ClaudeObservation) =>
      capture({ ...this.baseline(), controls: batch?.controls, invocations: batch?.invocations })
    type Delivery = { through: number } & (
      | { batch: ClaudeObservation; gap?: never }
      | { gap: true; batch?: ClaudeObservation }
    )
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
            const delivery = pending.shift()!
            const { through } = delivery
            const batch = delivery.batch ?? recover()
            if (through > 1 && carriesFacts(batch)) queuedFacts--
            if (delivery.gap) {
              await sink({ events: [{ type: 'gap', reason: 'overflow' }], native: [], retracted: [] })
              if (stopped) break
            }
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
      const through = ++sent
      const critical = carriesFacts(batch)
      if (critical && ++queuedFacts > 1000) {
        lost = true
        pending = [
          {
            through,
            batch: {
              events: [
                { type: 'gap', reason: 'overflow' },
                { type: 'closed', reason: 'source-lost' }
              ],
              native: [],
              retracted: []
            }
          }
        ]
        this.report(new Error('Claude observer exceeded recoverable control backlog'))
        drain()
        return
      }
      const closed = batch.events.find((event) => event.type === 'closed')
      const tail = pending.at(-1)
      // Keep the deltas leading to each control. Folding a single delta into a control would cost a full snapshot.
      const pendingAfterControl = (tail?.through ?? protectedThrough) - protectedThrough
      const overflow = pending.length >= 100 && pendingAfterControl > (critical ? 1 : 0)
      if ((tail && !tail.batch) || overflow) {
        while ((pending.at(-1)?.through ?? 0) > protectedThrough) pending.pop()
        pending.push({
          through: closed ? through - 1 : through,
          gap: true,
          batch: critical || closed ? recover(batch) : undefined
        })
        if (closed) pending.push({ through, batch: { events: [closed], native: [], retracted: [] } })
      } else pending.push({ through, batch: capture(batch) })
      if (critical || closed) protectedThrough = through
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
