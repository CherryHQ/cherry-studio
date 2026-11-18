import * as z from 'zod'

import { isAgentSessionForkFailureReason } from '@shared/ai/agentSessionFork'
import { type AiStreamAdmissionReason, isAiStreamAdmissionReason } from '@shared/ai/transport'
import type { SerializedError } from '@shared/types/error'
import { SerializableSchema } from '@shared/utils/serializable'

import { IpcError } from './IpcError'

/**
 * AI domain IpcApi error codes (SCREAMING_SNAKE_CASE, `as const`, mirroring
 * `IpcErrorCode`). Both the handler (throw) and the renderer (branch) import this
 * map and reference the constant — a typo is a compile error on the side that
 * branches. Not aggregated through `errors/index.ts` (see ipc-overview.md).
 */
export const aiErrorCodes = {
  AI_AGENT_SESSION_EDIT_FAILED: 'AI_AGENT_SESSION_EDIT_FAILED',
  AI_AGENT_SESSION_FORK_FAILED: 'AI_AGENT_SESSION_FORK_FAILED',
  /**
   * A provider / AI SDK call failed. The full {@link SerializedError} (statusCode,
   * responseBody, AI SDK subtype, …) rides in `IpcError.data`, so the renderer can
   * show provider error detail — Electron's invoke reject would otherwise drop
   * everything but `message`.
   */
  AI_REQUEST_FAILED: 'AI_REQUEST_FAILED',
  /** A live-stream execution change was rejected; `data.reason` is renderer-localized. */
  AI_STREAM_ADMISSION_REJECTED: 'AI_STREAM_ADMISSION_REJECTED',
  /** A Session restore lost a race with another lifecycle command or referenced a missing row. */
  AI_AGENT_SESSION_NOT_FOUND: 'AI_AGENT_SESSION_NOT_FOUND',
  AI_AGENT_NOT_FOUND: 'AI_AGENT_NOT_FOUND',
  /** A session was requested in a user workspace that no longer exists. */
  AI_AGENT_WORKSPACE_NOT_FOUND: 'AI_AGENT_WORKSPACE_NOT_FOUND',
  /** Moving Agent Sessions to the Recycle Bin was rejected while generation is unsettled. */
  AI_AGENT_SESSION_ARCHIVE_BUSY: 'AI_AGENT_SESSION_ARCHIVE_BUSY',
  /** Direct permanent deletion of an active Agent Session was rejected because it is pinned. */
  AI_AGENT_SESSION_PINNED: 'AI_AGENT_SESSION_PINNED',
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

const serializedErrorSchema: z.ZodType<SerializedError> = z
  .object({ name: z.string().nullable(), message: z.string().nullable(), stack: z.string().nullable() })
  .catchall(SerializableSchema)

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- IPC calls reject arbitrary values; verify the fork error code and reason before exposing a failure category.
export function agentSessionForkFailureReason(e: unknown) {
  if (!(e instanceof IpcError) || e.code !== aiErrorCodes.AI_AGENT_SESSION_FORK_FAILED) return undefined
  const reason = e.data && typeof e.data === 'object' && 'reason' in e.data ? e.data.reason : undefined
  return isAgentSessionForkFailureReason(reason) ? reason : undefined
}

/**
 * Recover the serialized AI error an `ai.*` route attached to its `IpcError.data`,
 * or `undefined` when `e` is not an `AI_REQUEST_FAILED` IpcError with valid detail. Lets a renderer
 * consumer surface the rich provider error (status, body, AI SDK subtype) that a
 * plain invoke reject would have flattened to just `message`.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- The IPC error code does not validate its opaque data; decode the serialized provider detail before returning it.
export function aiErrorDetail(e: unknown): SerializedError | undefined {
  if (!(e instanceof IpcError) || e.code !== aiErrorCodes.AI_REQUEST_FAILED) return undefined
  const detail = serializedErrorSchema.safeParse(e.data)
  return detail.success ? detail.data : undefined
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- IPC calls reject arbitrary values; verify the admission error code and reason vocabulary before returning a category.
export function aiStreamAdmissionReason(e: unknown): AiStreamAdmissionReason | undefined {
  if (!(e instanceof IpcError) || e.code !== aiErrorCodes.AI_STREAM_ADMISSION_REJECTED) return undefined
  if (!e.data || typeof e.data !== 'object' || !('reason' in e.data)) return undefined
  return isAiStreamAdmissionReason(e.data.reason) ? e.data.reason : undefined
}

export function isAgentSessionNotFoundError(e: unknown): e is IpcError {
  return e instanceof IpcError && e.code === aiErrorCodes.AI_AGENT_SESSION_NOT_FOUND
}

export function isAgentNotFoundError(e: unknown): e is IpcError {
  return e instanceof IpcError && e.code === aiErrorCodes.AI_AGENT_NOT_FOUND
}

export function isAgentWorkspaceNotFoundError(e: unknown): e is IpcError {
  return e instanceof IpcError && e.code === aiErrorCodes.AI_AGENT_WORKSPACE_NOT_FOUND
}

export function isAgentSessionArchiveBusyError(e: unknown): e is IpcError {
  return e instanceof IpcError && e.code === aiErrorCodes.AI_AGENT_SESSION_ARCHIVE_BUSY
}

export function isAgentSessionPinnedError(e: unknown): e is IpcError {
  return e instanceof IpcError && e.code === aiErrorCodes.AI_AGENT_SESSION_PINNED
}
