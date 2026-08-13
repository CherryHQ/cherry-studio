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
  AI_REQUEST_FAILED: 'AI_REQUEST_FAILED',
  /**
   * An `ai.agent.task.*` command referenced a task that does not exist, is not
   * an `agent.task` schedule, or belongs to another agent (the three cases are
   * deliberately indistinguishable — no existence leak across agents).
   *
   * Minted without a renderer branch (unlike the demand-first plain Errors for
   * agent/channel guards): the handler detects the miss as a `null`/`false`
   * return and must synthesize an IpcError from scratch — labelling a
   * well-defined, client-addressable miss `INTERNAL` would be wrong transport
   * semantics. A future consumer (e.g. "task deleted elsewhere → drop it from
   * the list") can branch on it without a protocol change.
   */
  AI_AGENT_TASK_NOT_FOUND: 'AI_AGENT_TASK_NOT_FOUND',
  /**
   * The task trigger failed scheduling-semantics validation (cron expression /
   * IANA timezone parse, interval or once delay out of timer range) — a user
   * input error the renderer maps to a form hint. Translated from the internal
   * `JOB_SCHEDULE_TRIGGER_INVALID` by the `ai.agent.task.create/update`
   * handlers so the renderer keeps a branchable code instead of `INTERNAL`.
   */
  AI_AGENT_TASK_TRIGGER_INVALID: 'AI_AGENT_TASK_TRIGGER_INVALID'
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
