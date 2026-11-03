import type { Message } from '@earendil-works/pi-ai'
import type { EntryRecord } from '@earendil-works/pi-durable'

import { type RuntimeMessage } from '@cherrystudio/agent-runtime'

/** Stable committed identities; consumers never decode native entry IDs from these keys. */
export const entryMessageId = (entry: EntryRecord, index: number): string => `entry:${entry.id}:${index}`

export class ContentProjection {
  readonly messages: RuntimeMessage[] = []
  private readonly calls = new Map<string, { message: RuntimeMessage; index: number }>()

  entry(entry: EntryRecord): void {
    for (const [index, message] of (entry.model ?? []).entries()) {
      this.message(message, entryMessageId(entry, index), 'complete')
    }
  }

  message(message: Message, id: string, completeness: 'partial' | 'complete'): void {
    if (message.role === 'system') return
    if (message.role === 'toolResult') {
      this.result(
        message.toolCallId,
        {
          content: message.content,
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
          this.calls.set(part.id, { message: value, index: value.parts.length })
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
  }

  private result(callId: string, output: unknown, error: boolean, preliminary = false): void {
    const owner = this.calls.get(callId)
    if (!owner) return
    const part = owner.message.parts[owner.index]
    if (part.type !== 'dynamic-tool') return
    const base = {
      type: 'dynamic-tool' as const,
      toolName: part.toolName,
      toolCallId: part.toolCallId,
      input: part.input,
      callProviderMetadata: part.callProviderMetadata
    }
    owner.message.parts[owner.index] = error
      ? {
          ...base,
          state: 'output-error',
          errorText: this.errorText(output),
          resultProviderMetadata: { pi: { result: JSON.parse(JSON.stringify(output)) } }
        }
      : { ...base, state: 'output-available', output, preliminary }
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
