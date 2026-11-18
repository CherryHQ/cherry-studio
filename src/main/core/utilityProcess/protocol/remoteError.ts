/**
 * Error ⇄ clone-safe shape conversion. Child-safe.
 */

import type { RemoteErrorShape } from './frames'

/** Flattens any thrown value into the clone-safe subset the wire carries. */
export function toRemoteError(cause: unknown): RemoteErrorShape {
  try {
    if (cause instanceof Error) {
      const code = (cause as { code?: unknown }).code
      const shape: RemoteErrorShape = { name: String(cause.name || 'Error'), message: String(cause.message) }
      if (typeof cause.stack === 'string') shape.stack = cause.stack
      if (typeof code === 'string' || typeof code === 'number') shape.code = code
      return shape
    }
    return { name: 'Error', message: typeof cause === 'string' ? cause : safeStringify(cause) }
  } catch {
    // Throwing getters and null prototypes are rare, but this also runs inside the child's
    // uncaughtException handler, where a throw would skip the abort-and-exit sequence entirely.
    return { name: 'Error', message: 'error could not be serialized' }
  }
}

function safeStringify(cause: unknown): string {
  try {
    return JSON.stringify(cause) ?? String(cause)
  } catch {
    return String(cause)
  }
}

/** Rebuilds a plain Error from a remote shape; custom prototypes are deliberately not reconstructed. */
export function fromRemoteError(remote: RemoteErrorShape): Error & { code?: string | number } {
  const error = new Error(remote.message) as Error & { code?: string | number }
  error.name = remote.name
  if (remote.stack !== undefined) error.stack = remote.stack
  if (remote.code !== undefined) error.code = remote.code
  return error
}
