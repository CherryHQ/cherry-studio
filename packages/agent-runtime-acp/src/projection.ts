import { randomUUID } from 'node:crypto'

import type { ContentBlock, PromptResponse, SessionUpdate, ToolCallUpdate, UsageUpdate } from '@agentclientprotocol/sdk'

import {
  RuntimeMessageStream,
  ThreadFeed,
  type Completeness,
  type InputId,
  type ObservationPayload,
  type OperationResult,
  type RuntimeMessage,
  type ThreadContextUsage
} from '@cherrystudio/agent-runtime'

import { unavailable } from './result'
import type { AcpNativeMessage, AcpSessionState } from './types'

type Chunk = Parameters<RuntimeMessageStream['append']>[0][number]

export class Projection {
  readonly feed: ThreadFeed
  revision = 0
  publishing?: SessionUpdate
  private configuration: AcpSessionState['configuration'] = {}
  private readonly epoch = randomUUID()
  private sequence = 0
  private current?: { kind: string; id: string }
  private readonly messages = new Map<string, AcpNativeMessage>()
  private readonly tools = new Map<string, ToolCallUpdate>()
  private readonly metadata = new Map<SessionUpdate['sessionUpdate'], SessionUpdate>()
  private readonly streams = new Map<
    string,
    { stream: RuntimeMessageStream; part?: { kind: 'text' | 'reasoning'; id: string }; sequence: number }
  >()
  private readonly users = new Map<string, RuntimeMessage>()
  private activeMessages = new Set<string>()
  private usage?: UsageUpdate
  private turns: { inputId: InputId; response: PromptResponse }[] = []

  constructor(
    readonly sessionId: string,
    report: (error: unknown) => void
  ) {
    this.feed = new ThreadFeed({ type: 'snapshot', messages: [], inputs: [], activity: { state: 'unknown' } }, report)
  }

  state(): AcpSessionState {
    return structuredClone({
      configuration: this.configuration,
      turns: this.turns,
      messages: [...this.messages.values()],
      tools: [...this.tools.values()],
      metadata: [...this.metadata.values()]
    })
  }

  configure(value: AcpSessionState['configuration']): void {
    this.configuration = { ...this.configuration, ...value }
    this.publish({ ...this.feed.snapshot, contextUsage: this.contextUsage() })
  }

  contextUsage(): OperationResult<ThreadContextUsage> {
    const option = this.configuration.configOptions?.find((item) => item.category === 'model' && item.type === 'select')
    const model = option?.type === 'select' ? option.currentValue : undefined
    if (!this.usage || !model) return unavailable('contextUsage', 'missing-native-context-or-model')
    if (
      !Number.isFinite(this.usage.size) ||
      this.usage.size <= 0 ||
      !Number.isFinite(this.usage.used) ||
      this.usage.used < 0
    )
      return unavailable('contextUsage', 'invalid-native-context')
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
    this.feed.publish(event)
  }

  rememberPrompt(inputId: InputId, response: PromptResponse): void {
    this.turns.push(structuredClone({ inputId, response }))
  }

  boundary(): void {
    this.current = undefined
  }

  async finish(completeness: Completeness): Promise<void> {
    for (const id of this.activeMessages) {
      const value = this.streams.get(id)
      if (value) {
        const end: Chunk[] = value.part ? [{ type: `${value.part.kind}-end`, id: value.part.id }] : []
        this.publish({ type: 'message.upsert', message: await value.stream.append(end, completeness) })
        value.part = undefined
      }
      const user = this.users.get(id)
      if (user) {
        user.metadata = { completeness }
        this.publish({ type: 'message.upsert', message: user })
      }
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
      const previous = this.messages.get(id)
      this.messages.set(id, { id, kind, nativeId, chunks: [...(previous?.chunks ?? []), update] })
      this.activeMessages.add(id)
      if (kind === 'user_message_chunk') {
        const message = this.users.get(id) ?? { id, role: 'user', parts: [], metadata: { completeness: 'partial' } }
        const content = update.content
        if (content.type === 'text') {
          const last = message.parts.at(-1)
          if (last?.type === 'text') last.text += content.text
          else message.parts.push({ type: 'text', text: content.text })
        } else {
          const file = filePart(content)
          if (file) message.parts.push(file)
        }
        this.users.set(id, message)
        event = { type: 'message.upsert', message }
      } else {
        const value = this.stream(id)
        const content = update.content
        const chunks: Chunk[] = []
        if (content.type === 'text') {
          const type = kind === 'agent_thought_chunk' ? 'reasoning' : 'text'
          if (value.part?.kind !== type) {
            value.part = { kind: type, id: String(++value.sequence) }
            chunks.push({ type: `${type}-start`, id: value.part.id })
          }
          chunks.push({ type: `${type}-delta`, id: value.part.id, delta: content.text })
        } else {
          if (value.part) chunks.push({ type: `${value.part.kind}-end`, id: value.part.id })
          const file = filePart(content)
          if (file) chunks.push(file)
          value.part = undefined
        }
        event = { type: 'message.upsert', message: await value.stream.append(chunks, 'partial') }
      }
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
      event = { type: 'message.upsert', message: await this.stream(id).stream.append(chunks, 'partial') }
    } else {
      this.metadata.set(update.sessionUpdate, update)
      if (update.sessionUpdate === 'config_option_update') this.configuration.configOptions = update.configOptions
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

  async close(): Promise<void> {
    await Promise.all([...this.streams.values()].map(({ stream }) => stream.close()))
  }

  private stream(id: string) {
    let value = this.streams.get(id)
    if (!value) {
      value = { stream: new RuntimeMessageStream(id), sequence: 0 }
      this.streams.set(id, value)
    }
    return value
  }
}

function filePart(content: ContentBlock): Extract<RuntimeMessage['parts'][number], { type: 'file' }> | undefined {
  if (content.type === 'image' || content.type === 'audio')
    return { type: 'file', mediaType: content.mimeType, url: `data:${content.mimeType};base64,${content.data}` }
  return undefined
}
