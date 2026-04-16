import type { UIMessageChunk } from 'ai'

type PendingDelta =
  | Extract<UIMessageChunk, { type: 'text-delta' }>
  | Extract<UIMessageChunk, { type: 'reasoning-delta' }>

export function buildCompactReplay(buffer: readonly UIMessageChunk[]): UIMessageChunk[] {
  const compact: UIMessageChunk[] = []
  let pending: PendingDelta | undefined

  const flushPending = () => {
    if (!pending) return
    compact.push(pending)
    pending = undefined
  }

  for (const chunk of buffer) {
    switch (chunk.type) {
      case 'text-delta': {
        if (pending?.type === 'text-delta' && pending.id === chunk.id) {
          pending = {
            ...pending,
            delta: pending.delta + chunk.delta,
            providerMetadata: chunk.providerMetadata ?? pending.providerMetadata
          }
        } else {
          flushPending()
          pending = { ...chunk }
        }
        break
      }

      case 'reasoning-delta': {
        if (pending?.type === 'reasoning-delta' && pending.id === chunk.id) {
          pending = {
            ...pending,
            delta: pending.delta + chunk.delta,
            providerMetadata: chunk.providerMetadata ?? pending.providerMetadata
          }
        } else {
          flushPending()
          pending = { ...chunk }
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
