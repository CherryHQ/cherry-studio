/**
 * Tool-call conduct rules owned by Cherry's built-in Agents (Assistant / Support).
 *
 * These are the built-in Agents' own safeguards, not the runtime's cross-cutting policy, so they
 * live with the Agents that declare them: a new built-in Agent adds a row here and the runtime
 * needs no edit.
 *
 * KNOWN GAP (#18898): only the Claude Code runtime evaluates this table. Pi returns before any
 * equivalent check under bypassPermissions and dsh has none, so a built-in Agent on those runtimes
 * is not held to these rules — a pre-existing hole this table inherited, not a design choice. Do
 * not describe these as cross-runtime guarantees until every runtime shares the evaluator.
 */

import type { GuardHit, ToolGuardContext, ToolGuardRule } from '@main/ai/toolApproval/toolGuards'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'

import {
  detectDestructiveAssistantCommand,
  isGitHubIssueCreationCommand,
  isLarkFormSubmissionCommand,
  isPermanentDeletionToolName
} from './assistantCommandSafety'

/** Every built-in role is protected — see `isProtectedBuiltinAgentRole`. */
const PROTECTED_BUILTIN_ROLES: readonly string[] = Object.values(BUILTIN_AGENT_ROLE)

const destructiveBuiltinOperation = (ctx: ToolGuardContext): GuardHit | null => {
  if (ctx.toolName === 'Bash') {
    const command = ctx.input?.command
    const reason = typeof command === 'string' ? detectDestructiveAssistantCommand(command) : undefined
    return reason ? { evidence: reason } : null
  }
  return isPermanentDeletionToolName(ctx.toolName) ? { evidence: 'permanent deletion tool' } : null
}

const feedbackSubmissionCommand = (ctx: ToolGuardContext): GuardHit | null => {
  const command = ctx.input?.command
  if (typeof command !== 'string') return null
  return isLarkFormSubmissionCommand(command) || isGitHubIssueCreationCommand(command) ? {} : null
}

export const BUILTIN_AGENT_TOOL_GUARD_RULES: readonly ToolGuardRule[] = [
  {
    // Protected built-in Agents may edit automatically, but must never turn that convenience into
    // irreversible deletion; confirmed workspace deletion goes through the move-to-trash tool.
    id: 'builtin-destructive',
    bypassBehavior: 'enforce',
    appliesTo: { roles: PROTECTED_BUILTIN_ROLES },
    match: { when: destructiveBuiltinOperation },
    effect: 'deny',
    reason: (hit) =>
      `This built-in Agent blocked ${hit.evidence}. It must never permanently delete data or bypass this safeguard. ` +
      'For a confirmed file or directory inside the session workspace, use mcp__assistant-files__move_to_trash; protected paths cannot be deleted.'
  },
  {
    // Feedback skills submit through Bash under the user's identity (Lark form / GitHub issue).
    id: 'assistant-feedback',
    bypassBehavior: 'skipInteractiveEffect',
    appliesTo: { roles: [BUILTIN_AGENT_ROLE.ASSISTANT] },
    match: { tool: 'Bash', when: feedbackSubmissionCommand },
    effect: 'ask',
    reason: 'Submitting Cherry Studio feedback externally requires live per-call user approval.',
    headless: {
      predicate: 'either',
      reason:
        'Headless channel or scheduled turns cannot submit Cherry Studio feedback. Keep only a sanitized local feedback draft for an interactive user to review and submit.'
    }
  },
  {
    // Support shell commands can hide external submissions behind arbitrary wrappers, so every
    // Bash call asks. Destructive commands fold into builtin-destructive's deny above.
    id: 'support-bash',
    bypassBehavior: 'skipInteractiveEffect',
    appliesTo: { roles: [BUILTIN_AGENT_ROLE.SUPPORT] },
    match: { tool: 'Bash' },
    effect: 'ask',
    reason: 'Cherry Support shell commands require live per-call user approval.',
    headless: {
      predicate: 'either',
      reason:
        'Headless channel or scheduled turns cannot run shell commands for Cherry Support. Keep only a sanitized local draft using the structured file tools.'
    }
  },
  {
    // The result is useful only when AgentChat can present its user-owned review dialog.
    id: 'support-diagnostic-draft',
    appliesTo: { roles: [BUILTIN_AGENT_ROLE.SUPPORT] },
    match: { tool: 'mcp__assistant__prepare_diagnostic_report' },
    headless: {
      predicate: 'either',
      reason:
        'Headless channel or scheduled turns cannot present a diagnostic report for user review. Ask the user to open the feedback entry in Cherry Studio instead.'
    }
  }
]
