import type { ActiveStream } from '../types'

/**
 * Strategy hooks called at fixed points by `AiStreamManager`; the
 * manager itself has no `if (ephemeral)` branches. Implementations:
 * `chatStreamLifecycle` (cross-window broadcast + 30 s grace period)
 * and `promptStreamLifecycle` (silent, no attach, immediate evict).
 * Hooks are synchronous — async work is the implementation's problem.
 */
export interface StreamLifecycle {
  readonly name: string

  onCreated(stream: ActiveStream): void
  /** Called once on the first `pending → streaming` transition. */
  onPromotedToStreaming(stream: ActiveStream): void
  /** Called once when `isTopicDone` flips; read `stream.status` for the final status. */
  onTerminal(stream: ActiveStream): void
  /** Returning false short-circuits `attach` to `'not-found'`. */
  canAttach(stream: ActiveStream): boolean
  /** Invoke `evict()` to remove from `activeStreams`. Chat defers via setTimeout; prompt evicts immediately. */
  cleanup(stream: ActiveStream, evict: () => void): void
}
