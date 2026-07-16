/**
 * Execution-time tool policy for the `ai-sdk` agent runtime (plan D7).
 *
 * Every registered tool — builtin, MCP, skill — passes through ONE wrapper
 * that reads the connection's LIVE policy at fire-time (closure accessors),
 * so a reconcile hot-patch applies to the very next tool call. The gate
 * order mirrors pi's approval extension: disabled → hard denial → approval
 * by permission mode.
 *
 * A disabled or hard-denied call must never surface an approval card for a
 * doomed action, so `needsApproval` returns false for it and `execute`
 * throws — the model sees a tool error, the user is never prompted.
 */

import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { Tool } from 'ai'

/** Live policy accessors, bound to the connection's reconcile-patched state. */
export interface AgentToolPolicy {
  getPermissionMode(): AgentPermissionMode
  isDisabled(toolName: string): boolean
}

/**
 * How a tool participates in the permission-mode matrix:
 * - `auto`: never prompts (read-only tools clamped to the workspace, skill)
 * - `edit`: prompts in `default`, auto-approved in `acceptEdits` (write/edit)
 * - `prompt`: prompts in `default` and `acceptEdits` (bash, MCP)
 * `bypassPermissions` prompts for nothing; disabled/hard denials block in
 * every mode.
 */
export type AgentToolApprovalClass = 'auto' | 'edit' | 'prompt'

export interface ApplyToolPolicyOptions {
  approvalClass: AgentToolApprovalClass
  /**
   * Input-dependent hard denial (e.g. bash global-install detection).
   * A non-null reason blocks execution in EVERY mode without prompting.
   */
  denyReason?: (input: unknown) => string | null
}

/** Whether the matrix requires an approval prompt for this class under this mode. */
export function requiresApproval(mode: AgentPermissionMode, approvalClass: AgentToolApprovalClass): boolean {
  if (mode === 'bypassPermissions') return false
  if (approvalClass === 'auto') return false
  if (approvalClass === 'edit') return mode !== 'acceptEdits'
  return true
}

/** Wrap one AI SDK tool with the agent's execution-time policy. */
export function applyToolPolicy(name: string, base: Tool, policy: AgentToolPolicy, opts: ApplyToolPolicyOptions): Tool {
  const baseExecute = base.execute
  if (!baseExecute) {
    throw new Error(`agent tool "${name}" has no execute — the ai-sdk runtime only registers executable tools`)
  }
  return {
    ...base,
    needsApproval: (input: unknown) => {
      if (policy.isDisabled(name)) return false
      if (opts.denyReason?.(input)) return false
      return requiresApproval(policy.getPermissionMode(), opts.approvalClass)
    },
    execute: async (input: unknown, options) => {
      if (policy.isDisabled(name)) {
        throw new Error(`Tool "${name}" is disabled for this agent.`)
      }
      const reason = opts.denyReason?.(input)
      if (reason) throw new Error(reason)
      return baseExecute(input, options)
    }
  } as Tool
}
