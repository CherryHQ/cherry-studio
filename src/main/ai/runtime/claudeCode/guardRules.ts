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
  type GuardHit,
  listBuiltinToolPolicies,
  toCherryBuiltinRuntimeName,
  toMcpRuntimeName,
  type ToolGuardContext,
  type ToolGuardRule
} from '@main/ai/toolApproval'
import { CONFIG_TOOL_NAME } from '@shared/ai/builtinTools'
import { claudeToolRequiresUserInteraction } from '@shared/ai/claudecode/toolRegistry'
import { imageExts } from '@shared/utils/file'

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
/**
 * Runtime boundary format for the snapshot's auto-allow exceptions. The maintained source is the
 * structured policy registry; an entry counts only while its MCP server is mounted.
 */
export function approvalRequiredRuntimeNames(mountedServers: ReadonlySet<string>): readonly string[] {
  return listBuiltinToolPolicies({ approval: 'required', mountedServers }).map(toMcpRuntimeName)
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

const skillWithAbsentDependency = async (ctx: ToolGuardContext): Promise<GuardHit | null> => {
  const skillName = ctx.input?.skill
  if (typeof skillName !== 'string' || !skillName) return null
  const { deny } = await checkSkillRuntimeDependencies(skillName, ctx.cwd, ctx.pluginDirectories)
  return deny ? { evidence: deny } : null
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
    id: 'unsupported-image-read',
    bypassBehavior: 'enforce',
    match: { tool: 'Read', when: unsupportedImageRead },
    effect: 'deny',
    reason: (hit) =>
      `The selected model does not support image input, so Read cannot open ${hit.evidence}. Use a vision-capable model or inspect the file through a text-only alternative.`
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
