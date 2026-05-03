/**
 * Public types for the unified tool-approval system.
 *
 * Storage shape (`PermissionRule`, persisted under `tools.permission_rules`)
 * lives in `@shared/data/preference/preferenceTypes`. Runtime types
 * (`PermissionContext`, `PermissionDecision`) live here.
 *
 * `PermissionDecision.behavior` extends storage with `'passthrough'` —
 * valid only as a tool hook's return ("no opinion; continue downstream").
 * Storage rules are never `passthrough`.
 */

import type { PermissionBehavior } from '@shared/data/preference/preferenceTypes'

export type { PermissionBehavior, PermissionRule } from '@shared/data/preference/preferenceTypes'

export type PermissionDecisionBehavior = PermissionBehavior | 'passthrough'

export interface PermissionContext {
  /** Driver of the call. Used by Layer 1 of the pipeline. */
  toolKind: 'builtin' | 'mcp' | 'claude-agent'
  /** Session id — usually the AiStreamManager execution id or chat session id. */
  sessionId: string
  /** AI SDK-assigned per-call id. */
  toolCallId: string
  /** Working directory for `scope.cwd` matching. */
  cwd?: string
  /** Topic id — used by `waitForApproval` to PATCH the renderer-visible anchor. */
  topicId?: string
  /** Anchor message id — same purpose as `topicId`. */
  anchorId?: string
  /** Whole-call abort. Cancels in-flight approvals. */
  abortSignal?: AbortSignal
}

export interface PermissionDecision {
  behavior: PermissionDecisionBehavior
  reason?: string
  /**
   * Pattern hint shown in the approval card's "Allow always: <pattern>"
   * affordance. Tool-specific (e.g., shell suggests `git status:*`).
   */
  suggestedRule?: { toolName: string; ruleContent?: string }
}
