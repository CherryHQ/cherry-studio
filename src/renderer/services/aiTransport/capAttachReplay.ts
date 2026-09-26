import type { UIMessageChunk } from 'ai'

import type { StreamChunkPayload } from '@shared/ai/transport'

export const MAX_ATTACH_REPLAY_CHUNKS = 1000

// Renderer-only, count-bounded attach-replay cap. Main owns byte-bounded
// buildCompactReplay (ring buffer + delta merge/synthesis); this helper only
// bounds synchronous replay work during attach before the live stream handoff.

// Pre-attach live chunks main already sent to a stale/parallel listener for
// this window are also inside the attach snapshot; drop the covered ones.
export function dropCoveredOverflow(
  replay: readonly StreamChunkPayload[],
  overflow: readonly StreamChunkPayload[],
  droppedSeqs: readonly number[] = []
): StreamChunkPayload[] {
  let watermark = -1
  for (const payload of replay) {
    if (payload.seq !== undefined && payload.seq > watermark) watermark = payload.seq
  }
  const dropped = droppedSeqs.length > 0 ? new Set(droppedSeqs) : undefined
  if (watermark < 0 && !dropped) return [...overflow]
  return overflow.filter((payload) => {
    if (payload.seq === undefined) return true
    // Repair-dropped chunks stay dropped even above the watermark.
    if (dropped?.has(payload.seq)) return false
    return payload.seq > watermark
  })
}

function scopedPartKey(payload: StreamChunkPayload, kind: 'text' | 'reasoning' | 'tool-input', id: string): string {
  return JSON.stringify([payload.executionId ?? null, payload.anchorMessageId ?? null, `${kind}:${id}`])
}

function buildTail(chunks: readonly StreamChunkPayload[], max: number): StreamChunkPayload[] {
  if (max <= 0) return []
  if (chunks.length <= max) return [...chunks]

  const indicesByScope = new Map<string, number[]>()
  chunks.forEach((p, i) => {
    const k = JSON.stringify([p.executionId ?? null, p.anchorMessageId ?? null])
    const arr = indicesByScope.get(k)
    if (arr) arr.push(i)
    else indicesByScope.set(k, [i])
  })

  if (indicesByScope.size <= 1) return chunks.slice(-max)

  let perScope = Math.ceil(max / indicesByScope.size)
  let surplus = 0
  for (const idxs of indicesByScope.values()) {
    if (idxs.length < perScope) surplus += perScope - idxs.length
  }
  if (surplus > 0) {
    const largeScopes = [...indicesByScope.values()].filter((v) => v.length >= perScope)
    if (largeScopes.length > 0) {
      const extraPerLarge = Math.ceil(surplus / largeScopes.length)
      perScope += extraPerLarge
    }
  }

  const keepByScope = new Map<string, number[]>()
  for (const [scope, idxs] of indicesByScope) {
    const take = Math.min(idxs.length, perScope)
    keepByScope.set(scope, idxs.slice(-take))
  }

  const totalKept = [...keepByScope.values()].reduce((sum, arr) => sum + arr.length, 0)
  if (totalKept > max) {
    let excess = totalKept - max
    // Trim oldest entries from the largest scopes first so small scopes keep their allocation.
    const sortedScopes = [...keepByScope.entries()].sort((a, b) => b[1].length - a[1].length)
    for (const [, arr] of sortedScopes) {
      if (excess <= 0) break
      const drop = Math.min(excess, arr.length)
      arr.splice(0, drop)
      excess -= drop
    }
  }

  const keep = new Set<number>()
  for (const arr of keepByScope.values()) for (const i of arr) keep.add(i)
  return [...keep].sort((a, b) => a - b).map((i) => chunks[i])
}

export function capAttachReplayChunks(
  chunks: readonly StreamChunkPayload[],
  max: number = MAX_ATTACH_REPLAY_CHUNKS
): { replay: StreamChunkPayload[]; droppedSeqs: number[] } {
  if (chunks.length <= max) return { replay: [...chunks], droppedSeqs: [] }

  // Collect authoritative tool identity per toolCallId. Scanning the full
  // buffer (not just the retained tail) keeps the attach→live handoff from
  // losing its opener when the cap falls inside an active tool-input run: a
  // tail-starting delta can still synthesize with the real name/dynamic flag.
  const toolInfoByKey = new Map<string, { toolName: string; dynamic?: boolean }>()
  for (const payload of chunks) {
    const c = payload.chunk
    if ((c.type === 'tool-input-start' || c.type === 'tool-input-available') && c.toolName) {
      toolInfoByKey.set(scopedPartKey(payload, 'tool-input', c.toolCallId), {
        toolName: c.toolName,
        dynamic: c.dynamic
      })
    }
  }

  // A shrink-to-fit loop re-scans the full buffer per pass (quadratic attach
  // work), so shrink once by the net added and finish without synthesis.
  const tail = buildTail(chunks, max)
  const out = replayTail(tail, toolInfoByKey)
  if (out.length <= max) return withDroppedSeqs(chunks, out)

  const budget = Math.max(0, max - (out.length - tail.length))
  const tail2 = buildTail(chunks, budget)
  const out2 = replayTail(tail2, toolInfoByKey)
  if (out2.length <= max) return withDroppedSeqs(chunks, out2)

  // Boundary churn (shrinking exposed as many orphans as it removed): drop
  // orphans instead of synthesizing, so delivery stays bounded and parseable.
  return withDroppedSeqs(chunks, replayTail(tail2, toolInfoByKey, false))
}

// Seqs the cap/repair step intentionally discarded. The handoff excludes these
// from overflow: a repair-dropped tip chunk can sit above the replay watermark.
function withDroppedSeqs(
  chunks: readonly StreamChunkPayload[],
  replay: StreamChunkPayload[]
): { replay: StreamChunkPayload[]; droppedSeqs: number[] } {
  const retained = new Set(replay)
  const droppedSeqs: number[] = []
  for (const payload of chunks) {
    if (payload.seq !== undefined && !retained.has(payload)) droppedSeqs.push(payload.seq)
  }
  return { replay, droppedSeqs }
}

function replayTail(
  tail: readonly StreamChunkPayload[],
  toolInfoByKey: ReadonlyMap<string, { toolName: string; dynamic?: boolean }>,
  synthesize = true
): StreamChunkPayload[] {
  const openParts = new Set<string>()
  const seenToolInput = new Set<string>()
  const out: StreamChunkPayload[] = []

  for (const payload of tail) {
    const chunk = payload.chunk
    switch (chunk.type) {
      case 'text-start':
      case 'reasoning-start': {
        const kind = chunk.type === 'text-start' ? 'text' : 'reasoning'
        openParts.add(scopedPartKey(payload, kind, chunk.id))
        out.push(payload)
        break
      }
      case 'tool-input-start': {
        const key = scopedPartKey(payload, 'tool-input', chunk.toolCallId)
        openParts.add(key)
        seenToolInput.add(key)
        out.push(payload)
        break
      }
      case 'text-delta':
      case 'reasoning-delta': {
        const kind = chunk.type === 'text-delta' ? 'text' : 'reasoning'
        const key = scopedPartKey(payload, kind, chunk.id)
        if (!openParts.has(key)) {
          if (!synthesize) break
          openParts.add(key)
          const startChunk: UIMessageChunk =
            kind === 'text' ? { type: 'text-start', id: chunk.id } : { type: 'reasoning-start', id: chunk.id }
          out.push({ ...payload, chunk: startChunk })
        }
        out.push(payload)
        break
      }
      case 'tool-input-delta': {
        const key = scopedPartKey(payload, 'tool-input', chunk.toolCallId)
        if (!openParts.has(key)) {
          const known = toolInfoByKey.get(key)
          // No authoritative name — dropping avoids `tool-unknown` pollution
          // and the orphan delta would still be orphaned without its start.
          if (!synthesize || !known) break
          openParts.add(key)
          seenToolInput.add(key)
          const startChunk: UIMessageChunk = known.dynamic
            ? { type: 'tool-input-start', toolCallId: chunk.toolCallId, toolName: known.toolName, dynamic: true }
            : { type: 'tool-input-start', toolCallId: chunk.toolCallId, toolName: known.toolName }
          out.push({ ...payload, chunk: startChunk })
        } else {
          seenToolInput.add(key)
        }
        out.push(payload)
        break
      }
      case 'tool-input-available': {
        seenToolInput.add(scopedPartKey(payload, 'tool-input', chunk.toolCallId))
        out.push(payload)
        break
      }
      case 'text-end':
      case 'reasoning-end': {
        const kind = chunk.type === 'text-end' ? 'text' : 'reasoning'
        const key = scopedPartKey(payload, kind, chunk.id)
        if (!openParts.has(key)) break
        out.push(payload)
        openParts.delete(key)
        break
      }
      default: {
        // Legacy DeepSeek DSML `tool-input-end` (uses `id`): not in UIMessageChunk,
        // so handle it here without widening the StreamChunkPayload contract.
        const chunkType: string = chunk.type
        if (chunkType === 'tool-input-end') {
          const legacy = chunk as unknown as { toolCallId?: string; id?: string }
          const tid = legacy.toolCallId ?? legacy.id
          if (!tid) {
            out.push(payload)
            break
          }
          const key = scopedPartKey(payload, 'tool-input', tid)
          if (!openParts.has(key)) break
          out.push(payload)
          openParts.delete(key)
          break
        }
        // Orphan tool-output / approval chunks without a retained input start
        // make `readUIMessageStream` throw UIMessageStreamError and silently
        // terminate the stream, dropping all later chunks.
        if (
          chunk.type === 'tool-output-available' ||
          chunk.type === 'tool-output-error' ||
          chunk.type === 'tool-output-denied' ||
          chunk.type === 'tool-approval-request'
        ) {
          if (!seenToolInput.has(scopedPartKey(payload, 'tool-input', chunk.toolCallId))) break
        }
        out.push(payload)
        break
      }
    }
  }

  return out
}
