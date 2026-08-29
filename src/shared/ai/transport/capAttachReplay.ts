import type { StreamChunkPayload } from './stream'

export const MAX_ATTACH_REPLAY_CHUNKS = 1000

function scopedPartKey(payload: StreamChunkPayload, kind: 'text' | 'reasoning', id: string): string {
  return JSON.stringify([payload.executionId ?? null, payload.anchorMessageId ?? null, `${kind}:${id}`])
}

export function capAttachReplayChunks(
  chunks: readonly StreamChunkPayload[],
  max: number = MAX_ATTACH_REPLAY_CHUNKS
): StreamChunkPayload[] {
  if (chunks.length <= max) return [...chunks]

  const tail = chunks.slice(-max)
  const openParts = new Set<string>()
  const out: StreamChunkPayload[] = []

  for (const payload of tail) {
    const chunk = payload.chunk as { type: string; id?: string }
    switch (chunk.type) {
      case 'text-start':
      case 'reasoning-start': {
        const kind = chunk.type === 'text-start' ? 'text' : 'reasoning'
        openParts.add(scopedPartKey(payload, kind, (chunk as { id: string }).id))
        out.push(payload)
        break
      }
      case 'text-delta':
      case 'reasoning-delta': {
        const kind = chunk.type === 'text-delta' ? 'text' : 'reasoning'
        const key = scopedPartKey(payload, kind, (chunk as { id: string }).id)
        if (!openParts.has(key)) {
          openParts.add(key)
          out.push({ ...payload, chunk: { type: `${kind}-start`, id: (chunk as { id: string }).id } } as StreamChunkPayload)
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
      default:
        out.push(payload)
        break
    }
  }

  return out
}
