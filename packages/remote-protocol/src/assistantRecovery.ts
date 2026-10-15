import { textByteLength } from './agent/reducer'
import type { AgentExecution, AgentPart } from './agent/resources'
import {
  assistantBatchSchema,
  assistantCheckpointDescriptorSchema,
  assistantCheckpointPageSchema,
  encodeAssistantCheckpointPage,
  type AssistantBatch,
  type AssistantCheckpointDescriptor,
  type AssistantCheckpointPage,
  type AssistantCursor,
  type AssistantInteraction,
  type AssistantMessage,
  type AssistantTopic
} from './assistant'
import type { IntegrityPrimitives } from './values'

export interface AssistantProjection {
  cursor: AssistantCursor
  topic: AssistantTopic
  messages: Record<string, AssistantMessage>
  parts: Record<string, AgentPart>
  executions: Record<string, AgentExecution>
  interactions: Record<string, AssistantInteraction>
}
type Content = Readonly<Record<string, Uint8Array>>
type Result =
  | { ok: true; projection: AssistantProjection; cursor: AssistantCursor }
  | { ok: false; reason: 'invalid' | 'digest' | 'incomplete' | 'epoch' | 'gap' | 'revision' | 'content' }
const dictionary = <T>(source: Record<string, T> = {}): Record<string, T> => Object.assign(Object.create(null), source)

export function installAssistantCheckpoint(
  descriptor: AssistantCheckpointDescriptor,
  pages: readonly AssistantCheckpointPage[],
  content: Content,
  integrity: IntegrityPrimitives
): Result {
  const valid = assistantCheckpointDescriptorSchema.safeParse(descriptor)
  if (!valid.success) return { ok: false, reason: 'invalid' }
  if (pages.length !== descriptor.pageCount) return { ok: false, reason: 'incomplete' }
  const chunks: Uint8Array[] = []
  const projection: Omit<AssistantProjection, 'topic'> & { topic?: AssistantTopic } = {
    cursor: descriptor.cursor,
    messages: dictionary(),
    parts: dictionary(),
    executions: dictionary(),
    interactions: dictionary()
  }
  for (let index = 0; index < pages.length; index++) {
    const parsed = assistantCheckpointPageSchema.safeParse(pages[index])
    if (!parsed.success) return { ok: false, reason: 'invalid' }
    const page = parsed.data
    if (
      page.checkpointId !== descriptor.checkpointId ||
      page.pageIndex !== index ||
      page.nextCursor !== (index + 1 < pages.length ? String(index + 1) : null)
    )
      return { ok: false, reason: 'incomplete' }
    const bytes = encodeAssistantCheckpointPage(page)
    if (integrity.sha256(bytes) !== page.pageDigest) return { ok: false, reason: 'digest' }
    chunks.push(bytes)
    for (const item of page.items) {
      switch (item.kind) {
        case 'topic':
          if (
            projection.topic ||
            item.value.topicId !== descriptor.cursor.topicId ||
            item.value.historyRevision !== descriptor.historyRevision
          )
            return { ok: false, reason: 'invalid' }
          projection.topic = item.value
          break
        case 'message':
          if (projection.messages[item.value.messageId]) return { ok: false, reason: 'invalid' }
          projection.messages[item.value.messageId] = item.value
          break
        case 'part': {
          if (projection.parts[item.value.partId] || !projection.messages[item.messageId])
            return { ok: false, reason: 'invalid' }
          let part = item.value
          if (
            (part.kind === 'text' || part.kind === 'reasoning' || part.kind === 'tool-input') &&
            part.state === 'streaming' &&
            'ref' in part.content
          ) {
            const ref = part.content.ref
            const bytes = content[`${ref.contentId}:${ref.revision}`]
            if (!bytes || String(bytes.length) !== ref.byteLength || integrity.sha256(bytes) !== ref.sha256)
              return { ok: false, reason: 'content' }
            try {
              part = {
                ...part,
                content: { text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
              }
            } catch {
              return { ok: false, reason: 'content' }
            }
          }
          projection.parts[item.value.partId] = part
          if (!projection.messages[item.messageId].partIds.includes(item.value.partId)) {
            const message = projection.messages[item.messageId]
            projection.messages[item.messageId] = { ...message, partIds: [...message.partIds, item.value.partId] }
          }
          break
        }
        case 'execution':
          projection.executions[item.value.executionId] = item.value
          break
        case 'interaction':
          projection.interactions[item.value.interactionId] = item.value
          break
      }
    }
  }
  if (
    !projection.topic ||
    Object.values(projection.messages).some(
      (message) =>
        message.partIds.some((id) => !projection.parts[id]) ||
        (message.partCount !== undefined && message.partCount !== message.partIds.length)
    )
  )
    return { ok: false, reason: 'incomplete' }
  const total = chunks.reduce((bytes, chunk) => bytes + chunk.length, 0)
  const all = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    all.set(chunk, offset)
    offset += chunk.length
  }
  if (String(total) !== descriptor.byteLength || integrity.sha256(all) !== descriptor.sha256)
    return { ok: false, reason: 'digest' }
  return { ok: true, projection: projection as AssistantProjection, cursor: descriptor.cursor }
}

export function applyAssistantEvents(
  previous: AssistantProjection,
  batch: AssistantBatch,
  content: Content,
  integrity: IntegrityPrimitives
): Result {
  const parsed = assistantBatchSchema.safeParse(batch)
  if (!parsed.success) return { ok: false, reason: 'invalid' }
  if (batch.topicId !== previous.cursor.topicId || batch.streamEpoch !== previous.cursor.streamEpoch)
    return { ok: false, reason: 'epoch' }
  const projection: AssistantProjection = {
    ...previous,
    messages: dictionary(previous.messages),
    parts: dictionary(previous.parts),
    executions: dictionary(previous.executions),
    interactions: dictionary(previous.interactions)
  }
  let seq = BigInt(previous.cursor.seq)
  for (const event of parsed.data.events) {
    const next = BigInt(event.seq)
    if (next <= seq) continue
    if (next !== seq + 1n) return { ok: false, reason: 'gap' }
    switch (event.kind) {
      case 'topic.updated':
        if (event.topic.topicId !== batch.topicId) return { ok: false, reason: 'epoch' }
        projection.topic = event.topic
        break
      case 'message.updated': {
        const old = projection.messages[event.message.messageId]
        if (old && BigInt(event.message.revision) <= BigInt(old.revision)) return { ok: false, reason: 'revision' }
        projection.messages[event.message.messageId] = {
          ...event.message,
          partIds: old?.partIds ?? event.message.partIds
        }
        break
      }
      case 'message.removed': {
        const message = projection.messages[event.messageId]
        if (message) for (const id of message.partIds) delete projection.parts[id]
        delete projection.messages[event.messageId]
        break
      }
      case 'part.updated': {
        const message = projection.messages[event.messageId]
        if (!message) return { ok: false, reason: 'revision' }
        if (
          Object.values(projection.messages).some(
            (message) => message.messageId !== event.messageId && message.partIds.includes(event.part.partId)
          )
        )
          return { ok: false, reason: 'revision' }
        const partIds = message.partIds.filter((id) => id !== event.part.partId)
        const position = event.afterPartId === null ? 0 : partIds.indexOf(event.afterPartId) + 1
        if (event.afterPartId !== null && position === 0) return { ok: false, reason: 'revision' }
        partIds.splice(position, 0, event.part.partId)
        projection.messages[event.messageId] = { ...message, partIds }
        projection.parts[event.part.partId] = event.part
        break
      }
      case 'part.removed': {
        const message = projection.messages[event.messageId]
        if (!message || !message.partIds.includes(event.partId)) return { ok: false, reason: 'revision' }
        projection.messages[event.messageId] = {
          ...message,
          partIds: message.partIds.filter((id) => id !== event.partId)
        }
        delete projection.parts[event.partId]
        break
      }
      case 'part.append': {
        const part = projection.parts[event.partId]
        if (
          !part ||
          (part.kind !== 'text' && part.kind !== 'reasoning') ||
          !projection.messages[event.messageId]?.partIds.includes(event.partId) ||
          part.revision !== event.baseRevision ||
          BigInt(event.revision) <= BigInt(part.revision)
        )
          return { ok: false, reason: 'revision' }
        let text: string
        if ('text' in part.content) text = part.content.text
        else {
          const ref = part.content.ref
          const bytes = content[`${ref.contentId}:${ref.revision}`]
          if (!bytes || String(bytes.length) !== ref.byteLength || integrity.sha256(bytes) !== ref.sha256)
            return { ok: false, reason: 'content' }
          try {
            text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
          } catch {
            return { ok: false, reason: 'content' }
          }
        }
        if (String(textByteLength(part, text)) !== event.offsetUtf8) return { ok: false, reason: 'revision' }
        projection.parts[event.partId] = { ...part, revision: event.revision, content: { text: text + event.text } }
        break
      }
      case 'execution.updated':
        projection.executions[event.execution.executionId] = event.execution
        break
      case 'interaction.updated':
        projection.interactions[event.interaction.interactionId] = event.interaction
        break
    }
    seq = next
  }
  projection.cursor = { ...previous.cursor, seq: String(seq) }
  return { ok: true, projection, cursor: projection.cursor }
}
