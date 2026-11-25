/**
 * Error ⇄ clone-safe shape conversion. Child-safe.
 */

import type { RemoteErrorShape } from './frames'

/** Flattens any thrown value into the clone-safe subset the wire carries. */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Handler rejections and uncaught child failures can be any value; extract only clone-safe error fields under a serialization guard.
export function toRemoteError(error: unknown): RemoteErrorShape {
  try {
    if (error instanceof Error) {
      // oxlint-disable-next-line anti-slop/no-reflect-get -- Error codes may be virtual Proxy fields; the serialization guard contains unreadable properties and checks the primitive result below.
      const code = Reflect.get(error, 'code')

      const shape: RemoteErrorShape = { name: String(error.name || 'Error'), message: String(error.message) }

      if (typeof error.stack === 'string') shape.stack = error.stack

      if (typeof code === 'string' || typeof code === 'number') shape.code = code

      return shape
    }

    return { name: 'Error', message: typeof error === 'string' ? error : safeStringify(error) }
  } catch {
    // Throwing getters and null prototypes are rare, but this also runs inside the child's
    // uncaughtException handler, where a throw would skip the abort-and-exit sequence entirely.
    return { name: 'Error', message: 'error could not be serialized' }
  }
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Non-Error rejection values need diagnostic text; toRemoteError also catches failures from the final String fallback.
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Rebuilds a plain Error from a remote shape; custom prototypes are deliberately not reconstructed. */
export function fromRemoteError(remote: RemoteErrorShape): Error & { code?: string | number } {
  return Object.assign(new Error(remote.message), {
    name: remote.name,
    ...(remote.stack !== undefined && { stack: remote.stack }),
    ...(remote.code !== undefined && { code: remote.code })
  })
}
