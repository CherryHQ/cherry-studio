import type { StreamChunkPayload } from '@shared/ai/transport'

/**
 * Merge `incoming` into `tail` when both are delta chunks continuing the same
 * part run (same part id / toolCallId, same executionId and anchorMessageId).
 * Returns the merged payload, or `undefined` when the two don't form a
 * contiguous run.
 *
 * Shared by `AiStreamManager.onChunk` (ingestion-time merge, so the ring
 * buffer's cap counts protocol units instead of raw deltas) and the
 * attach-time compaction below.
 */
export function mergeDeltaPayload(
  tail: StreamChunkPayload,
  incoming: StreamChunkPayload
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
 *  - orphaned tool chunks: drop — a `tool-input-delta` carries no toolName so
 *    its start cannot be synthesized, and output/approval chunks need a
 *    surviving part-creating chunk (`tool-input-start` / `-available` /
 *    `-error`) to apply to.
 */
export function buildCompactReplay(buffer: readonly StreamChunkPayload[]): StreamChunkPayload[] {
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
        if (!startedToolInputs.has(scopedKey(payload, chunk.toolCallId))) break
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
        if (!createdToolParts.has(scopedKey(payload, chunk.toolCallId))) break
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
