import type { StreamChunkPayload } from './stream'

export const MAX_ATTACH_REPLAY_CHUNKS = 1000

// Renderer-only, count-bounded attach-replay cap. Main owns byte-bounded
// buildCompactReplay (ring buffer + delta merge/synthesis); this helper only
// bounds synchronous replay work during attach before the live stream handoff.
// Lives in `shared/ai/transport` alongside the stream types so both renderer
// call sites (IpcChatTransport, TopicStreamSubscription) share one cap path;
// it is not used from Main.

function scopedPartKey(payload: StreamChunkPayload, kind: 'text' | 'reasoning' | 'tool-input', id: string): string {
  return JSON.stringify([payload.executionId ?? null, payload.anchorMessageId ?? null, `${kind}:${id}`])
}

function toolCallIdOf(chunk: { id?: string; toolCallId?: string }): string | undefined {
  return (chunk as { toolCallId?: string }).toolCallId ?? (chunk as { id?: string }).id
}

function buildTail(chunks: readonly StreamChunkPayload[], max: number): StreamChunkPayload[] {
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
): StreamChunkPayload[] {
  if (chunks.length <= max) return [...chunks]

  const tail = buildTail(chunks, max)

  // Collect authoritative tool identity per toolCallId. Scanning the full
  // buffer (not just the retained tail) keeps the attach→live handoff from
  // losing its opener when the cap falls inside an active tool-input run: a
  // tail-starting delta can still synthesize with the real name/dynamic flag.
  const toolInfoByKey = new Map<string, { toolName: string; dynamic?: boolean }>()
  for (const payload of chunks) {
    const c = payload.chunk as { type: string; toolCallId?: string; id?: string; toolName?: string; dynamic?: boolean }
    if ((c.type === 'tool-input-start' || c.type === 'tool-input-available') && c.toolName) {
      const tid = toolCallIdOf(c)
      if (tid)
        toolInfoByKey.set(scopedPartKey(payload, 'tool-input', tid), { toolName: c.toolName, dynamic: c.dynamic })
    }
  }

  const openParts = new Set<string>()
  const seenToolInput = new Set<string>()
  const out: StreamChunkPayload[] = []

  for (const payload of tail) {
    const chunk = payload.chunk as { type: string; id?: string; toolCallId?: string; toolName?: string }
    switch (chunk.type) {
      case 'text-start':
      case 'reasoning-start': {
        const kind = chunk.type === 'text-start' ? 'text' : 'reasoning'
        openParts.add(scopedPartKey(payload, kind, (chunk as { id: string }).id))
        out.push(payload)
        break
      }
      case 'tool-input-start': {
        const tid = toolCallIdOf(chunk as { id?: string; toolCallId?: string })
        if (tid) {
          const key = scopedPartKey(payload, 'tool-input', tid)
          openParts.add(key)
          seenToolInput.add(key)
        }
        out.push(payload)
        break
      }
      case 'text-delta':
      case 'reasoning-delta': {
        const kind = chunk.type === 'text-delta' ? 'text' : 'reasoning'
        const key = scopedPartKey(payload, kind, (chunk as { id: string }).id)
        if (!openParts.has(key)) {
          openParts.add(key)
          out.push({
            ...payload,
            chunk: { type: `${kind}-start`, id: (chunk as { id: string }).id }
          } as StreamChunkPayload)
        }
        out.push(payload)
        break
      }
      case 'tool-input-delta': {
        const tid = toolCallIdOf(chunk as { id?: string; toolCallId?: string })
        if (!tid) {
          out.push(payload)
          break
        }
        const key = scopedPartKey(payload, 'tool-input', tid)
        if (!openParts.has(key)) {
          const known = toolInfoByKey.get(key)
          // No authoritative name — dropping avoids `tool-unknown` pollution
          // and the orphan delta would still be orphaned without its start.
          if (!known) break
          openParts.add(key)
          seenToolInput.add(key)
          const startChunk: Record<string, unknown> = {
            type: 'tool-input-start',
            toolCallId: tid,
            id: tid,
            toolName: known.toolName,
            ...(known.dynamic ? { dynamic: true } : {})
          }
          out.push({ ...payload, chunk: startChunk } as unknown as StreamChunkPayload)
        } else {
          seenToolInput.add(key)
        }
        out.push(payload)
        break
      }
      case 'tool-input-available': {
        const tid = toolCallIdOf(chunk as { id?: string; toolCallId?: string })
        if (tid) seenToolInput.add(scopedPartKey(payload, 'tool-input', tid))
        out.push(payload)
        break
      }
      case 'text-end':
      case 'reasoning-end': {
        const kind = chunk.type === 'text-end' ? 'text' : 'reasoning'
        const key = scopedPartKey(payload, kind, (chunk as { id: string }).id)
        if (!openParts.has(key)) break
        out.push(payload)
        openParts.delete(key)
        break
      }
      case 'tool-input-end': {
        const tid = toolCallIdOf(chunk as { id?: string; toolCallId?: string })
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
      default: {
        // Orphan tool-output / approval chunks without a retained input start
        // make `readUIMessageStream` throw UIMessageStreamError and silently
        // terminate the stream, dropping all later chunks.
        const t = chunk.type
        if (
          t === 'tool-output-available' ||
          t === 'tool-output-error' ||
          t === 'tool-output-denied' ||
          t === 'tool-approval-request'
        ) {
          const tid = toolCallIdOf(chunk as { id?: string; toolCallId?: string })
          if (tid) {
            const key = scopedPartKey(payload, 'tool-input', tid)
            if (!seenToolInput.has(key) && !openParts.has(key) && !toolInfoByKey.has(key)) break
          }
        }
        out.push(payload)
        break
      }
    }
  }

  return out
}
