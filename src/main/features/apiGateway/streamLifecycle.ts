import type { UIMessageChunk } from 'ai'

export const GATEWAY_STREAM_IDLE_TIMEOUT_MS = 20 * 60_000

const STARTUP_COMMIT_CHUNK_TYPES: ReadonlySet<UIMessageChunk['type']> = new Set([
  'text-start',
  'text-delta',
  'text-end',
  'reasoning-start',
  'reasoning-delta',
  'reasoning-end',
  'tool-input-available',
  'finish'
])

export function isStartupCommitChunk(chunk: UIMessageChunk): boolean {
  return STARTUP_COMMIT_CHUNK_TYPES.has(chunk.type)
}

export function streamInterruptedError(): Error & { status: number } {
  const error = new Error('Upstream idle timeout exceeded') as Error & {
    status: number
    cause?: string
  }
  error.status = 504
  error.cause = 'UPSTREAM_IDLE_TIMEOUT'
  return error
}
