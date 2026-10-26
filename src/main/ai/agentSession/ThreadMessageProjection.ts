import { isDeepStrictEqual } from 'node:util'

import { readUIMessageStream } from 'ai'

import type {
  Activity,
  ContentItem,
  InputState,
  MessageItem,
  Observation,
  ObservationPayload,
  RuntimeError,
  Subagent,
  Thread,
  ThreadHandle,
  ThreadSnapshot,
  ToolCallItem,
  ToolResultItem
} from '@cherrystudio/agent-runtime'
import { loggerService } from '@logger'
import type { CherryUIMessage, CherryUIMessageChunk } from '@shared/data/types/message'

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
type Source = { item: MessageItem | ToolCallItem; result?: ToolResultItem }

/** Main-owned current view. Native execution, product IDs and archive writes belong to its caller. */
export class ThreadMessageProjection {
  private items = new Map<string, ContentItem>()
  private readonly sources = new Map<string, Source>()
  private readonly messages = new Map<string, CherryUIMessage>()
  private readonly readers = new Map<string, MessageReader>()
  private readonly listeners = new Set<(update: ThreadProjectionUpdate) => void>()
  private state: ProjectionState = { activity: { scope: 'foreground', state: 'unknown' }, inputs: [], subagents: [] }
  private revision = 0
  private pending: Promise<void> = Promise.resolve()
  private attachment: Promise<void> = Promise.resolve()
  private observation?: Observation
  private source?: object
  private disposed = false
  private closing?: Promise<void>
  private view: ThreadMessageView

  constructor(readonly thread: Thread) {
    this.view = { ...this.state, thread, revision: 0, messages: [] }
  }

  snapshot(): ThreadMessageView {
    return this.view
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
      const result = await handle.observe((event) => (this.source === source ? this.accept(event) : undefined))
      if (result.status !== 'confirmed') {
        this.source = undefined
        throw new Error(result.error.message)
      }
      this.observation = result.value
    })
    this.attachment = attached.catch(() => {})
    return attached
  }

  accept(event: ObservationPayload): Promise<void> {
    if (this.disposed) return Promise.reject(new Error('Thread projection is closed'))
    const accepted = this.pending.then(async () => {
      const state = this.state
      try {
        await this.reduce(event)
      } catch (error) {
        this.source = undefined
        this.items.clear()
        this.sources.clear()
        this.messages.clear()
        for (const message of this.view.messages) this.messages.set(message.id, message)
        await this.closeReaders().catch(() => {})
        this.state = {
          ...state,
          gap: 'mapping-reset',
          closed: 'consumer-error',
          diagnostic: { operation: 'project', code: 'projection-failed', message: String(error) }
        }
        this.publish(new Map(this.messages), state)
        logger.warn('Thread projection requires a new observation baseline', { thread: this.thread, error })
        throw error
      }
    })
    this.pending = accepted.catch(() => {})
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
      await this.closeReaders()
      this.listeners.clear()
    })())
  }

  private assertThread(thread: Thread): void {
    if (thread.backendId !== this.thread.backendId || thread.id !== this.thread.id)
      throw new Error('Observation belongs to a different thread')
  }

  private validate(event: ObservationPayload): void {
    const item = (value: ContentItem) => {
      this.assertThread(value.ref.session)
      if (value.type === 'tool-result' && value.call) this.assertThread(value.call.session)
    }
    if (event.type === 'snapshot') {
      event.items.forEach(item)
      event.subagents?.forEach((relation) => this.assertThread(relation.parent))
      event.inputs.forEach((input) => this.validateInput(input))
    } else if (event.type === 'item.upsert') {
      item(event.item)
      event.replaces?.forEach((ref) => this.assertThread(ref.session))
    } else if (event.type === 'item.remove') this.assertThread(event.ref.session)
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

  private async reduce(event: ObservationPayload): Promise<void> {
    if (this.state.closed === 'consumer-error' && event.type !== 'snapshot') return
    this.validate(event)
    const before = new Map(this.messages)
    const state = this.state
    if (event.type === 'snapshot') {
      this.items = new Map(event.items.map((item) => [item.ref.id, item]))
      this.state = {
        coverage: event.coverage,
        activity: event.activity,
        inputs: this.mergeInputs(event.inputs),
        subagents: event.subagents ?? []
      }
    } else if (event.type === 'item.upsert' || event.type === 'item.remove') {
      if (this.state.gap || this.state.closed) return
      if (event.type === 'item.remove') this.items.delete(event.ref.id)
      else {
        const replaced = new Set<string>(event.replaces?.map((ref) => ref.id))
        replaced.add(event.item.ref.id)
        const items = new Map<string, ContentItem>()
        for (const [id, item] of this.items) {
          if (replaced.has(id)) {
            if (!items.has(event.item.ref.id)) items.set(event.item.ref.id, event.item)
          } else items.set(id, item)
        }
        items.set(event.item.ref.id, event.item)
        this.items = items
      }
    } else if (event.type === 'input.changed') this.state = { ...this.state, inputs: this.mergeInputs([event.input]) }
    else if (event.type === 'activity.changed') this.state = { ...this.state, activity: event.activity }
    else if (event.type === 'subagent.upsert') {
      const relations = new Map(this.state.subagents.map((relation) => [relation.id, relation]))
      relations.set(event.subagent.id, event.subagent)
      this.state = { ...this.state, subagents: [...relations.values()] }
    } else if (event.type === 'diagnostic') this.state = { ...this.state, diagnostic: event.error }
    else if (event.type === 'gap' || event.type === 'closed') {
      this.state = event.type === 'gap' ? { ...this.state, gap: event.reason } : { ...this.state, closed: event.reason }
      await this.closeReaders()
    }
    if (event.type === 'snapshot' || event.type === 'item.upsert' || event.type === 'item.remove') {
      await this.project()
    }
    this.publish(before, state)
  }

  private publish(before: ReadonlyMap<string, CherryUIMessage>, state: ProjectionState): void {
    const changed = [...this.messages.values()].filter((message) => before.get(message.id) !== message)
    const removed = [...before.keys()].filter((id) => !this.messages.has(id))
    const order = [...this.messages.keys()]
    if (
      !changed.length &&
      !removed.length &&
      isDeepStrictEqual([...before.keys()], order) &&
      isDeepStrictEqual(state, this.state)
    )
      return
    this.revision++
    this.view = { ...this.state, thread: this.thread, revision: this.revision, messages: [...this.messages.values()] }
    const update: ThreadProjectionUpdate = {
      type: 'change',
      revision: this.revision,
      messages: changed,
      removed,
      order,
      state: this.state
    }
    for (const listener of [...this.listeners]) this.deliver(listener, update)
  }

  private async closeReaders(): Promise<void> {
    const readers = [...this.readers.values()]
    this.readers.clear()
    await Promise.all(readers.map((reader) => reader.close()))
  }

  private deliver(listener: (update: ThreadProjectionUpdate) => void, update: ThreadProjectionUpdate): void {
    try {
      listener(update)
    } catch (error) {
      this.listeners.delete(listener)
      logger.warn('Detached failed thread projection subscriber', { thread: this.thread, error })
    }
  }

  private async project(): Promise<void> {
    const next = new Map<string, Source>()
    const results = new Map<string, ToolResultItem>()
    for (const item of this.items.values())
      if (item.type === 'tool-result' && item.call) results.set(item.call.id, item)
    for (const item of this.items.values())
      if (item.type !== 'tool-result')
        next.set(item.ref.id, { item, result: item.type === 'tool-call' ? results.get(item.ref.id) : undefined })
    for (const id of this.messages.keys())
      if (!next.has(id)) {
        await this.readers.get(id)?.close()
        this.readers.delete(id)
        this.sources.delete(id)
        this.messages.delete(id)
      }
    for (const [id, source] of next) {
      const previous = this.sources.get(id)
      if (isDeepStrictEqual(previous, source)) continue
      const message = await this.render(source, previous)
      this.sources.set(id, source)
      if (!isDeepStrictEqual(message, this.messages.get(id))) this.messages.set(id, message)
    }
    const ordered = [...next.keys()].map((id) => [id, this.messages.get(id)!] as const)
    this.messages.clear()
    for (const [id, message] of ordered) this.messages.set(id, message)
  }

  private async render(source: Source, previous?: Source): Promise<CherryUIMessage> {
    const { item, result } = source
    const id = item.ref.id
    let reader = this.readers.get(id)
    const append = previous && canAppend(previous, source)
    if (!append) {
      await reader?.close()
      this.readers.delete(id)
      reader = undefined
    }
    if (item.type === 'message' && (item.role !== 'assistant' || (item.completeness === 'complete' && !reader))) {
      return {
        id,
        role: item.role,
        metadata: undefined,
        parts: item.parts.map((part) => ({ ...part, state: item.completeness === 'complete' ? 'done' : 'streaming' }))
      }
    }
    const continuing = Boolean(reader)
    if (!reader) {
      reader = new MessageReader(id)
      this.readers.set(id, reader)
    }
    if (item.type === 'message') {
      const prior = continuing && previous?.item.type === 'message' ? previous.item.parts : []
      for (const [index, part] of item.parts.entries()) {
        const before = prior[index]
        const partId = String(index)
        if (!before) await reader.write({ type: part.type === 'text' ? 'text-start' : 'reasoning-start', id: partId })
        const delta = part.text.slice(before?.text.length ?? 0)
        if (delta)
          await reader.write({ type: part.type === 'text' ? 'text-delta' : 'reasoning-delta', id: partId, delta })
        if (item.completeness === 'complete')
          await reader.write({ type: part.type === 'text' ? 'text-end' : 'reasoning-end', id: partId })
      }
    } else {
      if (!continuing)
        await reader.write({ type: 'tool-input-start', toolCallId: id, toolName: item.name, dynamic: true })
      const before = continuing && previous?.item.type === 'tool-call' ? previous.item.argumentsText : ''
      const delta = item.argumentsText.slice(before.length)
      if (delta) await reader.write({ type: 'tool-input-delta', toolCallId: id, inputTextDelta: delta })
      if (item.completeness === 'complete') {
        let input: unknown
        try {
          input = JSON.parse(item.argumentsText)
        } catch (error) {
          await reader.write({
            type: 'tool-input-error',
            toolCallId: id,
            toolName: item.name,
            dynamic: true,
            input: item.argumentsText,
            errorText: String(error)
          })
        }
        if (input !== undefined)
          await reader.write({
            type: 'tool-input-available',
            toolCallId: id,
            toolName: item.name,
            dynamic: true,
            input
          })
      }
      if (result)
        await reader.write(
          result.outcome === 'error'
            ? { type: 'tool-output-error', toolCallId: id, errorText: result.parts.map((part) => part.text).join('\n') }
            : {
                type: 'tool-output-available',
                toolCallId: id,
                output: result.data === undefined ? result.parts : result.data,
                preliminary: result.outcome === 'unknown'
              }
        )
    }
    const message = reader.message
    if (item.completeness === 'complete') {
      await reader.close()
      this.readers.delete(id)
    }
    return message
  }
}

function canAppend(previous: Source, next: Source): boolean {
  const before = previous.item
  const after = next.item
  if (before.completeness === 'complete' || !isDeepStrictEqual(previous.result, next.result)) return false
  if (before.type === 'message' && after.type === 'message')
    return (
      before.role === after.role &&
      before.parts.length <= after.parts.length &&
      before.parts.every(
        (part, index) => part.type === after.parts[index].type && after.parts[index].text.startsWith(part.text)
      )
    )
  return (
    before.type === 'tool-call' &&
    after.type === 'tool-call' &&
    before.name === after.name &&
    after.argumentsText.startsWith(before.argumentsText)
  )
}

class MessageReader {
  private controller!: ReadableStreamDefaultController<CherryUIMessageChunk>
  private readonly reader: ReadableStreamDefaultReader<CherryUIMessage>
  private closed = false
  message: CherryUIMessage

  constructor(id: string) {
    this.message = { id, role: 'assistant', metadata: undefined, parts: [] }
    this.reader = readUIMessageStream<CherryUIMessage>({
      // The SDK mutates its seed before emitting snapshots; an empty published view must stay immutable.
      message: { ...this.message, parts: [] },
      stream: new ReadableStream({
        start: (controller) => {
          this.controller = controller
        }
      }),
      terminateOnError: true
    }).getReader()
  }

  async write(chunk: CherryUIMessageChunk): Promise<void> {
    this.controller.enqueue(chunk)
    const next = await this.reader.read()
    if (next.done) throw new Error('Message reader closed before applying an update')
    this.message = next.value
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.controller.close()
    await this.reader.read()
  }
}
