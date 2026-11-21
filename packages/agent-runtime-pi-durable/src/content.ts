import type { Message } from '@earendil-works/pi-ai'
import type { EntryRecord } from '@earendil-works/pi-durable'

import {
  immutable,
  projectNestedTool,
  runtimeId,
  snapshotToolPart,
  type RuntimeMessage
} from '@cherrystudio/agent-runtime'

/** Stable committed identities; consumers never decode native entry IDs from these keys. */
export const entryMessageId = (entry: EntryRecord, index: number): string => `entry:${entry.id}:${index}`

export class ContentProjection {
  readonly messages: RuntimeMessage[] = []
  readonly responseIds: Record<string, string> = {}
  get legacy(): Record<string, { messageId: string; parts: number[] }> {
    const legacy: Record<string, { messageId: string; parts: number[] }> = {}
    for (const message of this.messages) {
      const parts: number[] = []
      message.parts.forEach((part, index) => {
        if (part.type === 'dynamic-tool')
          legacy[`${message.id}:call:${part.toolCallId}`] = { messageId: message.id, parts: [index] }
        else parts.push(index)
      })
      legacy[message.id] = { messageId: message.id, parts }
    }
    return legacy
  }
  private readonly calls = new Map<string, { message: number; index: number }>()
  /** Messages created or copied since the last seal; all others are shared and must be copied before a write. */
  private readonly writable = new Set<RuntimeMessage>()

  /** Continue from this projection without changing the messages it already shares. */
  fork(): ContentProjection {
    const next = new ContentProjection()
    next.messages.push(...this.messages)
    Object.assign(next.responseIds, this.responseIds)
    for (const [id, call] of this.calls) next.calls.set(id, call)
    return next
  }

  /** Freeze written messages so later forks and publications share them by reference. */
  seal(): void {
    if (!this.writable.size) return
    this.messages.forEach((message, index) => {
      if (this.writable.has(message)) this.messages[index] = immutable(message)
    })
    this.writable.clear()
  }

  entry(entry: EntryRecord): void {
    // Imported history already has product-owned display records; native entries supply context only.
    if (entry.kind === 'cherry.imported-history') return
    if (entry.kind === 'cherry.reference-context') return
    for (const [index, message] of (entry.model ?? []).entries()) {
      this.message(message, entryMessageId(entry, index), 'complete')
      const inputId = (entry.data as { cherryInputId?: string })?.cherryInputId
      if (message.role === 'user' && inputId) {
        const value = this.write(this.messages.length - 1)
        value.metadata = { ...value.metadata!, inputId: runtimeId(inputId) }
      }
    }
  }

  message(message: Message, id: string, completeness: 'partial' | 'complete'): void {
    if (message.role === 'assistant' && message.responseId) this.responseIds[message.responseId] = id
    if (message.role === 'system') return
    if (message.role === 'toolResult') {
      for (const record of message.nestedCalls?.calls ?? []) this.nested(message.toolCallId, projectNestedTool(record))
      this.result(
        message.toolCallId,
        {
          content: message.content,
          nestedCalls: message.nestedCalls,
          ...(message.details !== undefined && { details: message.details }),
          isError: message.isError
        },
        message.isError
      )
      return
    }
    const value: RuntimeMessage = { id, role: message.role, parts: [], metadata: { completeness } }
    const state = completeness === 'complete' ? 'done' : 'streaming'
    if (typeof message.content === 'string') value.parts.push({ type: 'text', text: message.content, state })
    else
      for (const part of message.content) {
        if (part.type === 'text')
          value.parts.push({
            type: 'text',
            text: part.text,
            state,
            ...(part.textSignature && { providerMetadata: { pi: { textSignature: part.textSignature } } })
          })
        if (part.type === 'thinking')
          value.parts.push({
            type: 'reasoning',
            text: part.thinking,
            state,
            ...(part.thinkingSignature && { providerMetadata: { pi: { thinkingSignature: part.thinkingSignature } } })
          })
        if (part.type === 'image')
          value.parts.push({ type: 'file', mediaType: part.mimeType, url: `data:${part.mimeType};base64,${part.data}` })
        if (part.type === 'toolCall') {
          this.calls.set(part.id, { message: this.messages.length, index: value.parts.length })
          value.parts.push({
            type: 'dynamic-tool',
            toolCallId: part.id,
            toolName: part.name,
            state: completeness === 'complete' ? 'input-available' : 'input-streaming',
            input: part.arguments
          })
        }
      }
    this.messages.push(value)
    this.writable.add(value)
  }

  nested(parentCallId: string, part: RuntimeMessage['parts'][number]): void {
    if (part.type !== 'dynamic-tool') return
    const parent = this.calls.get(parentCallId)
    if (!parent) return
    const existing = this.calls.get(part.toolCallId)
    const message = this.write(parent.message)
    const index = existing?.index ?? message.parts.length
    message.parts[index] = part
    this.calls.set(part.toolCallId, { message: parent.message, index })
  }

  private write(index: number): RuntimeMessage {
    const message = this.messages[index]
    if (this.writable.has(message)) return message
    const copy = { ...message, parts: [...message.parts] }
    this.messages[index] = copy
    this.writable.add(copy)
    return copy
  }

  private result(callId: string, output: unknown, error: boolean, preliminary = false): void {
    const owner = this.calls.get(callId)
    if (!owner) return
    const part = this.messages[owner.message].parts[owner.index]
    if (part.type !== 'dynamic-tool') return
    const base = {
      type: 'dynamic-tool' as const,
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      input: part.input,
      callProviderMetadata: part.callProviderMetadata
    }
    this.write(owner.message).parts[owner.index] = error
      ? {
          ...base,
          state: 'output-error',
          errorText: this.errorText(output),
          resultProviderMetadata: { pi: { result: JSON.parse(JSON.stringify(output)) } }
        }
      : snapshotToolPart({ ...base, state: 'output-available', output, preliminary })
  }

  private errorText(output: unknown): string {
    const content = (output as { content?: { type: string; text?: string }[] }).content
    return (
      content
        ?.filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n') ?? String(output)
    )
  }

  progress(callId: string, text: string): void {
    this.result(callId, { content: [{ type: 'text', text }] }, false, true)
  }
}
