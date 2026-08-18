/**
 * The Claude Code guard table — every cross-cutting conduct rule the runtime enforces on the
 * PreToolUse plane, in one place. Adding cross-cutting policy means adding a row here; fixed
 * per-tool approval belongs to the structured builtin-tool policy registry.
 *
 * Severity-sorted: deny rules precede ask rules so the fold in `evaluateToolGuards` surfaces the
 * same reason deterministically that the SDK's parallel severity fold produced by race before.
 * `bypassBehavior` is the single authority on what bypassPermissions lifts: it skips the
 * interactive effect of 'skipInteractiveEffect' rules and nothing else — headless denials hold in
 * every mode (skill-install's explicit opt-out excepted).
 */

import {
  findBuiltinToolPolicy,
  listBuiltinToolPolicies,
  toCherryBuiltinRuntimeName,
  toMcpRuntimeName
} from '@main/ai/runtime/toolApproval/builtinToolPolicy'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import { CONFIG_TOOL_NAME } from '@shared/ai/builtinTools'
import { claudeToolRequiresUserInteraction } from '@shared/ai/claudecode/toolRegistry'

import { detectGlobalInstall } from '../toolApproval/dependencyGuard'
import {
  detectDestructiveAssistantCommand,
  isGitHubIssueCreationCommand,
  isLarkFormSubmissionCommand,
  isPermanentDeletionToolName
} from './assistantCommandSafety'
import { isPathWithinAllowedRoots } from './pathContainment'
import type { GuardHit, ToolGuardContext, ToolGuardRule } from './toolGuards'

export const ASK_USER_QUESTION_TOOL_NAME = 'AskUserQuestion'
export const HEADLESS_INTERACTIVE_TOOL_DENIAL =
  'This channel or scheduled turn has no interactive responder, so proceed without asking the user and state your assumptions instead.'
const HEADLESS_CONFIG_MUTATION_ACTIONS = new Set([
  'rename',
  'complete_bootstrap',
  'reset_bootstrap',
  'add_channel',
  'update_channel',
  'remove_channel',
  'reconnect_channel'
])
export const WORKSPACE_PATH_FIELDS = {
  Edit: 'file_path',
  Glob: 'path',
  Grep: 'path',
  NotebookEdit: 'notebook_path',
  Read: 'file_path',
  Write: 'file_path'
} as const

/**
 * Runtime boundary format for the snapshot's auto-allow exceptions. The maintained source is the
 * structured policy registry; Assistant tools count only while those MCP servers are mounted.
 */
export function approvalRequiredRuntimeNames(assistantMcpEnabled: boolean): readonly string[] {
  return listBuiltinToolPolicies({ approval: 'required', assistantMcpEnabled }).map(toMcpRuntimeName)
}

function bashCommand(ctx: ToolGuardContext): string | undefined {
  const command = ctx.input?.command
  return typeof command === 'string' && command.trim() ? command : undefined
}

const destructiveBuiltinOperation = (ctx: ToolGuardContext): GuardHit | null => {
  if (ctx.toolName === 'Bash') {
    const command = ctx.input?.command
    const reason = typeof command === 'string' ? detectDestructiveAssistantCommand(command) : undefined
    return reason ? { evidence: reason } : null
  }
  return isPermanentDeletionToolName(ctx.toolName) ? { evidence: 'permanent deletion tool' } : null
}

const globalInstallCommand = (ctx: ToolGuardContext): GuardHit | null => {
  const command = bashCommand(ctx)
  if (!command) return null
  const reason = detectGlobalInstall(command)
  return reason ? { evidence: reason } : null
}

const feedbackSubmissionCommand = (ctx: ToolGuardContext): GuardHit | null => {
  const command = ctx.input?.command
  if (typeof command !== 'string') return null
  return isLarkFormSubmissionCommand(command) || isGitHubIssueCreationCommand(command) ? {} : null
}

const mutatingConfigAction = (ctx: ToolGuardContext): GuardHit | null => {
  const action = typeof ctx.input?.action === 'string' ? ctx.input.action : ''
  return HEADLESS_CONFIG_MUTATION_ACTIONS.has(action) ? {} : null
}

const pathOutsideAllowedRoots = async (ctx: ToolGuardContext): Promise<GuardHit | null> => {
  const pathField = WORKSPACE_PATH_FIELDS[ctx.toolName as keyof typeof WORKSPACE_PATH_FIELDS]
  if (!pathField) return null
  const requestedPath = ctx.input?.[pathField]
  // Glob/Grep intentionally omit `path` to search from cwd. Let the SDK validate missing or
  // malformed required fields for the other tools rather than duplicating their schemas here.
  if (typeof requestedPath !== 'string' || !requestedPath.trim()) return null
  if (await isPathWithinAllowedRoots(ctx.cwd, ctx.agentDataPath, requestedPath)) return null
  return { evidence: requestedPath }
}

const matchesRequiredApproval = (ctx: ToolGuardContext, bypassApproval: 'lift' | 'enforce'): GuardHit | null => {
  const policy = findBuiltinToolPolicy(ctx.toolName, ctx.assistantMcpEnabled)
  return policy?.approval === 'required' && policy.bypassApproval === bypassApproval ? {} : null
}

export const CLAUDE_TOOL_GUARD_RULES: readonly ToolGuardRule[] = [
  {
    id: 'disabled-tool',
    bypassBehavior: 'enforce',
    match: { when: (ctx) => (ctx.toolName && ctx.isDisabled(ctx.toolName) ? {} : null) },
    effect: 'deny',
    reason: (_hit, ctx) => `The ${ctx.toolName} tool is disabled for this agent.`
  },
  {
    // Protected built-in Agents may edit automatically, but must never turn that convenience into
    // irreversible deletion; confirmed workspace deletion goes through the move-to-trash tool.
    id: 'builtin-destructive',
    bypassBehavior: 'enforce',
    appliesTo: { protectedBuiltinOnly: true },
    match: { when: destructiveBuiltinOperation },
    effect: 'deny',
    reason: (hit) =>
      `This built-in Agent blocked ${hit.evidence}. It must never permanently delete data or bypass this safeguard. ` +
      'For a confirmed file or directory inside the session workspace, use mcp__assistant-files__move_to_trash; protected paths cannot be deleted.'
  },
  {
    // Global/shared installs leak into ~/.bun, ~/.local/share/uv, … shared by every agent, so this
    // is a safety block, not an approval — bypassPermissions does not lift it.
    id: 'global-install',
    bypassBehavior: 'enforce',
    match: { tool: 'Bash', when: globalInstallCommand },
    effect: 'deny',
    reason: (hit) =>
      `Blocked to avoid cross-agent dependency pollution: ${hit.evidence}. Install project dependencies in the current workspace (e.g. \`bun install <pkg>\`, or \`uv run --with <pkg> python\` for Python). For one-off tools use \`bun x <tool>\` / \`uvx <tool>\`; for persistent CLIs use \`cli_search\` then \`cli_install\`.`
  },
  {
    id: 'headless-config-mutation',
    bypassBehavior: 'enforce',
    match: { tool: toCherryBuiltinRuntimeName(CONFIG_TOOL_NAME), when: mutatingConfigAction },
    headless: {
      predicate: 'turn-headless',
      reason:
        'Headless channel or scheduled turns cannot mutate agent configuration. Ask the user to make this change in Cherry Studio.'
    }
  },
  {
    // Installing third-party skill code needs a responder — except under bypassPermissions, the
    // user's explicit opt-in to unattended installation.
    id: 'skill-install',
    bypassBehavior: 'skipInteractiveEffect',
    match: { tool: 'mcp__skills__install_skill' },
    headless: {
      predicate: 'turn-headless',
      reason:
        'This channel or scheduled turn cannot approve a skill installation. Use bypassPermissions for unattended installation, or install it from an interactive turn.',
      skipHeadlessDenyInBypass: true
    }
  },
  {
    id: 'interactive-headless',
    bypassBehavior: 'enforce',
    match: { when: (ctx) => (claudeToolRequiresUserInteraction(ctx.toolName) ? {} : null) },
    headless: { predicate: 'responder-unavailable', reason: HEADLESS_INTERACTIVE_TOOL_DENIAL }
  },
  {
    // Not an approval: the tool's entire function is a user-authored answer, so bypassPermissions
    // must not execute it silently. Soft only in the derivation sense — canUseTool exempts the
    // name from its auto-allow shortcut, so no mode pierces the prompt.
    id: 'ask-user-question',
    bypassBehavior: 'enforce',
    match: { tool: ASK_USER_QUESTION_TOOL_NAME },
    effect: 'ask',
    askStrength: 'soft',
    reason: 'AskUserQuestion requires a live user response.'
  },
  {
    // Feedback skills submit through Bash under the user's identity (Lark form / GitHub issue).
    id: 'assistant-feedback',
    bypassBehavior: 'skipInteractiveEffect',
    appliesTo: { role: BUILTIN_AGENT_ROLE.ASSISTANT },
    match: { tool: 'Bash', when: feedbackSubmissionCommand },
    effect: 'ask',
    askStrength: 'soft',
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
    appliesTo: { role: BUILTIN_AGENT_ROLE.SUPPORT },
    match: { tool: 'Bash' },
    effect: 'ask',
    askStrength: 'soft',
    reason: 'Cherry Support shell commands require live per-call user approval.',
    headless: {
      predicate: 'either',
      reason:
        'Headless channel or scheduled turns cannot run shell commands for Cherry Support. Keep only a sanitized local draft using the structured file tools.'
    }
  },
  {
    // Cross-Session delegation keeps its one-hop live-approval ceiling in every mode. This is the
    // policy entry's explicit exception to ordinary Full Access approval lifting.
    id: 'non-bypassable-approval',
    bypassBehavior: 'enforce',
    match: { when: (ctx) => matchesRequiredApproval(ctx, 'enforce') },
    effect: 'ask',
    askStrength: 'hard',
    reason: (_hit, ctx) => `The ${ctx.toolName} tool requires live per-call user approval.`,
    headless: { predicate: 'responder-unavailable', reason: HEADLESS_INTERACTIVE_TOOL_DENIAL }
  },
  {
    // The explicit per-call approval list (kb_manage / generate_image / cli_install + mounted
    // assistant tools). Hard: derived into the snapshot's auto-allow exceptions so acceptEdits /
    // default safe-tools never auto-pierce it; bypassPermissions is the one opt-out.
    id: 'approval-required',
    bypassBehavior: 'skipInteractiveEffect',
    match: { when: (ctx) => matchesRequiredApproval(ctx, 'lift') },
    effect: 'ask',
    askStrength: 'hard',
    reason: (_hit, ctx) => `The ${ctx.toolName} tool requires per-call user approval.`,
    headless: { predicate: 'responder-unavailable', reason: HEADLESS_INTERACTIVE_TOOL_DENIAL }
  },
  {
    // `cwd` establishes the default SDK working directory but does not itself prevent an absolute
    // path from reaching a built-in file tool. Soft ask: forces the call through the permission
    // pipeline (defeating settings-file allow rules) while the mode's own auto-approval semantics
    // still apply — out-of-workspace reads stay silent in default mode by decision.
    id: 'workspace-escape',
    bypassBehavior: 'skipInteractiveEffect',
    match: { when: pathOutsideAllowedRoots },
    effect: 'ask',
    askStrength: 'soft',
    reason: (hit, ctx) =>
      `${ctx.toolName} requested a path outside the session workspace (${ctx.cwd}) and agent data directory (${ctx.agentDataPath}): ${hit.evidence}`
  }
]
