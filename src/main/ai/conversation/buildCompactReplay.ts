import { conversationRefKey } from '@shared/ai/conversation'
import type { StreamChunkPayload } from '@shared/ai/transport'

function utf8CodePointBytes(codePoint: number): number {
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}

function utf8ByteLength(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index)!
    bytes += utf8CodePointBytes(codePoint)
    index += codePoint > 0xffff ? 2 : 1
  }
  return bytes
}

const deltaUtf8ByteLengths = new WeakMap<StreamChunkPayload, number>()

function cachedDeltaUtf8ByteLength(payload: StreamChunkPayload, value: string): number {
  const cached = deltaUtf8ByteLengths.get(payload)
  if (cached !== undefined) return cached
  const bytes = utf8ByteLength(value)
  deltaUtf8ByteLengths.set(payload, bytes)
  return bytes
}

interface Utf8Segment {
  readonly value: string
  readonly byteLength: number
}

function splitUtf8(value: string, maxBytes: number): Utf8Segment[] {
  if (!value) return [{ value, byteLength: 0 }]
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return [{ value, byteLength: utf8ByteLength(value) }]

  const segments: Utf8Segment[] = []
  let segmentStart = 0
  let segmentBytes = 0

  for (let index = 0; index < value.length; ) {
    const codePoint = value.codePointAt(index)!
    const codeUnits = codePoint > 0xffff ? 2 : 1
    const codePointBytes = utf8CodePointBytes(codePoint)

    if (segmentBytes > 0 && segmentBytes + codePointBytes > maxBytes) {
      segments.push({ value: value.slice(segmentStart, index), byteLength: segmentBytes })
      segmentStart = index
      segmentBytes = 0
    }

    segmentBytes += codePointBytes
    index += codeUnits
  }

  segments.push({ value: value.slice(segmentStart), byteLength: segmentBytes })
  return segments
}

function sameReplayScope(left: StreamChunkPayload, right: StreamChunkPayload): boolean {
  return (
    conversationRefKey(left.conversation) === conversationRefKey(right.conversation) &&
    left.turnId === right.turnId &&
    left.executionId === right.executionId &&
    left.outputNodeId === right.outputNodeId
  )
}

export function splitDeltaPayload(payload: StreamChunkPayload, maxDeltaBytes: number): StreamChunkPayload[] {
  const chunk = payload.chunk
  if (chunk.type !== 'text-delta' && chunk.type !== 'reasoning-delta' && chunk.type !== 'tool-input-delta') {
    return [payload]
  }
  const value = chunk.type === 'tool-input-delta' ? chunk.inputTextDelta : chunk.delta
  const segments = splitUtf8(value, maxDeltaBytes)
  if (segments.length === 1) {
    deltaUtf8ByteLengths.set(payload, segments[0].byteLength)
    return [payload]
  }

  return segments.map((segment) => {
    const segmentPayload: StreamChunkPayload =
      chunk.type === 'tool-input-delta'
        ? { ...payload, chunk: { ...chunk, inputTextDelta: segment.value } }
        : { ...payload, chunk: { ...chunk, delta: segment.value } }
    deltaUtf8ByteLengths.set(segmentPayload, segment.byteLength)
    return segmentPayload
  })
}

export function mergeDeltaPayload(
  tail: StreamChunkPayload,
  incoming: StreamChunkPayload,
  maxDeltaBytes?: number
): StreamChunkPayload | undefined {
  if (!sameReplayScope(tail, incoming)) return undefined
  const previous = tail.chunk
  const next = incoming.chunk

  if (
    (previous.type === 'text-delta' && next.type === 'text-delta' && previous.id === next.id) ||
    (previous.type === 'reasoning-delta' && next.type === 'reasoning-delta' && previous.id === next.id)
  ) {
    let mergedByteLength: number | undefined
    if (maxDeltaBytes !== undefined) {
      mergedByteLength =
        cachedDeltaUtf8ByteLength(tail, previous.delta) + cachedDeltaUtf8ByteLength(incoming, next.delta)
      if (mergedByteLength > maxDeltaBytes) return undefined
    }
    const merged: StreamChunkPayload = {
      ...tail,
      throughChunkSeq: incoming.throughChunkSeq ?? incoming.chunkSeq,
      chunk: {
        ...previous,
        delta: previous.delta + next.delta,
        providerMetadata: next.providerMetadata ?? previous.providerMetadata
      }
    }
    if (mergedByteLength !== undefined) deltaUtf8ByteLengths.set(merged, mergedByteLength)
    return merged
  }

  if (
    previous.type === 'tool-input-delta' &&
    next.type === 'tool-input-delta' &&
    previous.toolCallId === next.toolCallId
  ) {
    let mergedByteLength: number | undefined
    if (maxDeltaBytes !== undefined) {
      mergedByteLength =
        cachedDeltaUtf8ByteLength(tail, previous.inputTextDelta) +
        cachedDeltaUtf8ByteLength(incoming, next.inputTextDelta)
      if (mergedByteLength > maxDeltaBytes) return undefined
    }
    const merged: StreamChunkPayload = {
      ...tail,
      throughChunkSeq: incoming.throughChunkSeq ?? incoming.chunkSeq,
      chunk: { ...previous, inputTextDelta: previous.inputTextDelta + next.inputTextDelta }
    }
    if (mergedByteLength !== undefined) deltaUtf8ByteLengths.set(merged, mergedByteLength)
    return merged
  }
  return undefined
}

export function buildCompactReplay(
  buffer: readonly StreamChunkPayload[],
  maxDeltaBytes?: number
): StreamChunkPayload[] {
  const compact: StreamChunkPayload[] = []
  let pending: StreamChunkPayload | undefined
  const openParts = new Set<string>()
  const openToolInputs = new Set<string>()

  const scopedKey = (payload: StreamChunkPayload, id: string): string =>
    JSON.stringify([
      conversationRefKey(payload.conversation),
      payload.turnId,
      payload.executionId,
      payload.outputNodeId,
      id
    ])
  const openPartKey = (payload: StreamChunkPayload, kind: 'text' | 'reasoning', id: string): string =>
    scopedKey(payload, `${kind}:${id}`)
  const flushPending = () => {
    if (!pending) return
    compact.push(pending)
    pending = undefined
  }

  for (const payload of buffer) {
    if (pending) {
      const merged = mergeDeltaPayload(pending, payload, maxDeltaBytes)
      if (merged) {
        pending = merged
        continue
      }
    }

    const chunk = payload.chunk
    switch (chunk.type) {
      case 'text-start':
      case 'reasoning-start': {
        flushPending()
        openParts.add(openPartKey(payload, chunk.type === 'text-start' ? 'text' : 'reasoning', chunk.id))
        compact.push(payload)
        break
      }
      case 'text-delta':
      case 'reasoning-delta': {
        flushPending()
        const kind = chunk.type === 'text-delta' ? ('text' as const) : ('reasoning' as const)
        const key = openPartKey(payload, kind, chunk.id)
        if (!openParts.has(key)) {
          openParts.add(key)
          compact.push({ ...payload, chunk: { type: `${kind}-start`, id: chunk.id } })
        }
        pending = payload
        break
      }
      case 'text-end':
      case 'reasoning-end': {
        flushPending()
        if (!openParts.has(openPartKey(payload, chunk.type === 'text-end' ? 'text' : 'reasoning', chunk.id))) break
        compact.push(payload)
        break
      }
      case 'tool-input-start':
        flushPending()
        openToolInputs.add(scopedKey(payload, `tool:${chunk.toolCallId}`))
        compact.push(payload)
        break
      case 'tool-input-delta': {
        flushPending()
        if (!openToolInputs.has(scopedKey(payload, `tool:${chunk.toolCallId}`))) break
        pending = payload
        break
      }
      case 'tool-input-available':
        flushPending()
        openToolInputs.delete(scopedKey(payload, `tool:${chunk.toolCallId}`))
        compact.push(payload)
        break
      default:
        flushPending()
        compact.push(payload)
        break
    }
  }

  flushPending()
  return compact
}
