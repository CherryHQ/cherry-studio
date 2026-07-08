import type { SerializedError } from '@shared/types/error'

import { IpcError } from './IpcError'

/**
 * AI domain IpcApi error codes (SCREAMING_SNAKE_CASE, `as const`, mirroring
 * `IpcErrorCode`). Both the handler (throw) and the renderer (branch) import this
 * map and reference the constant — a typo is a compile error on the side that
 * branches. Not aggregated through `errors/index.ts` (see ipc-overview.md).
 */
export const aiErrorCodes = {
  /**
   * A provider / AI SDK call failed. The full {@link SerializedError} (statusCode,
   * responseBody, AI SDK subtype, …) rides in `IpcError.data`, so the renderer can
   * show provider error detail — Electron's invoke reject would otherwise drop
   * everything but `message`.
   */
  AI_REQUEST_FAILED: 'AI_REQUEST_FAILED'
} as const

/**
 * Recover the serialized AI error an `ai.*` route attached to its `IpcError.data`,
 * or `undefined` when `e` is not an `AI_REQUEST_FAILED` IpcError. Lets a renderer
 * consumer surface the rich provider error (status, body, AI SDK subtype) that a
 * plain invoke reject would have flattened to just `message`.
 */
export function aiErrorDetail(e: unknown): SerializedError | undefined {
  return e instanceof IpcError && e.code === aiErrorCodes.AI_REQUEST_FAILED ? (e.data as SerializedError) : undefined
}
