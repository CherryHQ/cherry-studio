import { isDeepStrictEqual } from 'node:util'

import type {
  Activity,
  InputState,
  Observation,
  ObservationPayload,
  RuntimeError,
  RuntimeMessage,
  Subagent,
  Thread,
  ThreadHandle,
  ThreadSnapshot
} from '@cherrystudio/agent-runtime'
import { loggerService } from '@logger'
import type { CherryUIMessage } from '@shared/data/types/message'

const logger = loggerService.withContext('ThreadMessageProjection')
type Gap = Extract<ObservationPayload, { type: 'gap' }>['reason']
type Closed = Extract<ObservationPayload, { type: 'closed' }>['reason']
interface ProjectionState {
  coverage?: ThreadSnapshot['coverage']
  activity: Activity
  inputs: readonly InputState[]
  subagents: readonly Subagent[]
  gap?: Gap
  closed?: Closed
  diagnostic?: RuntimeError
}
export interface ThreadMessageView extends ProjectionState {
  thread: Thread
  revision: number
  messages: readonly CherryUIMessage[]
}
export type ThreadProjectionUpdate =
  | { type: 'snapshot'; view: ThreadMessageView }
  | {
      type: 'change'
      revision: number
      messages: readonly CherryUIMessage[]
      removed: readonly string[]
      order: readonly string[]
      state: ProjectionState
    }
export type MessageDecorator = (message: CherryUIMessage, source: RuntimeMessage) => CherryUIMessage

/** Main-owned current view. Native execution, product IDs and archive writes belong to its caller. */
export class ThreadMessageProjection {
  private sources = new Map<string, RuntimeMessage>()
  private messages = new Map<string, CherryUIMessage>()
  private readonly listeners = new Set<(update: ThreadProjectionUpdate) => void>()
  private state: ProjectionState = { activity: { scope: 'foreground', state: 'unknown' }, inputs: [], subagents: [] }
  private revision = 0
  private pending: Promise<void> = Promise.resolve()
  private attachment: Promise<void> = Promise.resolve()
  private observation?: Observation
  private source?: object
  private disposed = false
  private closing?: Promise<void>
  private view?: ThreadMessageView

  constructor(
    readonly thread: Thread,
    private readonly decorate?: MessageDecorator
  ) {
    this.view = { ...this.state, thread, revision: 0, messages: [] }
  }

  snapshot(): ThreadMessageView {
    return (this.view ??= {
      ...this.state,
      thread: this.thread,
      revision: this.revision,
      messages: [...this.messages.values()]
    })
  }

  drain(): Promise<void> {
    return this.pending
  }

  subscribe(listener: (update: ThreadProjectionUpdate) => void): () => void {
    if (this.disposed) throw new Error('Thread projection is closed')
    this.listeners.add(listener)
    this.deliver(listener, { type: 'snapshot', view: this.snapshot() })
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Replaces only observation access; never interrupts, releases or prompts the native thread. */
  attach(handle: ThreadHandle): Promise<void> {
    const attached = this.attachment.then(async () => {
      if (this.disposed) throw new Error('Thread projection is closed')
      this.assertThread(handle.thread)
      this.source = undefined
      await this.observation?.stop()
      this.observation = undefined
      await this.pending
      const source = {}
      this.source = source
      const result = await handle.observe(async (event) => {
        if (this.source === source) await this.accept(event)
      })
      if (result.status !== 'confirmed') {
        this.source = undefined
        throw new Error(result.error.message)
      }
      this.observation = result.value
    })
    this.attachment = attached.catch(() => {})
    return attached
  }

  accept(
    event: ObservationPayload | readonly ObservationPayload[],
    refresh: readonly string[] = []
  ): Promise<readonly CherryUIMessage[]> {
    if (this.disposed) return Promise.reject(new Error('Thread projection is closed'))
    const accepted = this.pending.then(() => {
      const changed = new Map<string, CherryUIMessage>()
      const invalidated = new Set(refresh)
      try {
        for (const item of 'type' in event ? [event] : event) {
          for (const message of this.reduce(item)) changed.set(message.id, message)
          if (item.type === 'snapshot') invalidated.clear()
          else if (item.type === 'message.upsert') invalidated.delete(item.message.id)
        }
        if (invalidated.size)
          for (const message of this.reduce(undefined, invalidated)) changed.set(message.id, message)
      } catch (error) {
        this.source = undefined
        this.sources.clear()
        const state = this.state
        this.state = {
          ...state,
          gap: 'mapping-reset',
          closed: 'consumer-error',
          diagnostic: { operation: 'project', code: 'projection-failed', message: String(error) }
        }
        this.publish([], [], false, state)
        logger.warn('Thread projection requires a new observation baseline', { thread: this.thread, error })
        throw error
      }
      if (changed.size > 1) return [...this.messages.values()].filter((message) => changed.has(message.id))
      return [...changed.values()].filter((message) => this.messages.get(message.id) === message)
    })
    this.pending = accepted.then(
      () => {},
      () => {}
    )
    return accepted
  }

  close(): Promise<void> {
    this.disposed = true
    this.source = undefined
    return (this.closing ??= (async () => {
      await this.attachment
      this.source = undefined
      await this.observation?.stop()
      await this.pending
      this.listeners.clear()
    })())
  }

  private assertThread(thread: Thread): void {
    if (thread.backendId !== this.thread.backendId || thread.id !== this.thread.id)
      throw new Error('Observation belongs to a different thread')
  }

  private validate(event: ObservationPayload): void {
    if (event.type === 'snapshot') {
      event.subagents?.forEach((relation) => this.assertThread(relation.parent))
      event.inputs.forEach((input) => this.validateInput(input))
    } else if (event.type === 'message.upsert') {
      event.replaces?.forEach((ref) => this.assertThread(ref.session))
    } else if (event.type === 'message.remove') this.assertThread(event.ref.session)
    else if (event.type === 'subagent.upsert') this.assertThread(event.subagent.parent)
    else if (event.type === 'input.changed') this.validateInput(event.input)
  }

  private validateInput(input: InputState): void {
    if (input.nativeInput) this.assertThread(input.nativeInput.session)
    if (input.response) this.assertThread(input.response.session)
  }

  private mergeInputs(inputs: readonly InputState[]): readonly InputState[] {
    const merged = [...this.state.inputs]
    for (const input of inputs) {
      const index = merged.findIndex(
        (previous) =>
          (input.inputId !== undefined && previous.inputId === input.inputId) ||
          (input.nativeInput !== undefined && previous.nativeInput?.id === input.nativeInput.id)
      )
      const previous = merged[index]
      const next: InputState = {
        ...previous,
        ...input,
        facts: [...new Set([...(previous?.facts ?? []), ...input.facts])],
        outcome: input.outcome ?? previous?.outcome,
        response: input.response ?? previous?.response,
        error: input.error ?? previous?.error
      }
      if (index < 0) merged.push(next)
      else merged[index] = next
    }
    return merged
  }

  private reduce(event?: ObservationPayload, refresh: ReadonlySet<string> = new Set()): readonly CherryUIMessage[] {
    if (this.state.closed === 'consumer-error' && event?.type !== 'snapshot') return []
    if (event) this.validate(event)
    const state = this.state
    let nextState = state
    let sources = this.sources
    let candidates = new Map<string, RuntimeMessage>()
    let removed: string[] = []
    let orderChanged = false
    if (event?.type === 'snapshot') {
      sources = new Map(event.messages.map((message) => [message.id, message]))
      candidates = sources
      removed = [...this.messages.keys()].filter((id) => !sources.has(id))
      orderChanged = !isDeepStrictEqual([...this.messages.keys()], [...sources.keys()])
      nextState = {
        coverage: event.coverage,
        activity: event.activity,
        inputs: this.mergeInputs(event.inputs),
        subagents: event.subagents ?? []
      }
    } else if (event?.type === 'message.upsert' || event?.type === 'message.remove') {
      if (this.state.gap || this.state.closed) return []
      if (event.type === 'message.remove') {
        removed = this.messages.has(event.ref.id) ? [event.ref.id] : []
        orderChanged = removed.length > 0
      } else {
        candidates.set(event.message.id, event.message)
        if (event.replaces?.some((ref) => ref.id !== event.message.id && sources.has(ref.id))) {
          const replaced = new Set<string>(event.replaces.map((ref) => ref.id))
          replaced.add(event.message.id)
          sources = new Map()
          for (const [id, item] of this.sources) {
            if (replaced.has(id)) {
              if (!sources.has(event.message.id)) sources.set(event.message.id, event.message)
            } else sources.set(id, item)
          }
          removed = [...replaced].filter((id) => id !== event.message.id && this.messages.has(id))
          orderChanged = true
        } else orderChanged = !sources.has(event.message.id)
      }
    } else if (event?.type === 'input.changed') nextState = { ...state, inputs: this.mergeInputs([event.input]) }
    else if (event?.type === 'activity.changed') nextState = { ...state, activity: event.activity }
    else if (event?.type === 'subagent.upsert') {
      const relations = new Map(state.subagents.map((relation) => [relation.id, relation]))
      relations.set(event.subagent.id, event.subagent)
      nextState = { ...state, subagents: [...relations.values()] }
    } else if (event?.type === 'diagnostic') nextState = { ...state, diagnostic: event.error }
    else if (event?.type === 'gap' || event?.type === 'closed') {
      nextState = event.type === 'gap' ? { ...state, gap: event.reason } : { ...state, closed: event.reason }
    }
    for (const id of refresh) {
      const source = sources.get(id)
      if (source) candidates.set(id, source)
    }
    // Decorators may throw; commit only after every affected message has been projected.
    const changed: CherryUIMessage[] = []
    for (const source of candidates.values()) {
      const message = this.project(source)
      if (message !== this.messages.get(message.id)) changed.push(message)
    }
    if (event?.type === 'message.upsert') sources.set(event.message.id, event.message)
    if (event?.type === 'message.remove') sources.delete(event.ref.id)
    for (const id of removed) this.messages.delete(id)
    for (const message of changed) this.messages.set(message.id, message)
    if (sources !== this.sources) {
      this.sources = sources
      this.messages = new Map([...sources.keys()].map((id) => [id, this.messages.get(id)!]))
    }
    this.state = nextState
    this.publish(changed, removed, orderChanged, state)
    return changed
  }

  private publish(
    changed: readonly CherryUIMessage[],
    removed: readonly string[],
    orderChanged: boolean,
    state: ProjectionState
  ): void {
    if (!changed.length && !removed.length && !orderChanged && isDeepStrictEqual(state, this.state)) return
    this.revision++
    this.view = undefined
    if (this.listeners.size) {
      const update: ThreadProjectionUpdate = {
        type: 'change',
        revision: this.revision,
        messages: changed,
        removed,
        order: [...this.messages.keys()],
        state: this.state
      }
      for (const listener of [...this.listeners]) this.deliver(listener, update)
    }
  }

  private deliver(listener: (update: ThreadProjectionUpdate) => void, update: ThreadProjectionUpdate): void {
    try {
      listener(update)
    } catch (error) {
      this.listeners.delete(listener)
      logger.warn('Detached failed thread projection subscriber', { thread: this.thread, error })
    }
  }

  private project(source: RuntimeMessage): CherryUIMessage {
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
      parts: source.parts as CherryUIMessage['parts'],
      metadata: { status: pending ? 'pending' : 'success' }
    }
    const message = this.decorate?.(normalized, source) ?? normalized
    const previous = this.messages.get(message.id)
    return previous && isDeepStrictEqual(message, previous) ? previous : message
  }
}
