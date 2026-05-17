import type { StreamChunkPayload } from '@shared/ai/transport'
import type { UIMessageChunk } from 'ai'

type PendingDelta = StreamChunkPayload & {
  chunk: Extract<UIMessageChunk, { type: 'text-delta' }> | Extract<UIMessageChunk, { type: 'reasoning-delta' }>
}

function toPendingDelta(chunk: StreamChunkPayload): PendingDelta {
  return chunk as PendingDelta
}

export function buildCompactReplay(buffer: readonly StreamChunkPayload[]): StreamChunkPayload[] {
  const compact: StreamChunkPayload[] = []
  let pending: PendingDelta | undefined

  const flushPending = () => {
    if (!pending) return
    compact.push(pending)
    pending = undefined
  }

  for (const chunk of buffer) {
    switch (chunk.chunk.type) {
      case 'text-delta': {
        if (
          pending?.chunk.type === 'text-delta' &&
          pending.chunk.id === chunk.chunk.id &&
          pending.executionId === chunk.executionId
        ) {
          pending = {
            ...pending,
            chunk: {
              ...pending.chunk,
              delta: pending.chunk.delta + chunk.chunk.delta,
              providerMetadata: chunk.chunk.providerMetadata ?? pending.chunk.providerMetadata
            }
          }
        } else {
          flushPending()
          pending = toPendingDelta(chunk)
        }
        break
      }

      case 'reasoning-delta': {
        if (
          pending?.chunk.type === 'reasoning-delta' &&
          pending.chunk.id === chunk.chunk.id &&
          pending.executionId === chunk.executionId
        ) {
          pending = {
            ...pending,
            chunk: {
              ...pending.chunk,
              delta: pending.chunk.delta + chunk.chunk.delta,
              providerMetadata: chunk.chunk.providerMetadata ?? pending.chunk.providerMetadata
            }
          }
        } else {
          flushPending()
          pending = toPendingDelta(chunk)
        }
        break
      }

      case 'tool-input-start':
      case 'tool-input-delta':
        flushPending()
        break

      default:
        flushPending()
        compact.push(chunk)
        break
    }
  }

  flushPending()

  return compact
}
