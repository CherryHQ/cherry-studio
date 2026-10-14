/**
 * How much of the context window this request's INPUT may occupy.
 *
 * Every window-relative budget in the AI layer — the compaction triggers, the
 * in-flight tool-output cap, the attachment pool — belongs against this number
 * rather than the raw window, because the reply has to land somewhere. Slicing
 * the raw window is what let a model whose `maxOutputTokens` meets or exceeds
 * its window (83 of them in the registry) get a budget it could never spend.
 */
import { MIN_INPUT_ROOM_RATIO } from '../constants'

/**
 * `reservation` is what the request will actually declare as `max_tokens`
 * ({@link resolveOutputReservation}), NOT the model's catalogue ceiling.
 * `undefined` means the request declares none, so nothing is billed against the
 * window and the whole of it is available to the prompt — the consumer's own
 * ratio still leaves the reply its landing room.
 */
export function resolveInputRoom(contextWindow: number, reservation: number | undefined): number {
  if (reservation === undefined) return contextWindow
  // Floored: a reservation at or above the window would otherwise yield a
  // non-positive budget, which reads as "compact everything, forever".
  return Math.max(contextWindow - reservation, Math.floor(contextWindow * MIN_INPUT_ROOM_RATIO))
}
