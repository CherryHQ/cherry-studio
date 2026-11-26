import { copyJson, isJsonValue } from '@earendil-works/chord/json'
import type { AssistantMessage, ToolResultMessage, UserMessage } from '@earendil-works/pi-ai'
import type { EntryRecord, LiveState, ToolSlot } from '@earendil-works/pi-durable'

import { immutable, projectNestedTool, snapshotToolPart, type RuntimeMessage } from '@cherrystudio/agent-runtime'

import { productInputId } from './inputLookup'

type ToolPart = Extract<RuntimeMessage['parts'][number], { type: 'dynamic-tool' }>
type AvailableTool = Extract<ToolPart, { state: 'output-available' }>
type CompletedTool = (AvailableTool & { preliminary: false }) | Extract<ToolPart, { state: 'output-error' }>
type NativePart = Exclude<(UserMessage | AssistantMessage)['content'], string>[number]
type ToolLocation = { message: number; index: number }

/** Stable committed identities; consumers never decode native entry IDs from these keys. */
export const entryMessageId = (entry: EntryRecord, index: number): string => `entry:${entry.id}:${index}`

export function messagePart(part: NativePart, state: 'streaming' | 'done'): RuntimeMessage['parts'][number] {
  switch (part.type) {
    case 'text':
      return {
        type: 'text',
        text: part.text,
        state,
        ...(part.textSignature && { providerMetadata: { pi: { textSignature: part.textSignature } } })
      }
    case 'thinking':
      return {
        type: 'reasoning',
        text: part.thinking,
        state,
        ...(part.thinkingSignature && { providerMetadata: { pi: { thinkingSignature: part.thinkingSignature } } })
      }
    case 'image':
      return { type: 'file', mediaType: part.mimeType, url: `data:${part.mimeType};base64,${part.data}` }
    case 'toolCall':
      return {
        type: 'dynamic-tool',
        toolCallId: part.id,
        toolName: part.name,
        state: state === 'done' ? 'input-available' : 'input-streaming',
        input: part.arguments
      }
  }
}

export function previewMessage(id: string, content: AssistantMessage['content']): RuntimeMessage {
  return {
    id,
    role: 'assistant',
    metadata: { completeness: 'partial' },
    parts: content.map((part) => messagePart(part, 'streaming'))
  }
}

export class ContentProjection {
  private sealedLength: number
  private readonly edited: number[] = []

  private constructor(
    private readonly messages: RuntimeMessage[],
    private readonly calls = new Map<string, ToolLocation>()
  ) {
    this.sealedLength = messages.length
  }

  static empty(): ContentProjection {
    return new ContentProjection([])
  }

  forkArchive(): ContentProjection {
    return new ContentProjection(this.seal().slice(), new Map(this.calls))
  }

  seal(): readonly RuntimeMessage[] {
    for (const index of this.edited) this.messages[index] = immutable(this.messages[index])
    this.edited.length = 0
    for (; this.sealedLength < this.messages.length; this.sealedLength++)
      this.messages[this.sealedLength] = immutable(this.messages[this.sealedLength])
    return this.messages
  }

  entry(entry: EntryRecord, responseIds?: Map<string, string>): void {
    if (!entry.model || entry.kind === 'cherry.imported-history' || entry.kind === 'cherry.reference-context') return
    for (const [index, message] of entry.model.entries()) {
      if (message.role === 'system') continue
      if (message.role === 'toolResult') {
        this.result(message)
        continue
      }
      const id = entryMessageId(entry, index)
      const metadata: NonNullable<RuntimeMessage['metadata']> = { completeness: 'complete' }
      if (message.role === 'user') {
        const inputId = productInputId(entry.data)
        if (inputId) metadata.inputId = inputId
      } else {
        if (responseIds && message.responseId) responseIds.set(message.responseId, id)
        if (message.stopReason === 'error')
          metadata.error = {
            operation: 'input',
            code: 'model-error',
            message: message.errorMessage ?? 'Durable response ended: error'
          }
      }
      this.append(message, id, metadata)
    }
  }

  private append(
    message: UserMessage | AssistantMessage,
    id: string,
    metadata: NonNullable<RuntimeMessage['metadata']>
  ): void {
    const owner = this.messages.length
    const state = metadata.completeness === 'partial' ? 'streaming' : 'done'
    const parts: RuntimeMessage['parts'] =
      typeof message.content === 'string'
        ? [{ type: 'text', text: message.content, state }]
        : message.content.map((part, index) => {
            if (part.type === 'toolCall') this.calls.set(part.id, { message: owner, index })
            return messagePart(part, state)
          })
    this.messages.push({ id, role: message.role, metadata, parts })
  }

  private write(index: number): RuntimeMessage {
    const message = this.messages[index]
    if (!Object.isFrozen(message)) return message
    const copy = { ...message, parts: message.parts.slice() }
    this.messages[index] = copy
    this.edited.push(index)
    return copy
  }

  private putNested(owner: number, part: ToolPart, existing: ToolLocation | undefined): void {
    const message = this.write(owner)
    if (existing?.message === owner) {
      message.parts[existing.index] = part
      return
    }
    this.calls.set(part.toolCallId, { message: owner, index: message.parts.length })
    message.parts.push(part)
  }

  tool(callId: string): (ToolLocation & { id: string; part: ToolPart }) | undefined {
    const owner = this.calls.get(callId)
    if (!owner) return
    const message = this.messages[owner.message]
    const part = message.parts[owner.index]
    if (part.type === 'dynamic-tool') return { ...owner, id: message.id, part }
  }

  result(result: ToolResultMessage): { id: string; index: number; part: CompletedTool } | undefined {
    const tool = this.tool(result.toolCallId)
    if (!tool) return
    const output = immutable({
      content: result.content,
      ...(result.nestedCalls && { nestedCalls: result.nestedCalls }),
      ...(result.details !== undefined && { details: result.details }),
      isError: result.isError
    })
    for (const record of output.nestedCalls?.calls ?? [])
      this.putNested(tool.message, projectNestedTool(record, providerResult), this.calls.get(record.id))
    const part = completedToolOutput(tool.part, output)
    this.write(tool.message).parts[tool.index] = part
    return { id: tool.id, index: tool.index, part }
  }

  liveMessages(live: LiveState | undefined, previewId: string | undefined): readonly RuntimeMessage[] {
    const messages = this.seal()
    const assistant = live?.generation?.message
    if (
      !live?.tools?.some((slot) => hasToolProgress(slot) || slot.nestedCalls?.calls.length) &&
      !live?.nestedTools?.some((slot) => !slot.summary)
    )
      return assistant && previewId ? [...messages, previewMessage(previewId, assistant.content)] : messages
    const draft = new ContentProjection(messages.slice())
    if (assistant && previewId) draft.append(assistant, previewId, { completeness: 'partial' })
    const location = (id: string) => draft.calls.get(id) ?? this.calls.get(id)
    const nested = (parentId: string, part: ToolPart) => {
      const parent = location(parentId)
      if (parent) draft.putNested(parent.message, part, location(part.toolCallId))
    }
    const progress = (id: string, text: string) => {
      const owner = location(id)
      if (!owner) return
      const part = draft.messages[owner.message].parts[owner.index]
      if (part.type === 'dynamic-tool') draft.write(owner.message).parts[owner.index] = previewToolOutput(part, text)
    }
    for (const slot of live.tools ?? []) {
      if (hasToolProgress(slot)) progress(slot.callId, slot.output)
    }
    for (const slot of live.tools ?? [])
      for (const record of slot.nestedCalls?.calls ?? []) nested(slot.callId, projectNestedTool(record, providerResult))
    for (const slot of live.nestedTools ?? []) {
      if (slot.summary) continue
      nested(slot.parentCallId, {
        type: 'dynamic-tool',
        toolName: slot.name,
        toolCallId: slot.callId,
        state: 'input-available',
        input: slot.arguments,
        callProviderMetadata: { pi: { parentToolCallId: slot.parentCallId, nested: true } }
      })
      if (slot.output !== undefined) progress(slot.callId, slot.output)
      for (const child of slot.nestedCalls?.calls ?? []) nested(slot.callId, projectNestedTool(child, providerResult))
    }
    return draft.seal()
  }
}

function hasToolProgress(slot: ToolSlot): slot is ToolSlot & { output: string } {
  return slot.output !== undefined && slot.taskId !== undefined && slot.entry === undefined
}

function toolCallFields({ toolCallId, toolName, input, callProviderMetadata }: ToolPart) {
  return { type: 'dynamic-tool' as const, toolCallId, toolName, input, callProviderMetadata }
}

export function previewToolOutput(part: ToolPart, text: string): AvailableTool & { preliminary: true } {
  return snapshotToolPart({
    ...toolCallFields(part),
    state: 'output-available' as const,
    output: { content: [{ type: 'text', text }] },
    preliminary: true
  })
}

function providerResult(value: unknown) {
  return isJsonValue(value) ? value : copyJson(value, { omitUndefinedProperties: true })
}

function completedToolOutput(
  part: ToolPart,
  output: Pick<ToolResultMessage, 'content' | 'nestedCalls' | 'details' | 'isError'>
): CompletedTool {
  const call = toolCallFields(part)
  if (!output.isError)
    return snapshotToolPart({ ...call, state: 'output-available' as const, output, preliminary: false })
  const text: string[] = []
  for (const block of output.content) if (block.type === 'text') text.push(block.text)
  return snapshotToolPart({
    ...call,
    state: 'output-error' as const,
    errorText: text.join('\n'),
    resultProviderMetadata: {
      pi: { result: providerResult(output) }
    }
  })
}
