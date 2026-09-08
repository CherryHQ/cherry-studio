/**
 * The Claude Code guard table — every cross-cutting conduct rule the runtime enforces on the
 * PreToolUse plane, in one place. Adding cross-cutting policy means adding a row here; fixed
 * per-tool approval belongs to the structured builtin-tool policy registry, and a rule that only
 * one Agent needs belongs to that Agent (see `builtinAgentGuardRules`).
 *
 * Severity-sorted: deny rules precede ask rules so the fold in `evaluateToolGuards` surfaces the
 * same reason deterministically that the SDK's parallel severity fold produced by race before.
 * `bypassBehavior` is the single authority on what bypassPermissions lifts: it skips the
 * interactive effect of 'skipInteractiveEffect' rules and nothing else — headless denials hold in
 * every mode (skill-install's explicit opt-out excepted). A rule whose only decision is a headless
 * denial declares no `bypassBehavior`; there is no effect for bypass to skip.
 */

import path from 'node:path'

import { BUILTIN_AGENT_TOOL_GUARD_RULES } from '@main/ai/agents/builtin/builtinAgentGuardRules'
import {
  findBuiltinToolPolicy,
  listBuiltinToolPolicies,
  toCherryBuiltinRuntimeName,
  toMcpRuntimeName
} from '@main/ai/toolApproval/builtinToolPolicy'
import { detectGlobalInstall } from '@main/ai/toolApproval/dependencyGuard'
import type { GuardHit, ToolGuardContext, ToolGuardRule } from '@main/ai/toolApproval/toolGuards'
import { evaluateUserDataSqliteGuard, USER_DATA_SQLITE_GUARD_REASON } from '@main/ai/toolApproval/userDataSqliteGuard'
import { CONFIG_TOOL_NAME } from '@shared/ai/builtinTools'
import { claudeToolRequiresUserInteraction } from '@shared/ai/claudecode/toolRegistry'
import { imageExts } from '@shared/utils/file'

import { BASH_NO_PROGRESS_HARD_THRESHOLD } from './bashNoProgress'
import {
  EXPLORER_CAP_HARD_THRESHOLD,
  EXPLORER_IDENTICAL_HARD_THRESHOLD,
  EXPLORER_SAME_FILE_CAP,
  EXPLORER_TOOLS
} from './explorerLoop'
import { isPathWithinAllowedRoots } from './pathContainment'
import { checkSkillRuntimeDependencies, SKILL_TOOL_NAME } from './skillDependencies'

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
 * structured policy registry; an entry counts only while its MCP server is mounted.
 */
export function approvalRequiredRuntimeNames(mountedServers: ReadonlySet<string>): readonly string[] {
  return listBuiltinToolPolicies({ approval: 'required', mountedServers }).map(toMcpRuntimeName)
}

function bashCommand(ctx: ToolGuardContext): string | undefined {
  const command = ctx.input?.command
  return typeof command === 'string' && command.trim() ? command : undefined
}

const globalInstallCommand = (ctx: ToolGuardContext): GuardHit | null => {
  const command = bashCommand(ctx)
  if (!command) return null
  const reason = detectGlobalInstall(command)
  return reason ? { evidence: reason } : null
}

const userDataSqliteWrite = async (ctx: ToolGuardContext): Promise<GuardHit | null> => {
  const decision = await evaluateUserDataSqliteGuard({
    runtime: 'claude-code',
    toolName: ctx.toolName,
    args: ctx.input,
    cwd: ctx.cwd,
    workspacePath: ctx.cwd,
    signal: ctx.signal
  })
  return decision ? {} : null
}

const mutatingConfigAction = (ctx: ToolGuardContext): GuardHit | null => {
  const action = typeof ctx.input?.action === 'string' ? ctx.input.action : ''
  return HEADLESS_CONFIG_MUTATION_ACTIONS.has(action) ? {} : null
}

const unsupportedImageRead = (ctx: ToolGuardContext): GuardHit | null => {
  if (ctx.supportsImages !== false) return null
  const requestedPath = ctx.input?.file_path
  if (typeof requestedPath !== 'string' || !imageExts.includes(path.extname(requestedPath).toLowerCase())) return null
  return { evidence: requestedPath }
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

const skillWithAbsentDependency = async (ctx: ToolGuardContext): Promise<GuardHit | null> => {
  const skillName = ctx.input?.skill
  if (typeof skillName !== 'string' || !skillName) return null
  const { deny } = await checkSkillRuntimeDependencies(skillName, ctx.cwd, ctx.pluginDirectories)
  return deny ? { evidence: deny } : null
}

const bashRepeatWithoutProgress = (ctx: ToolGuardContext): GuardHit | null => {
  const command = bashCommand(ctx)
  if (!command) return null
  const run = ctx.bashNoProgressRun?.(command)
  // Hard tier only: the soft tier (a one-shot warning at BASH_NO_PROGRESS_THRESHOLD) lives in the
  // hook plane, the same split as skill-dependency's deny/advisory halves.
  return run !== undefined && run >= BASH_NO_PROGRESS_HARD_THRESHOLD ? { evidence: String(run) } : null
}

const explorerRepeatIdentical = (ctx: ToolGuardContext): GuardHit | null => {
  if (!EXPLORER_TOOLS.has(ctx.toolName)) return null
  const status = ctx.explorerLoopStatus?.(ctx.toolName, ctx.input)
  return status && status.identicalRun >= EXPLORER_IDENTICAL_HARD_THRESHOLD
    ? { evidence: String(status.identicalRun) }
    : null
}

const explorerTraversalCycle = (ctx: ToolGuardContext): GuardHit | null => {
  if (ctx.toolName !== 'Read') return null
  const status = ctx.explorerLoopStatus?.(ctx.toolName, ctx.input)
  if (!status || !status.isCycle) return null
  return {
    evidence: `${status.filePath ?? 'file'}:${status.lastOffset ?? 0}:${status.rangeStart ?? 1}-${status.rangeEnd ?? 2000}`
  }
}

const explorerDuplicateChunk = (ctx: ToolGuardContext): GuardHit | null => {
  if (ctx.toolName !== 'Read') return null
  const status = ctx.explorerLoopStatus?.(ctx.toolName, ctx.input)
  if (!status || !status.isDuplicateChunk) return null
  return {
    evidence: `${status.filePath ?? 'file'}:${status.rangeStart ?? 1}-${status.rangeEnd ?? 2000}`
  }
}

const explorerSameFileCap = (ctx: ToolGuardContext): GuardHit | null => {
  if (ctx.toolName !== 'Read') return null
  const status = ctx.explorerLoopStatus?.(ctx.toolName, ctx.input)
  if (!status || !status.sameFileCapReached) return null
  return { evidence: status.filePath ?? 'file' }
}

const explorerConsecutiveCap = (ctx: ToolGuardContext): GuardHit | null => {
  if (!EXPLORER_TOOLS.has(ctx.toolName)) return null
  const status = ctx.explorerLoopStatus?.(ctx.toolName, ctx.input)
  return status && status.consecutiveReads >= EXPLORER_CAP_HARD_THRESHOLD
    ? { evidence: String(status.consecutiveReads) }
    : null
}

const matchesRequiredApproval = (ctx: ToolGuardContext, bypassApproval: 'lift' | 'enforce'): GuardHit | null => {
  const policy = findBuiltinToolPolicy(ctx.toolName, ctx.mountedServers)
  return policy?.approval === 'required' && policy.bypassApproval === bypassApproval ? {} : null
}

const CROSS_CUTTING_TOOL_GUARD_RULES: readonly ToolGuardRule[] = [
  {
    id: 'disabled-tool',
    bypassBehavior: 'enforce',
    match: { when: (ctx) => (ctx.toolName && ctx.isDisabled(ctx.toolName) ? {} : null) },
    effect: 'deny',
    reason: (_hit, ctx) => `The ${ctx.toolName} tool is disabled for this agent.`
  },
  {
    id: 'user-data-sqlite-write',
    bypassBehavior: 'enforce',
    match: { when: userDataSqliteWrite },
    effect: 'deny',
    reason: USER_DATA_SQLITE_GUARD_REASON
  },
  {
    id: 'unsupported-image-read',
    bypassBehavior: 'enforce',
    match: { tool: 'Read', when: unsupportedImageRead },
    effect: 'deny',
    reason: (hit) =>
      `The selected model does not support image input, so Read cannot open ${hit.evidence}. Use a vision-capable model or inspect the file through a text-only alternative.`
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
    // The SDK forks a skill whether or not its declared subagent exists, degrading into unrelated
    // output instead of an error. Only a provably absent dependency blocks; everything else is
    // advisory context (see skillDependencies). Not an approval — bypassPermissions does not lift it.
    id: 'skill-absent-dependency',
    bypassBehavior: 'enforce',
    match: { tool: SKILL_TOOL_NAME, when: skillWithAbsentDependency },
    effect: 'deny',
    reason: (hit) => hit.evidence ?? 'The skill declares a runtime dependency that is not installed.'
  },
  {
    // A stuck loop burns tokens fastest on unattended bypass runs, so this is a conduct rule, not
    // an approval — bypassPermissions does not lift it.
    id: 'bash-repeat-no-progress',
    bypassBehavior: 'enforce',
    match: { tool: 'Bash', when: bashRepeatWithoutProgress },
    effect: 'deny',
    reason: (hit) =>
      `This exact Bash command already ran ${hit.evidence} times in a row with byte-identical output — repeating it yields no new information. Diagnose why the output is not changing, vary the command, or report the blocker instead of retrying.`
  },
  {
    id: 'explorer-repeat-identical',
    bypassBehavior: 'enforce',
    match: { when: explorerRepeatIdentical },
    effect: 'deny',
    reason: (hit, ctx) =>
      `You have called ${ctx.toolName} ${hit.evidence} times consecutively with identical arguments without making progress. Stop repeating this call and proceed directly to Edit/Write or summarize your findings.`
  },
  {
    id: 'explorer-traversal-cycle',
    bypassBehavior: 'enforce',
    match: { tool: 'Read', when: explorerTraversalCycle },
    effect: 'deny',
    reason: (hit) =>
      `Traversal cycle detected (${hit.evidence}): you previously read forward in this file and are now re-reading earlier lines. Restarting traversal or repeating read cycles is strictly prohibited. Synthesize your answer from existing context or proceed with modifications/summary.`
  },
  {
    id: 'explorer-duplicate-chunk',
    bypassBehavior: 'enforce',
    match: { tool: 'Read', when: explorerDuplicateChunk },
    effect: 'deny',
    reason: (hit) =>
      `Duplicate chunk rejected (${hit.evidence}): these lines were already retrieved in earlier turns. Refer to earlier tool results in your conversation context instead of re-reading.`
  },
  {
    id: 'explorer-same-file-cap',
    bypassBehavior: 'enforce',
    match: { tool: 'Read', when: explorerSameFileCap },
    effect: 'deny',
    reason: (hit) =>
      `Same-file read limit reached for '${hit.evidence}' (${EXPLORER_SAME_FILE_CAP} slice reads without code modifications). Further reading on this file is locked. Use larger line limits or proceed to Edit/Write or summarize.`
  },
  {
    id: 'explorer-consecutive-cap',
    bypassBehavior: 'enforce',
    match: { when: explorerConsecutiveCap },
    effect: 'deny',
    reason: (hit) =>
      `Exploration budget reached (${hit.evidence} consecutive read/search operations without code changes). Further exploration is locked. You must apply code changes using Edit/Write or summarize your conclusions now.`
  },
  {
    id: 'headless-config-mutation',
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
    match: { when: (ctx) => (claudeToolRequiresUserInteraction(ctx.toolName) ? {} : null) },
    headless: { predicate: 'responder-unavailable', reason: HEADLESS_INTERACTIVE_TOOL_DENIAL }
  },
  {
    // Not an approval: the tool's entire function is a user-authored answer, so bypassPermissions
    // must not execute it silently. canUseTool separately exempts the name from its auto-allow
    // shortcut, so no mode pierces the prompt.
    id: 'ask-user-question',
    bypassBehavior: 'enforce',
    match: { tool: ASK_USER_QUESTION_TOOL_NAME },
    effect: 'ask',
    reason: 'AskUserQuestion requires a live user response.'
  },
  {
    // Cross-Session delegation keeps its one-hop live-approval ceiling in every mode. This is the
    // policy entry's explicit exception to ordinary Full Access approval lifting.
    id: 'non-bypassable-approval',
    bypassBehavior: 'enforce',
    match: { when: (ctx) => matchesRequiredApproval(ctx, 'enforce') },
    effect: 'ask',
    reason: (_hit, ctx) => `The ${ctx.toolName} tool requires live per-call user approval.`,
    headless: { predicate: 'responder-unavailable', reason: HEADLESS_INTERACTIVE_TOOL_DENIAL }
  },
  {
    // The explicit per-call approval list (kb_manage / generate_image / cli_install + mounted
    // assistant tools). The snapshot's auto-allow exceptions come from the same registry entries, so
    // acceptEdits / default safe-tools never auto-pierce it; bypassPermissions is the one opt-out.
    id: 'approval-required',
    bypassBehavior: 'skipInteractiveEffect',
    match: { when: (ctx) => matchesRequiredApproval(ctx, 'lift') },
    effect: 'ask',
    reason: (_hit, ctx) => `The ${ctx.toolName} tool requires per-call user approval.`,
    headless: {
      predicate: 'responder-unavailable',
      reason: HEADLESS_INTERACTIVE_TOOL_DENIAL,
      skipHeadlessDenyInBypass: true
    }
  },
  {
    // `cwd` establishes the default SDK working directory but does not itself prevent an absolute
    // path from reaching a built-in file tool. Ask, not deny: forces the call through the permission
    // pipeline (defeating settings-file allow rules) while the mode's own auto-approval semantics
    // still apply — out-of-workspace reads stay silent in default mode by decision.
    id: 'workspace-escape',
    bypassBehavior: 'skipInteractiveEffect',
    match: { when: pathOutsideAllowedRoots },
    effect: 'ask',
    reason: (hit, ctx) =>
      `${ctx.toolName} requested a path outside the session workspace (${ctx.cwd}) and agent data directory (${ctx.agentDataPath}): ${hit.evidence}`
  }
]

/**
 * Cross-cutting rules first, then whatever the built-in Agents declare. Order only breaks ties
 * between rules of the same severity, so appending never weakens a decision.
 */
export const CLAUDE_TOOL_GUARD_RULES: readonly ToolGuardRule[] = [
  ...CROSS_CUTTING_TOOL_GUARD_RULES,
  ...BUILTIN_AGENT_TOOL_GUARD_RULES
]
