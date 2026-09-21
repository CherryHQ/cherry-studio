/**
 * Agent session domain API Schema definitions.
 */

import * as z from 'zod'

import { TraceIdSchema } from '@shared/data/types/trace'

import type { CursorPaginationResponse } from '../types'
import type { OrderEndpoints } from './_endpointHelpers'
import {
  type AgentSessionWorkspaceSource,
  AgentSessionWorkspaceSourceSchema,
  AgentWorkspaceEntitySchema
} from './agentWorkspaces'

// ============================================================================
// Entity & DTOs (Rule C: derive DTOs via .pick())
// ============================================================================

/**
 * Session name validator. Empty is allowed for an untitled placeholder session,
 * and the length is capped at 255 — matching topic.name semantics
 * (`TopicNameEntitySchema`).
 */
export const SessionNameEntitySchema = z.string().max(255)

export const AgentSessionEntitySchema = z.strictObject({
  id: z.string(),
  agentId: z.string().nullable(),
  /** May be empty for an untitled placeholder session, matching topic.name semantics. */
  name: SessionNameEntitySchema,
  isNameManuallyEdited: z.boolean(),
  description: z.string().optional(),
  workspaceId: z.string(),
  workspace: AgentWorkspaceEntitySchema,
  /** Container-level OTel trace id — one trace tree per session. */
  traceId: TraceIdSchema.optional(),
  orderKey: z.string(),
  /** Last real conversation activity timestamp. */
  lastActivityAt: z.iso.datetime(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Read-only soft-delete timestamp, present only for trashed sessions. */
  deletedAt: z.string().optional()
})
export type AgentSessionEntity = z.infer<typeof AgentSessionEntitySchema>

// Create requires a real `agentId` — orphans only happen via cascade, never on insert.
export const CreateAgentSessionSchema = z.strictObject({
  agentId: z.string().min(1),
  name: SessionNameEntitySchema,
  description: z.string().optional(),
  workspace: AgentSessionWorkspaceSourceSchema
})
export type CreateAgentSessionDto = z.infer<typeof CreateAgentSessionSchema>

export const UpdateAgentSessionSchema = z.strictObject({
  name: SessionNameEntitySchema.optional(),
  isNameManuallyEdited: z.boolean().optional(),
  description: z.string().optional(),
  agentId: z.string().min(1).optional()
})

export type UpdateAgentSessionDto = z.infer<typeof UpdateAgentSessionSchema>

/**
 * Body for `PUT /agent-sessions/:sessionId/workspace`. Replacing a session's
 * workspace creates/deletes the backing system workspace row and is only
 * allowed before any message exists, so it lives on a dedicated sub-resource
 * rather than the generic PATCH (see api-design-guidelines: complex
 * side-effects / resource creation → dedicated endpoint).
 */
export const SetAgentSessionWorkspaceSchema = AgentSessionWorkspaceSourceSchema
export type SetAgentSessionWorkspaceDto = AgentSessionWorkspaceSource

/** Query for `GET /agent-sessions` (cursor pagination + optional agent filter). */
export const ListAgentSessionsQuerySchema = z.strictObject({
  ids: z.array(z.string().min(1)).min(1).max(200).optional(),
  agentId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  /** `true` lists only trashed sessions; omitted/false lists active sessions. */
  inTrash: z.boolean().optional()
})
export type ListAgentSessionsQueryParams = z.input<typeof ListAgentSessionsQuerySchema>
export type ListAgentSessionsQuery = z.output<typeof ListAgentSessionsQuerySchema>

/** Optional owner scope for `GET /agent-sessions/latest`; omitted means global latest. */
export const LatestAgentSessionQuerySchema = z.strictObject({
  agentId: z.string().min(1).optional()
})
export type LatestAgentSessionQuery = z.infer<typeof LatestAgentSessionQuerySchema>

/** Exact creation target for atomically reusing or creating an empty session. */
export const ReuseOrCreateAgentSessionSchema = z.strictObject({
  agentId: z.string().min(1),
  workspace: AgentSessionWorkspaceSourceSchema,
  excludeSessionId: z.string().min(1).optional()
})
export type ReuseOrCreateAgentSessionDto = z.infer<typeof ReuseOrCreateAgentSessionSchema>

export interface DeleteAgentSessionsResult {
  deletedIds: string[]
}

// ============================================================================
// Interruption recovery (abnormal exit)
// ============================================================================

/**
 * How the recorded interruption happened. Homogeneous per record: one exit is
 * either graceful (all live turns aborted to `paused`, resume tokens kept) or a
 * crash (rows left `pending`, boot reconcile flips them to `error` and discards
 * resume tokens) — never both at once.
 */
export const INTERRUPTED_SESSION_RECOVERY_KIND = ['crash', 'graceful-exit'] as const
export type InterruptedSessionRecoveryKind = (typeof INTERRUPTED_SESSION_RECOVERY_KIND)[number]

/** Sessions to auto-resume via `POST /agent-sessions/interrupted-recovery/resume`. */
export const ResumeInterruptedSessionsSchema = z.strictObject({
  sessionIds: z.array(z.string().min(1)).min(1)
})
export type ResumeInterruptedSessionsDto = z.infer<typeof ResumeInterruptedSessionsSchema>

/** One interrupted session, with display metadata joined at read time (not at
 * snapshot time — the session or its agent may have been deleted since). */
export interface InterruptedSessionItem {
  sessionId: string
  agentId: string | null
  /** Agent display name snapshot-joined at read time; null when the agent is gone. */
  agentName: string | null
  /** Session display name; may be empty for an untitled placeholder session. */
  sessionName: string
  sessionType: 'conversation' | 'background'
  /** Workspace path (cwd) the agent was working in, when bound to a real folder. */
  workspacePath: string | null
  /** When the interrupted turn's assistant message was created, if persisted. */
  interruptedAt: string | null
  /**
   * Short human-readable interruption point extracted from the interrupted
   * turn's parts (last tool name, subagent task title, or "awaiting approval"),
   * or null when nothing more specific than "a response was in flight" is known.
   */
  summary: string | null
}

/** Response for `GET /agent-sessions/interrupted-recovery` — `null` when nothing
 * interruptible happened, everything was already resumed, or the notice was dismissed. */
export interface InterruptedSessionRecoveryResponse {
  kind: InterruptedSessionRecoveryKind
  detectedAt: string
  items: InterruptedSessionItem[]
}

/** Sessions whose resume message was queued; absent ids were no longer interrupted. */
export interface ResumeInterruptedSessionsResponse {
  resumedIds: string[]
}

/** Response for `GET /agent-sessions/latest` — the most-recently-active session in the requested scope, or `null`. */
export interface LatestAgentSessionResponse {
  session: AgentSessionEntity | null
}

/** The reusable empty session selected or created for the exact target. */
export interface ReusableAgentSessionPlaceholdersResponse {
  session: AgentSessionEntity
  created: boolean
  deletedDuplicateSessionIds: string[]
}

// ============================================================================
// API Schema definitions
// ============================================================================

export type AgentSessionSchemas = {
  '/agent-sessions': {
    GET: {
      query?: ListAgentSessionsQueryParams
      response: CursorPaginationResponse<AgentSessionEntity>
    }
    POST: {
      body: CreateAgentSessionDto
      response: AgentSessionEntity
    }
  }

  /**
   * Most-recently-active session, globally or within one owner scope.
   *
   * First-entry restore reads this to resume the last-touched session. Declared
   * before `/agent-sessions/:sessionId` and matched exactly by the server router,
   * so `latest` is never mistaken for a session id. Proves global latest via
   * `lastActivityAt DESC LIMIT 1`, unlike the `orderKey`-paged `/agent-sessions` first
   * page. `agentId=unlinked` covers sessions without a live agent.
   */
  '/agent-sessions/latest': {
    GET: {
      query?: LatestAgentSessionQuery
      response: LatestAgentSessionResponse
    }
  }

  /**
   * Sessions whose work was interrupted by the previous exit (crash or graceful
   * quit mid-turn). Declared before `/agent-sessions/:sessionId` and matched
   * exactly by the server router, so `interrupted-recovery` is never mistaken
   * for a session id.
   *
   * GET is read-time filtered: sessions deleted since, or already resumed with
   * new messages after `detectedAt`, drop out silently. DELETE dismisses the
   * notice permanently.
   */
  '/agent-sessions/interrupted-recovery': {
    GET: {
      response: InterruptedSessionRecoveryResponse | null
    }
    DELETE: {
      response: { dismissed: true }
    }
  }

  /**
   * Auto-resume selected interrupted sessions by delivering a resume message to
   * each. Declared before the parameterized two-segment templates (e.g.
   * `/agent-sessions/:sessionId/workspace`) so `interrupted-recovery/resume`
   * is matched exactly. Ids that are no longer interrupted (deleted or already
   * resumed) are ignored silently; the response lists what was actually queued.
   */
  '/agent-sessions/interrupted-recovery/resume': {
    POST: {
      body: ResumeInterruptedSessionsDto
      response: ResumeInterruptedSessionsResponse
    }
  }

  '/agent-sessions/:sessionId': {
    GET: {
      params: { sessionId: string }
      response: AgentSessionEntity
    }
    PATCH: {
      params: { sessionId: string }
      body: UpdateAgentSessionDto
      response: AgentSessionEntity
    }
  }

  '/agent-sessions/:sessionId/workspace': {
    /**
     * Replace the session's workspace. Only permitted while the session has no
     * messages — once a conversation has started the binding is permanent
     * (NOT_FOUND if the session is missing, INVALID_OPERATION if it already has
     * messages).
     *
     * Side effects: switching away from a system workspace deletes that backing
     * row; switching to `{ type: 'system' }` creates a fresh system workspace.
     */
    PUT: {
      params: { sessionId: string }
      body: SetAgentSessionWorkspaceDto
      response: AgentSessionEntity
    }
  }
} & OrderEndpoints<'/agent-sessions'>
