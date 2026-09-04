import type { StreamChunkPayload } from './stream'

export const MAX_ATTACH_REPLAY_CHUNKS = 1000

// Renderer-side, count-bounded attach-replay cap. Main owns byte-bounded
// buildCompactReplay (ring buffer + delta merge/synthesis); this helper only
// bounds synchronous replay work during attach before the live stream handoff.

function scopedPartKey(payload: StreamChunkPayload, kind: 'text' | 'reasoning' | 'tool-input', id: string): string {
  return JSON.stringify([payload.executionId ?? null, payload.anchorMessageId ?? null, `${kind}:${id}`])
}

function toolCallIdOf(chunk: { id?: string; toolCallId?: string }): string | undefined {
  return (chunk as { toolCallId?: string }).toolCallId ?? (chunk as { id?: string }).id
}

function buildTail(chunks: readonly StreamChunkPayload[], max: number): StreamChunkPayload[] {
  if (chunks.length <= max) return [...chunks]
  const scopes = new Map<string, number>()
  for (const p of chunks) {
    const k = JSON.stringify([p.executionId ?? null, p.anchorMessageId ?? null])
    scopes.set(k, (scopes.get(k) ?? 0) + 1)
  }
  if (scopes.size <= 1) return chunks.slice(-max)

  const indicesByScope = new Map<string, number[]>()
  chunks.forEach((p, i) => {
    const k = JSON.stringify([p.executionId ?? null, p.anchorMessageId ?? null])
    const arr = indicesByScope.get(k)
    if (arr) arr.push(i)
    else indicesByScope.set(k, [i])
  })

  let perScope = Math.ceil(max / scopes.size)
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

  const keep = new Set<number>()
  for (const idxs of indicesByScope.values()) {
    const take = Math.min(idxs.length, perScope)
    for (const i of idxs.slice(-take)) keep.add(i)
  }
  const merged = [...keep].sort((a, b) => a - b).map((i) => chunks[i])
  return merged.length > max ? merged.slice(-max) : merged
}

export function capAttachReplayChunks(
  chunks: readonly StreamChunkPayload[],
  max: number = MAX_ATTACH_REPLAY_CHUNKS
): StreamChunkPayload[] {
  if (chunks.length <= max) return [...chunks]

  const tail = buildTail(chunks, max)
  const openParts = new Set<string>()
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
        if (tid) openParts.add(scopedPartKey(payload, 'tool-input', tid))
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
          openParts.add(key)
          const startChunk: Record<string, unknown> = {
            type: 'tool-input-start',
            toolCallId: tid,
            id: tid,
            toolName: (chunk as { toolName?: string }).toolName ?? 'unknown'
          }
          out.push({ ...payload, chunk: startChunk } as unknown as StreamChunkPayload)
        }
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
      default:
        out.push(payload)
        break
    }
  }

  return out
}
