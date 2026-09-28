import { encodeCanonical } from '../encoding'
import type { IntegrityPrimitives } from '../values'
import {
  agentCheckpointDescriptorSchema,
  agentCheckpointPageSchema,
  encodeAgentCheckpointPage,
  type AgentCheckpointDescriptor,
  type AgentCheckpointPage
} from './checkpoints'
import { agentEventBatchSchema, type AgentEvent, type AgentEventBatch, type AgentProjection } from './events'
import type { AgentCursor, AgentPart, ContentRef } from './resources'

export type MaterializedContent = Readonly<Record<string, Uint8Array>>
type RecoveryReason = 'gap' | 'epoch' | 'revision' | 'content'
export type ApplyAgentEventsResult =
  | { ok: true; projection: AgentProjection; cursor: AgentCursor }
  | { ok: false; reason: RecoveryReason }
export type InstallAgentCheckpointResult =
  | { ok: true; projection: AgentProjection; cursor: AgentCursor }
  | { ok: false; reason: 'incomplete' | 'digest' | 'invalid' }

function validRevision(current: string, base: string, next: string): boolean {
  return current === base && BigInt(next) > BigInt(base)
}

function contentBytes(
  ref: ContentRef,
  content: MaterializedContent,
  integrity: IntegrityPrimitives
): Uint8Array | undefined {
  const bytes = content[`${ref.contentId}:${ref.revision}`]
  return bytes && BigInt(bytes.length) === BigInt(ref.byteLength) && integrity.sha256(bytes) === ref.sha256
    ? bytes
    : undefined
}

function textOf(part: AgentPart, content: MaterializedContent, integrity: IntegrityPrimitives): string | undefined {
  if (part.kind !== 'text' && part.kind !== 'reasoning' && part.kind !== 'tool-input') return undefined
  if ('text' in part.content) return part.content.text
  const bytes = contentBytes(part.content.ref, content, integrity)
  if (!bytes) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

function dictionary<T>(values: Readonly<Record<string, T>> = {}): Record<string, T> {
  return Object.assign(Object.create(null), values)
}

function materialize(
  part: AgentPart,
  content: MaterializedContent,
  integrity: IntegrityPrimitives
): AgentPart | undefined {
  if ((part.kind !== 'text' && part.kind !== 'reasoning' && part.kind !== 'tool-input') || part.state !== 'streaming')
    return part
  const text = textOf(part, content, integrity)
  return text === undefined ? undefined : { ...part, content: { text } }
}

function hasPart(projection: AgentProjection, messageId: string, partId: string): boolean {
  return Boolean(projection.messages[messageId]?.partIds.includes(partId) && projection.parts[partId])
}

function apply(
  projection: AgentProjection,
  event: AgentEvent,
  content: MaterializedContent,
  integrity: IntegrityPrimitives
): RecoveryReason | undefined {
  switch (event.kind) {
    case 'session.updated':
      if (event.payload.sessionId !== projection.cursor.sessionId) return 'epoch'
      projection.session = event.payload
      return
    case 'execution.updated':
      projection.executions[event.payload.executionId] = event.payload
      return
    case 'message.created': {
      const message = event.payload
      if (
        projection.messages[message.messageId] ||
        projection.tombstones.includes(message.messageId) ||
        message.partIds.length
      )
        return 'revision'
      projection.messages[message.messageId] = message
      return
    }
    case 'message.updated': {
      const { message, baseRevision } = event.payload
      const previous = projection.messages[message.messageId]
      if (
        !previous ||
        !validRevision(previous.revision, baseRevision, message.revision) ||
        previous.partIds.length !== message.partIds.length ||
        previous.partIds.some((id, index) => id !== message.partIds[index])
      )
        return 'revision'
      projection.messages[message.messageId] = message
      return
    }
    case 'message.removed': {
      const { messageId, baseRevision, revision } = event.payload
      const message = projection.messages[messageId]
      if (!message || !validRevision(message.revision, baseRevision, revision)) return 'revision'
      for (const partId of message.partIds) {
        delete projection.parts[partId]
        projection.tombstones.push(partId)
      }
      delete projection.messages[messageId]
      projection.tombstones.push(messageId)
      return
    }
    case 'part.created': {
      const { messageId, afterPartId, messageBaseRevision, messageRevision, part } = event.payload
      const message = projection.messages[messageId]
      if (
        !message ||
        !validRevision(message.revision, messageBaseRevision, messageRevision) ||
        projection.parts[part.partId] ||
        projection.tombstones.includes(part.partId)
      )
        return 'revision'
      const position = afterPartId === null ? 0 : message.partIds.indexOf(afterPartId) + 1
      if (afterPartId !== null && position === 0) return 'revision'
      const partIds = [...message.partIds]
      partIds.splice(position, 0, part.partId)
      projection.messages[messageId] = { ...message, revision: messageRevision, partIds }
      const materialized = materialize(part, content, integrity)
      if (!materialized) return 'content'
      projection.parts[part.partId] = materialized
      return
    }
    case 'part.append': {
      const { messageId, partId, baseRevision, revision, offsetUtf8, text } = event.payload
      if (!hasPart(projection, messageId, partId)) return 'revision'
      const part = projection.parts[partId]
      if (!validRevision(part.revision, baseRevision, revision)) return 'revision'
      if (part.kind !== 'text' && part.kind !== 'reasoning' && part.kind !== 'tool-input') return 'content'
      const previous = textOf(part, content, integrity)
      if (
        part.state !== 'streaming' ||
        previous === undefined ||
        BigInt(new TextEncoder().encode(previous).length) !== BigInt(offsetUtf8)
      )
        return 'content'
      projection.parts[partId] = { ...part, revision, content: { text: previous + text } }
      return
    }
    case 'part.replaced': {
      const { messageId, part, baseRevision } = event.payload
      if (
        !hasPart(projection, messageId, part.partId) ||
        !validRevision(projection.parts[part.partId].revision, baseRevision, part.revision)
      )
        return 'revision'
      const materialized = materialize(part, content, integrity)
      if (!materialized) return 'content'
      projection.parts[part.partId] = materialized
      return
    }
    case 'part.completed': {
      const { messageId, partId, baseRevision, revision, byteLength, sha256 } = event.payload
      if (!hasPart(projection, messageId, partId)) return 'revision'
      const part = projection.parts[partId]
      if (!validRevision(part.revision, baseRevision, revision)) return 'revision'
      if (part.kind !== 'text' && part.kind !== 'reasoning' && part.kind !== 'tool-input') return 'content'
      const text = textOf(part, content, integrity)
      if (text === undefined || part.state !== 'streaming') return 'content'
      const bytes = new TextEncoder().encode(text)
      if (BigInt(bytes.length) !== BigInt(byteLength) || integrity.sha256(bytes) !== sha256) return 'content'
      projection.parts[partId] = { ...part, revision, content: { text }, state: 'completed' }
      return
    }
    case 'part.removed': {
      const { messageId, partId, baseRevision, revision, messageBaseRevision, messageRevision } = event.payload
      if (!hasPart(projection, messageId, partId)) return 'revision'
      const message = projection.messages[messageId]
      if (
        !validRevision(message.revision, messageBaseRevision, messageRevision) ||
        !validRevision(projection.parts[partId].revision, baseRevision, revision)
      )
        return 'revision'
      projection.messages[messageId] = {
        ...message,
        revision: messageRevision,
        partIds: message.partIds.filter((id) => id !== partId)
      }
      delete projection.parts[partId]
      projection.tombstones.push(partId)
      return
    }
    case 'interaction.updated': {
      const current = projection.interactions[event.payload.interactionId]
      if (current && BigInt(event.payload.revision) <= BigInt(current.revision)) return 'revision'
      projection.interactions[event.payload.interactionId] = event.payload
      return
    }
    case 'history.committed':
      if (BigInt(event.payload.historyRevision) <= BigInt(projection.session.historyRevision)) return 'revision'
      projection.session = { ...projection.session, historyRevision: event.payload.historyRevision }
      return
  }
}

export function applyAgentEvents(
  projection: Readonly<AgentProjection>,
  input: AgentEventBatch,
  content: MaterializedContent,
  integrity: IntegrityPrimitives
): ApplyAgentEventsResult {
  const parsed = agentEventBatchSchema.safeParse(input)
  if (!parsed.success || encodeCanonical(parsed.data).length > 16_384) return { ok: false, reason: 'content' }
  const batch = parsed.data
  if (batch.sessionId !== projection.cursor.sessionId || batch.streamEpoch !== projection.cursor.streamEpoch)
    return { ok: false, reason: 'epoch' }
  const next: AgentProjection = {
    ...projection,
    cursor: { ...projection.cursor },
    messages: dictionary(projection.messages),
    parts: dictionary(projection.parts),
    executions: dictionary(projection.executions),
    interactions: dictionary(projection.interactions),
    tombstones: [...projection.tombstones]
  }
  let previous = -1n
  for (const event of batch.events) {
    const seq = BigInt(event.seq)
    if (previous >= 0n && seq !== previous + 1n) return { ok: false, reason: 'gap' }
    previous = seq
    if (seq <= BigInt(projection.cursor.seq)) continue
    if (seq !== BigInt(next.cursor.seq) + 1n) return { ok: false, reason: 'gap' }
    const reason = apply(next, event, content, integrity)
    if (reason) return { ok: false, reason }
    next.cursor.seq = event.seq
  }
  return { ok: true, projection: next, cursor: next.cursor }
}

export function installAgentCheckpoint(
  input: AgentCheckpointDescriptor,
  inputPages: readonly AgentCheckpointPage[],
  content: MaterializedContent,
  integrity: IntegrityPrimitives
): InstallAgentCheckpointResult {
  const descriptor = agentCheckpointDescriptorSchema.safeParse(input)
  if (!descriptor.success) return { ok: false, reason: 'invalid' }
  input = descriptor.data
  if (inputPages.length !== input.pageCount) return { ok: false, reason: 'incomplete' }
  const pages: AgentCheckpointPage[] = []
  const chunks: Uint8Array[] = []
  let total = 0
  for (const [index, value] of inputPages.entries()) {
    const parsed = agentCheckpointPageSchema.safeParse(value)
    if (
      !parsed.success ||
      parsed.data.checkpointId !== input.checkpointId ||
      parsed.data.pageIndex !== index ||
      (parsed.data.nextCursor === null) !== (index === input.pageCount - 1)
    )
      return { ok: false, reason: 'invalid' }
    const bytes = encodeAgentCheckpointPage(parsed.data)
    if (bytes.length > 65_536 || integrity.sha256(bytes) !== parsed.data.pageDigest)
      return { ok: false, reason: 'digest' }
    total += bytes.length
    if (total > 33_554_432) return { ok: false, reason: 'invalid' }
    chunks.push(bytes)
    pages.push(parsed.data)
  }
  const all = new Uint8Array(total)
  let offset = 0
  for (const bytes of chunks) {
    all.set(bytes, offset)
    offset += bytes.length
  }
  if (BigInt(total) !== BigInt(input.byteLength) || integrity.sha256(all) !== input.sha256)
    return { ok: false, reason: 'digest' }
  const items = pages.flatMap((page) => page.items)
  const sessions = items.filter((item) => item.kind === 'session')
  if (
    sessions.length !== 1 ||
    sessions[0].value.sessionId !== input.cursor.sessionId ||
    sessions[0].value.historyRevision !== input.historyRevision
  )
    return { ok: false, reason: 'invalid' }
  const projection: AgentProjection = {
    cursor: { ...input.cursor },
    session: sessions[0].value,
    messages: dictionary(),
    parts: dictionary(),
    executions: dictionary(),
    interactions: dictionary(),
    tombstones: []
  }
  const seen = new Set<string>()
  const owners = new Map<string, string>()
  for (const item of items) {
    if (item.kind === 'session') continue
    const id =
      item.kind === 'message'
        ? item.value.messageId
        : item.kind === 'part'
          ? item.value.partId
          : item.kind === 'execution'
            ? item.value.executionId
            : item.value.interactionId
    const key = `${item.kind}:${id}`
    if (seen.has(key)) return { ok: false, reason: 'invalid' }
    seen.add(key)
    switch (item.kind) {
      case 'message':
        projection.messages[id] = item.value
        break
      case 'execution':
        projection.executions[id] = item.value
        break
      case 'interaction':
        projection.interactions[id] = item.value
        break
      case 'part': {
        let part = item.value
        if (
          (part.kind === 'text' || part.kind === 'reasoning' || part.kind === 'tool-input') &&
          part.state === 'streaming'
        ) {
          const text = textOf(part, content, integrity)
          if (text === undefined) return { ok: false, reason: 'incomplete' }
          part = { ...part, content: { text } }
        }
        projection.parts[id] = part
        owners.set(id, item.messageId)
      }
    }
  }
  for (const message of Object.values(projection.messages)) {
    if (
      new Set(message.partIds).size !== message.partIds.length ||
      message.partIds.some((id) => !projection.parts[id] || owners.get(id) !== message.messageId)
    )
      return { ok: false, reason: 'invalid' }
  }
  for (const [partId, messageId] of owners) {
    if (!projection.messages[messageId]?.partIds.includes(partId)) return { ok: false, reason: 'invalid' }
  }
  for (const interaction of Object.values(projection.interactions)) {
    if (!projection.executions[interaction.executionId]) return { ok: false, reason: 'invalid' }
  }
  return { ok: true, projection, cursor: projection.cursor }
}
