import type { ActiveStream } from '../types'

/**
 * Strategy that owns every chat-vs-ad-hoc differential behaviour around an
 * `ActiveStream`'s life cycle. `AiStreamManager` calls these hooks at fixed
 * points; the manager itself stays policy-free (no `if (ephemeral)`).
 *
 * The two implementations today are `chatStreamLifecycle` (cross-window
 * status broadcast + 30 s grace-period reconnect) and
 * `promptStreamLifecycle` (silent, no attach, immediate eviction).
 *
 * Hooks are synchronous: the manager invokes them on its own loop and does
 * not await side effects. Async work is the implementation's problem.
 */
export interface StreamLifecycle {
  /** Stable name for logging / diagnostics. */
  readonly name: string

  /** Called from `send()` right after a fresh `ActiveStream` is registered. */
  onCreated(stream: ActiveStream): void

  /** Called from `onChunk` the first time the stream transitions `pending → streaming`. */
  onPromotedToStreaming(stream: ActiveStream): void

  /**
   * Called from each `onExecution{Done,Paused,Error}` handler once
   * `isTopicDone` flips. Implementations read `stream.status` to react to
   * the final topic-level status.
   */
  onTerminal(stream: ActiveStream): void

  /** Gate for `AiStreamManager.attach`. Returning false short-circuits to `'not-found'`. */
  canAttach(stream: ActiveStream): boolean

  /**
   * Run after `onTerminal`. The implementation chooses when to remove the
   * stream from `activeStreams` by invoking `evict`. Chat defers via
   * `setTimeout`; prompt streams call `evict()` immediately.
   */
  cleanup(stream: ActiveStream, evict: () => void): void
}
