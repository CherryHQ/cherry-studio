/**
 * Error ⇄ clone-safe shape conversion. Child-safe.
 */

import type { RemoteErrorShape } from './frames'

/** Flattens any thrown value into the clone-safe subset the wire carries. */
export function toRemoteError(error: unknown): RemoteErrorShape {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    const shape: RemoteErrorShape = { name: error.name || 'Error', message: error.message }
    if (typeof error.stack === 'string') shape.stack = error.stack
    if (typeof code === 'string' || typeof code === 'number') shape.code = code
    return shape
  }
  return { name: 'Error', message: typeof error === 'string' ? error : safeStringify(error) }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
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
