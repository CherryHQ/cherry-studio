import type { StreamChunkPayload } from '@shared/ai/transport'

/**
 * Minimal identity of a part-creating tool chunk (`tool-input-start` /
 * `tool-input-available`) the ring evicted while its part was still open —
 * just enough to synthesize a valid `tool-input-start` at attach time.
 * Deliberately excludes the input payload so a stash entry stays O(1)-sized.
 */
export interface EvictedToolCreator {
  toolName: string
  providerExecuted?: boolean
  dynamic?: boolean
  title?: string
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
}

/**
 * Merge `incoming` into `tail` when both are delta chunks continuing the same
 * part run (same part id / toolCallId, same executionId and anchorMessageId).
 * Returns the merged payload, or `undefined` when the two don't form a
 * contiguous run — or when merging would grow the entry past
 * `maxMergedChars`, so ingestion starts a new segment entry and the ring's
 * entry cap keeps bounding retained bytes (not just protocol units).
 *
 * Shared by `AiStreamManager.onChunk` (ingestion-time merge, so the ring
 * buffer's cap counts protocol units instead of raw deltas) and the
 * attach-time compaction below.
 */
export function mergeDeltaPayload(
  tail: StreamChunkPayload,
  incoming: StreamChunkPayload,
  maxMergedChars?: number
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
    if (maxMergedChars !== undefined && prev.delta.length + next.delta.length > maxMergedChars) return undefined
    return {
      ...tail,
      chunk: {
        ...prev,
        delta: prev.delta + next.delta,
        providerMetadata: next.providerMetadata ?? prev.providerMetadata
      }
    }
  }
  if (prev.type === 'tool-input-delta' && next.type === 'tool-input-delta' && prev.toolCallId === next.toolCallId) {
    if (maxMergedChars !== undefined && prev.inputTextDelta.length + next.inputTextDelta.length > maxMergedChars) {
      return undefined
    }
    return {
      ...tail,
      chunk: { ...prev, inputTextDelta: prev.inputTextDelta + next.inputTextDelta }
    }
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
 *    synthesize a `tool-input-start` from the stashed metadata, so the part
 *    exists for the replayed chunk AND for future live chunks of the same
 *    toolCallId (the input streamed so far is lost until the terminal DB
 *    refresh — same head-truncation degradation as text above);
 *  - remaining orphaned tool chunks: drop — nothing to synthesize from, and
 *    output/approval chunks need a part to apply to.
 */
export function buildCompactReplay(
  buffer: readonly StreamChunkPayload[],
  context?: CompactReplayContext
): StreamChunkPayload[] {
  const compact: StreamChunkPayload[] = []
  let pending: StreamChunkPayload | undefined

  const openParts = new Set<string>()
  const createdToolParts = new Set<string>()
  const startedToolInputs = new Set<string>()
  const scopedKey = (payload: StreamChunkPayload, id: string): string =>
    JSON.stringify([payload.executionId ?? null, payload.anchorMessageId ?? null, id])

  const flushPending = () => {
    if (!pending) return
    compact.push(pending)
    pending = undefined
  }

  /**
   * Rebuild an evicted creator's `tool-input-start` from the stash so the
   * orphaned chunk (and future live chunks of the same toolCallId) have a
   * part to land on. Returns false when the stash doesn't know the id.
   */
  const synthesizeEvictedStart = (payload: StreamChunkPayload, toolCallId: string): boolean => {
    const creator = context?.evictedToolCreators?.get(toolCallId)
    if (!creator) return false
    const key = scopedKey(payload, toolCallId)
    createdToolParts.add(key)
    startedToolInputs.add(key)
    compact.push({
      ...payload,
      chunk: {
        type: 'tool-input-start',
        toolCallId,
        toolName: creator.toolName,
        ...(creator.providerExecuted !== undefined && { providerExecuted: creator.providerExecuted }),
        ...(creator.dynamic !== undefined && { dynamic: creator.dynamic }),
        ...(creator.title !== undefined && { title: creator.title })
      }
    })
    return true
  }

  for (const payload of buffer) {
    if (pending) {
      const merged = mergeDeltaPayload(pending, payload)
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
        openParts.add(scopedKey(payload, `${chunk.type}:${chunk.id}`))
        compact.push(payload)
        break
      }

      case 'text-delta':
      case 'reasoning-delta': {
        flushPending()
        const startType = chunk.type === 'text-delta' ? ('text-start' as const) : ('reasoning-start' as const)
        const key = scopedKey(payload, `${startType}:${chunk.id}`)
        if (!openParts.has(key)) {
          openParts.add(key)
          compact.push({ ...payload, chunk: { type: startType, id: chunk.id } })
        }
        pending = payload
        break
      }

      case 'text-end':
      case 'reasoning-end': {
        flushPending()
        const startType = chunk.type === 'text-end' ? 'text-start' : 'reasoning-start'
        if (!openParts.has(scopedKey(payload, `${startType}:${chunk.id}`))) break
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
          !synthesizeEvictedStart(payload, chunk.toolCallId)
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
          !synthesizeEvictedStart(payload, chunk.toolCallId)
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
