import type { StreamChunkPayload } from '@shared/ai/transport'
import type { UIMessageChunk } from 'ai'

type ChunkPayload<TYPE extends UIMessageChunk['type']> = Omit<StreamChunkPayload, 'chunk'> & {
  chunk: Extract<UIMessageChunk, { type: TYPE }>
}

export type ToolCreatorPayload = ChunkPayload<'tool-input-start' | 'tool-input-available'>
export type ToolApprovalRequestPayload = ChunkPayload<'tool-approval-request'>

/**
 * Complete part-creating tool chunk the ring evicted while its part was still
 * open. `tool-input-available.input` is retained because it is the evidence a
 * user needs to decide a later approval request.
 */
export type EvictedToolCreator = ToolCreatorPayload

/** Operational state retained independently from the lossy history ring. */
export interface PendingApprovalCheckpoint {
  creator?: ToolCreatorPayload
  request: ToolApprovalRequestPayload
}

export interface CompactReplayContext {
  /**
   * toolCallIds whose parts already exist on the execution's accumulator seed
   * (the `continue-conversation` anchor message). The renderer's cold-attach
   * reader seeds from the same persisted message, so tool chunks referencing
   * them are valid without an in-ring part-creating chunk.
   */
  seedToolCallIds?: ReadonlySet<string>
  /** Evicted part creators, keyed by toolCallId. See `EvictedToolCreator`. */
  evictedToolCreators?: ReadonlyMap<string, EvictedToolCreator>
  /** Complete requests still awaiting a user decision, keyed by toolCallId. */
  pendingApprovalCheckpoints?: ReadonlyMap<string, PendingApprovalCheckpoint>
  /** Maximum UTF-8 bytes in one replayed delta chunk. */
  maxDeltaBytes?: number
}

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

/** Byte counts for immutable delta payloads; WeakMap metadata never crosses the renderer transport boundary. */
const deltaUtf8ByteLengths = new WeakMap<StreamChunkPayload, number>()

function cachedDeltaUtf8ByteLength(payload: StreamChunkPayload, value: string): number {
  const cached = deltaUtf8ByteLengths.get(payload)
  if (cached !== undefined) return cached
  const bytes = utf8ByteLength(value)
  deltaUtf8ByteLengths.set(payload, bytes)
  return bytes
}

interface Utf8Segment {
  value: string
  byteLength: number
}

/** Split without breaking Unicode code points. A configured limit below four bytes cannot split a single emoji further. */
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

/** Split a single oversized incoming delta before it enters the replay ring. */
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

/**
 * Merge `incoming` into `tail` when both are delta chunks continuing the same
 * part run (same part id / toolCallId, same executionId and anchorMessageId).
 * Returns the merged payload, or `undefined` when the two don't form a
 * contiguous run — or when merging would grow the entry past
 * `maxDeltaBytes`, so ingestion starts a new segment entry and the ring's
 * entry cap keeps bounding retained UTF-8 bytes (not just protocol units).
 *
 * The merge is lossy w.r.t. the original chunks: `providerMetadata` keeps the
 * run's last non-undefined value. That is exactly the part state AI SDK's
 * `processUIMessageStream` leaves after consuming the raw sequence
 * (`chunk.providerMetadata ?? part.providerMetadata` per delta), so a replay
 * reader can't tell the difference — but the buffer no longer holds the
 * original chunks; the authoritative copy comes from persistence via the
 * independent accumulator tee.
 *
 * Shared by `AiStreamManager.onChunk` (ingestion-time merge, so the ring
 * buffer's cap counts protocol units instead of raw deltas) and the
 * attach-time compaction below.
 */
export function mergeDeltaPayload(
  tail: StreamChunkPayload,
  incoming: StreamChunkPayload,
  maxDeltaBytes?: number
): StreamChunkPayload | undefined {
  if (tail.executionId !== incoming.executionId || tail.anchorMessageId !== incoming.anchorMessageId) {
    return undefined
  }
  const prev = tail.chunk
  const next = incoming.chunk
  if (
    (prev.type === 'text-delta' && next.type === 'text-delta' && prev.id === next.id) ||
    (prev.type === 'reasoning-delta' && next.type === 'reasoning-delta' && prev.id === next.id)
  ) {
    let mergedByteLength: number | undefined
    if (maxDeltaBytes !== undefined) {
      mergedByteLength = cachedDeltaUtf8ByteLength(tail, prev.delta) + cachedDeltaUtf8ByteLength(incoming, next.delta)
      if (mergedByteLength > maxDeltaBytes) return undefined
    }
    const merged: StreamChunkPayload = {
      ...tail,
      chunk: {
        ...prev,
        delta: prev.delta + next.delta,
        providerMetadata: next.providerMetadata ?? prev.providerMetadata
      }
    }
    if (mergedByteLength !== undefined) deltaUtf8ByteLengths.set(merged, mergedByteLength)
    return merged
  }
  if (prev.type === 'tool-input-delta' && next.type === 'tool-input-delta' && prev.toolCallId === next.toolCallId) {
    let mergedByteLength: number | undefined
    if (maxDeltaBytes !== undefined) {
      mergedByteLength =
        cachedDeltaUtf8ByteLength(tail, prev.inputTextDelta) + cachedDeltaUtf8ByteLength(incoming, next.inputTextDelta)
      if (mergedByteLength > maxDeltaBytes) return undefined
    }
    const merged: StreamChunkPayload = {
      ...tail,
      chunk: { ...prev, inputTextDelta: prev.inputTextDelta + next.inputTextDelta }
    }
    if (mergedByteLength !== undefined) deltaUtf8ByteLengths.set(merged, mergedByteLength)
    return merged
  }
  return undefined
}

/**
 * Compact an execution's buffered chunks for replay: merge contiguous delta
 * runs, and — because ring eviction can drop a part's opening chunk while
 * later chunks survive — repair the head so the replay stays consumable by AI
 * SDK's `processUIMessageStream` (which throws on a delta/end with no active
 * part, and on tool chunks whose part was never created):
 *
 *  - orphaned `text-delta` / `reasoning-delta`: synthesize the missing start
 *    (the delta carries its part id) — the run renders head-truncated but
 *    coherent, and the persisted message restores the full text on terminal;
 *  - orphaned `text-end` / `reasoning-end` (all content evicted too): drop
 *    instead of rendering an empty part;
 *  - orphaned tool chunks referencing a `context.seedToolCallIds` part: keep
 *    as-is — the attaching reader seeds from the same persisted anchor
 *    message, so the part exists without any in-ring creator (a
 *    `continue-conversation` execution's buffer legitimately opens with a
 *    bare `tool-output-*` for the approved call);
 *  - orphaned tool chunks whose creator is in `context.evictedToolCreators`:
 *    replay the complete creator, so the part exists for the replayed chunk
 *    and future live chunks of the same toolCallId;
 *  - pending approvals whose history was evicted: prepend their complete
 *    creator + request checkpoint so the user can still inspect and decide;
 *  - remaining orphaned tool chunks: drop — nothing to synthesize from, and
 *    output/approval chunks need a part to apply to.
 */
export function buildCompactReplay(
  buffer: readonly StreamChunkPayload[],
  context?: CompactReplayContext
): StreamChunkPayload[] {
  const compact: StreamChunkPayload[] = []
  let pending: StreamChunkPayload | undefined

  const bufferedApprovalIds = new Set<string>()
  for (const payload of buffer) {
    if (payload.chunk.type === 'tool-approval-request') bufferedApprovalIds.add(payload.chunk.approvalId)
  }
  const approvalPrelude: StreamChunkPayload[] = []
  for (const checkpoint of context?.pendingApprovalCheckpoints?.values() ?? []) {
    if (bufferedApprovalIds.has(checkpoint.request.chunk.approvalId)) continue
    if (checkpoint.creator) approvalPrelude.push(checkpoint.creator)
    approvalPrelude.push(checkpoint.request)
  }
  const replayBuffer = approvalPrelude.length > 0 ? [...approvalPrelude, ...buffer] : buffer

  const openParts = new Set<string>()
  const createdToolParts = new Set<string>()
  const startedToolInputs = new Set<string>()
  const scopedKey = (payload: StreamChunkPayload, id: string): string =>
    JSON.stringify([payload.executionId ?? null, payload.anchorMessageId ?? null, id])
  /** Key for a text/reasoning part in `openParts` — namespaced explicitly so the two part kinds can't collide on a shared id. */
  const openPartKey = (payload: StreamChunkPayload, kind: 'text' | 'reasoning', id: string): string =>
    scopedKey(payload, `${kind}:${id}`)

  const flushPending = () => {
    if (!pending) return
    compact.push(pending)
    pending = undefined
  }

  /**
   * Replay a complete creator from operational approval state or the evicted
   * creator stash. A tool-input delta specifically requires a start chunk;
   * terminal/approval chunks can use either creator form.
   */
  const replayEvictedCreator = (
    payload: StreamChunkPayload,
    toolCallId: string,
    requireInputStart = false
  ): boolean => {
    const creator =
      context?.pendingApprovalCheckpoints?.get(toolCallId)?.creator ?? context?.evictedToolCreators?.get(toolCallId)
    if (!creator) return false
    if (requireInputStart && creator.chunk.type !== 'tool-input-start') return false
    const key = scopedKey(payload, toolCallId)
    createdToolParts.add(key)
    if (creator.chunk.type === 'tool-input-start') startedToolInputs.add(key)
    compact.push(creator)
    return true
  }

  for (const payload of replayBuffer) {
    if (pending) {
      const merged = mergeDeltaPayload(pending, payload, context?.maxDeltaBytes)
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

      case 'tool-input-start': {
        // Preserve the part announcement — without it the renderer's chat
        // reducer cannot apply subsequent live tool-input-delta chunks for
        // this toolCallId when attach happens before tool-input-available.
        flushPending()
        const key = scopedKey(payload, chunk.toolCallId)
        createdToolParts.add(key)
        startedToolInputs.add(key)
        compact.push(payload)
        break
      }

      case 'tool-input-delta': {
        flushPending()
        // A seed part can't host a delta — the reader tracks streaming input
        // per `tool-input-start`, which a persisted part doesn't re-announce —
        // so only an evicted-creator synthesis can repair one.
        if (
          !startedToolInputs.has(scopedKey(payload, chunk.toolCallId)) &&
          !replayEvictedCreator(payload, chunk.toolCallId, true)
        ) {
          break
        }
        pending = payload
        break
      }

      case 'tool-input-available':
      case 'tool-input-error': {
        flushPending()
        createdToolParts.add(scopedKey(payload, chunk.toolCallId))
        compact.push(payload)
        break
      }

      case 'tool-approval-request':
      case 'tool-output-available':
      case 'tool-output-error':
      case 'tool-output-denied': {
        flushPending()
        if (
          !createdToolParts.has(scopedKey(payload, chunk.toolCallId)) &&
          !context?.seedToolCallIds?.has(chunk.toolCallId) &&
          !replayEvictedCreator(payload, chunk.toolCallId)
        ) {
          break
        }
        compact.push(payload)
        break
      }

      default:
        flushPending()
        compact.push(payload)
        break
    }
  }

  flushPending()

  return compact
}
