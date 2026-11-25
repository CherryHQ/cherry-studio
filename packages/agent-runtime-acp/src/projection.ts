import { randomUUID } from 'node:crypto'

import type { ContentBlock, PromptResponse, SessionUpdate, ToolCallUpdate, UsageUpdate } from '@agentclientprotocol/sdk'

import {
  applyMessageParts,
  isLivePartInput,
  messageObservation,
  runtimeId,
  RuntimeMessageStream,
  ThreadFeed,
  type Completeness,
  type InputId,
  type ObservationPayload,
  type OperationResult,
  type RuntimeMessage,
  type RuntimePartEdit,
  type Thread,
  type ThreadContextUsage
} from '@cherrystudio/agent-runtime'

import { unavailable } from './result'
import type { AcpNativeMessage, AcpSessionState } from './types'

type Chunk = Parameters<RuntimeMessageStream['append']>[0][number]
type ContentSource = {
  native: Omit<AcpNativeMessage, 'chunks'> & { chunks: AcpNativeMessage['chunks'][number][] }
  partCount: number
}

export class Projection {
  readonly feed: ThreadFeed
  revision = 0
  publishing?: SessionUpdate
  private configuration: AcpSessionState['configuration'] = {}
  private readonly epoch = randomUUID()
  private sequence = 0
  private current?: { kind: string; id: string }
  private readonly messages = new Map<string, ContentSource>()
  private readonly tools = new Map<string, ToolCallUpdate>()
  private readonly metadata = new Map<SessionUpdate['sessionUpdate'], SessionUpdate>()
  private readonly streams = new Map<string, RuntimeMessageStream>()
  private activeMessages = new Set<string>()
  private usage?: UsageUpdate
  private turns: { inputId: InputId; response: PromptResponse }[] = []

  constructor(
    readonly sessionId: string,
    private readonly thread: Thread,
    report: (error: unknown) => void
  ) {
    this.feed = new ThreadFeed({ type: 'snapshot', messages: [], inputs: [], activity: { state: 'unknown' } }, report)
  }

  state(): AcpSessionState {
    // oxlint-disable-next-line no-restricted-globals -- Capture full ACP recovery state for observers; desktop does not use this adapter yet.
    return structuredClone({
      configuration: this.configuration,
      turns: this.turns,
      messages: Array.from(this.messages.values(), (source) => source.native),
      tools: [...this.tools.values()],
      metadata: [...this.metadata.values()]
    })
  }

  configure(value: AcpSessionState['configuration']): void {
    this.updateConfiguration(value)
    this.publish({ ...this.feed.snapshot, contextUsage: this.contextUsage() })
  }

  private get model(): string | undefined {
    const option = this.configuration.configOptions?.find((item) => item.category === 'model' && item.type === 'select')
    return option?.type === 'select' ? option.currentValue : undefined
  }

  private updateConfiguration(value: AcpSessionState['configuration']): void {
    const model = this.model
    this.configuration = { ...this.configuration, ...value }
    if (this.model !== model) this.usage = undefined
  }

  contextUsage(): OperationResult<ThreadContextUsage> {
    const model = this.model
    if (!this.usage || !model) return unavailable('contextUsage', 'missing-native-context-or-model')
    if (this.usage.size <= 0) return unavailable('contextUsage', 'invalid-native-context')
    return {
      status: 'confirmed',
      value: {
        model,
        revision: String(this.revision),
        contextWindow: this.usage.size,
        used: { tokens: this.usage.used, precision: 'reported' },
        basis: 'current-context'
      }
    }
  }

  publish(event: ObservationPayload): void {
    this.revision++
    if (isLivePartInput(event)) this.feed.publishPart(event)
    else this.feed.publish(event)
  }

  private observeMessage(message: RuntimeMessage): ObservationPayload {
    return messageObservation(
      { session: this.thread, id: runtimeId(message.id) },
      this.feed.message(message.id),
      message
    )
  }

  rememberPrompt(inputId: InputId, response: PromptResponse): void {
    // oxlint-disable-next-line no-restricted-globals -- Own one completed prompt response before retaining it in ACP recovery state.
    this.turns.push(structuredClone({ inputId, response }))
  }

  boundary(): void {
    this.current = undefined
  }

  async finish(completeness: Completeness): Promise<void> {
    for (const id of this.activeMessages) {
      const stream = this.streams.get(id)
      if (stream) {
        this.publish(this.observeMessage(await stream.append([], completeness)))
        continue
      }
      const message = this.feed.message(id)!
      const last = message.parts.at(-1)
      const finished =
        (last?.type === 'text' || last?.type === 'reasoning') && last.state === 'streaming'
          ? applyMessageParts(message, [{ type: 'finish', part: message.parts.length - 1 }])!
          : message
      this.publish({ type: 'message.reconcile', message: { ...finished, metadata: { completeness } } })
    }
    this.activeMessages.clear()
    this.boundary()
  }

  async update(update: SessionUpdate): Promise<void> {
    let event: ObservationPayload | undefined
    if (
      update.sessionUpdate === 'agent_message_chunk' ||
      update.sessionUpdate === 'agent_thought_chunk' ||
      update.sessionUpdate === 'user_message_chunk'
    ) {
      const kind = update.sessionUpdate
      const nativeId = update.messageId ?? undefined
      const id =
        nativeId !== undefined
          ? JSON.stringify([this.sessionId, kind, nativeId])
          : this.current?.kind === kind
            ? this.current.id
            : `${this.epoch}:${++this.sequence}`
      this.current = { kind, id }
      let source = this.messages.get(id)
      if (!source) {
        source = { native: { id, kind, nativeId, chunks: [] }, partCount: 0 }
        this.messages.set(id, source)
      }
      source.native.chunks.push(update)
      event = this.contentEvent(source, update.content)
      this.activeMessages.add(id)
    } else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      const tool = { ...this.tools.get(update.toolCallId), ...update }
      this.tools.set(update.toolCallId, tool)
      this.current = undefined
      const id = JSON.stringify([this.sessionId, 'tool', update.toolCallId])
      this.activeMessages.add(id)
      const chunks: Chunk[] = [
        {
          type: 'tool-input-available',
          toolCallId: update.toolCallId,
          toolName: tool.name ?? tool.title ?? 'ACP tool',
          input: tool.rawInput ?? {},
          dynamic: true
        }
      ]
      if (tool.status === 'completed')
        chunks.push({
          type: 'tool-output-available',
          toolCallId: update.toolCallId,
          output: tool.rawOutput ?? tool.content ?? null,
          dynamic: true
        })
      if (tool.status === 'failed')
        chunks.push({
          type: 'tool-output-error',
          toolCallId: update.toolCallId,
          errorText:
            typeof tool.rawOutput === 'string'
              ? tool.rawOutput
              : JSON.stringify(tool.rawOutput ?? tool.content ?? tool.title ?? 'Tool failed'),
          dynamic: true
        })
      let stream = this.streams.get(id)
      if (!stream) this.streams.set(id, (stream = new RuntimeMessageStream(id)))
      event = this.observeMessage(await stream.append(chunks, 'partial'))
    } else {
      this.metadata.set(update.sessionUpdate, update)
      if (update.sessionUpdate === 'config_option_update')
        this.updateConfiguration({ configOptions: update.configOptions })
      if (update.sessionUpdate === 'current_mode_update' && this.configuration.modes)
        this.configuration.modes.currentModeId = update.currentModeId
      if (update.sessionUpdate === 'usage_update') this.usage = update
      if (update.sessionUpdate === 'usage_update' || update.sessionUpdate === 'config_option_update')
        event = { ...this.feed.snapshot, contextUsage: this.contextUsage() }
    }
    this.publishing = update
    try {
      // Snapshot ticks keep native-only updates on the same bounded observation queue.
      this.publish(event ?? this.feed.snapshot)
    } finally {
      this.publishing = undefined
    }
  }

  private contentEvent(source: ContentSource, content: ContentBlock): ObservationPayload {
    const { id, kind } = source.native
    const user = kind === 'user_message_chunk'
    const type = kind === 'agent_thought_chunk' ? 'reasoning' : 'text'
    const lastIndex = source.partCount - 1
    const last = this.feed.part(id, lastIndex)
    const changes: RuntimePartEdit[] = []
    if (content.type === 'text') {
      const continuing = last?.type === type && (user || last.state === 'streaming')
      const part = continuing ? lastIndex : source.partCount++
      if (!continuing) changes.push({ type: 'open', kind: type, part })
      if (user) changes.push({ type: 'correct', kind: type, part, text: (continuing ? last.text : '') + content.text })
      else if (content.text) changes.push({ type: 'append', part, text: content.text })
    } else {
      if (!user && last?.type === type && last.state === 'streaming') changes.push({ type: 'finish', part: lastIndex })
      const file = filePart(content)
      if (file) changes.push({ type: 'put', part: source.partCount++, value: file })
    }
    if (this.activeMessages.has(id))
      return { type: 'message.parts', ref: { session: this.thread, id: runtimeId(id) }, changes }

    const before = this.feed.message(id) ?? { id, role: user ? 'user' : 'assistant', parts: [] }
    const message = applyMessageParts(before, changes)!
    return {
      type: 'message.reconcile',
      message: { ...message, metadata: user && before.metadata ? before.metadata : { completeness: 'partial' } }
    }
  }

  async close(): Promise<void> {
    await Promise.all(Array.from(this.streams.values(), (stream) => stream.close()))
  }
}

function filePart(content: ContentBlock): Extract<RuntimeMessage['parts'][number], { type: 'file' }> | undefined {
  if (content.type === 'image' || content.type === 'audio')
    return { type: 'file', mediaType: content.mimeType, url: `data:${content.mimeType};base64,${content.data}` }
  return undefined
}
