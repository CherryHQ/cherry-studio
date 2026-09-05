/**
 * Declarative tool-call guards for the Claude Code runtime's PreToolUse plane.
 *
 * The SDK runs every PreToolUse hook and folds their permission decisions by severity
 * (deny > ask > allow) — it never short-circuits and never applies hook order. This evaluator
 * mirrors that exactly: every matching rule contributes a candidate, candidates fold deny > ask,
 * and ties resolve to the earliest table row so the surfaced reason is deterministic instead of a
 * completion-order race.
 *
 * Boundary (vs the adjacent layers): `toolRules` (shared) owns what a permission mode means for a
 * tool's baseline approval; the tool-policy snapshot owns the session's live catalog; this table
 * owns Cherry's cross-cutting conduct rules — input-, state-, and role-conditional overrides that
 * permission modes cannot pierce. A per-tool classification with no condition belongs in the
 * descriptor/registry layer, not here.
 */

import { loggerService } from '@logger'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'

const logger = loggerService.withContext('ClaudeCodeToolGuards')

export interface ToolGuardInteractionState {
  readonly currentTurn: 'none' | 'interactive' | 'headless'
  readonly userResponse: 'unavailable' | 'stream' | 'message'
}

/** Read-only per-invocation snapshot; every field is resolved at fire-time by the caller. */
export interface ToolGuardContext {
  readonly toolName: string
  readonly input: Readonly<Record<string, unknown>> | undefined
  readonly permissionMode: AgentPermissionMode | undefined
  readonly builtinRole: string | undefined
  /** Cherry-owned MCP servers mounted for this session (not role-derivable). */
  readonly mountedServers: ReadonlySet<string>
  /** Loaded plugin directories by manifest name, for conditions that resolve plugin-owned files. */
  readonly pluginDirectories: ReadonlyMap<string, string>
  readonly cwd: string
  readonly agentDataPath: string
  /** Whether the connection model accepts native image input. Undefined preserves legacy behavior. */
  readonly supportsImages?: boolean
  readonly interaction: ToolGuardInteractionState
  /** Live disabled predicate; returns false when no snapshot is bound (canUseTool fails closed). */
  readonly isDisabled: (toolName: string) => boolean
  /**
   * Live stuck-loop predicate for Bash; returns the identical-output run length when the command
   * is looping without progress, undefined when no history is bound or the run has not formed.
   */
  readonly bashNoProgressRun?: (command: string) => number | undefined
}

/** A condition match; `evidence` carries detector output for dynamic reasons. */
export interface GuardHit {
  evidence?: string
}

/**
 * Conditions must internalize their own failure posture (e.g. treat an unresolvable path as
 * outside); the evaluator additionally treats a thrown condition as a non-match.
 */
export type GuardCondition = (ctx: ToolGuardContext) => GuardHit | null | Promise<GuardHit | null>

export type GuardReason = string | ((hit: GuardHit, ctx: ToolGuardContext) => string)

export type HeadlessPredicate = 'responder-unavailable' | 'turn-headless' | 'either'

export interface HeadlessOverride {
  /** Which interaction facts make this turn "headless" for this rule — the three differ observably. */
  predicate: HeadlessPredicate
  reason: string
  /** Only skill-install: its headless deny is lifted by an explicit bypassPermissions opt-out. */
  skipHeadlessDenyInBypass?: true
}

interface ToolGuardRuleBase {
  id: string
  /** Scope to specific built-in roles; omit for a rule that applies to every agent. */
  appliesTo?: { roles: readonly string[] }
  /** `tool` and `when` AND together; at least one must be present. */
  match: { tool?: string; when?: GuardCondition }
  headless?: HeadlessOverride
}

/**
 * 'enforce': the effect applies in every permission mode, bypassPermissions included.
 * 'skipInteractiveEffect': bypassPermissions skips it (the user's explicit opt-out of per-call
 * approval); a `headless` override still applies unless the rule sets `skipHeadlessDenyInBypass`.
 *
 * Only declared by rules that have an `effect` — there is nothing for bypass to skip on a rule
 * whose only decision is a headless denial, which `skipHeadlessDenyInBypass` governs instead.
 */
type BypassBehavior = 'enforce' | 'skipInteractiveEffect'

export type ToolGuardRule = ToolGuardRuleBase &
  (
    | { effect: 'deny'; reason: GuardReason; bypassBehavior: BypassBehavior }
    | { effect: 'ask'; reason: GuardReason; bypassBehavior: BypassBehavior }
    | { effect?: undefined; bypassBehavior?: undefined; headless: HeadlessOverride }
  )

export interface ToolGuardDecision {
  effect: 'deny' | 'ask'
  reason: string
  ruleId: string
}

function appliesToAgent(rule: ToolGuardRule, ctx: ToolGuardContext): boolean {
  if (!rule.appliesTo) return true
  return ctx.builtinRole !== undefined && rule.appliesTo.roles.includes(ctx.builtinRole)
}

function matchesHeadlessPredicate(predicate: HeadlessPredicate, interaction: ToolGuardInteractionState): boolean {
  switch (predicate) {
    case 'responder-unavailable':
      return interaction.userResponse === 'unavailable'
    case 'turn-headless':
      return interaction.currentTurn === 'headless'
    case 'either':
      return interaction.currentTurn === 'headless' || interaction.userResponse === 'unavailable'
  }
}

async function matchRule(rule: ToolGuardRule, ctx: ToolGuardContext): Promise<GuardHit | null> {
  if (rule.match.tool && rule.match.tool !== ctx.toolName) return null
  if (!rule.match.when) return {}
  try {
    return await rule.match.when(ctx)
  } catch (error) {
    logger.error('Guard condition threw — treating as no match', { ruleId: rule.id, toolName: ctx.toolName, error })
    return null
  }
}

interface GuardCandidate extends ToolGuardDecision {
  index: number
}

/**
 * Evaluate the table for one tool call. Returns the folded decision, or undefined when no rule
 * decides — the runtime's ordinary permission-mode semantics then apply.
 */
export async function evaluateToolGuards(
  rules: readonly ToolGuardRule[],
  ctx: ToolGuardContext
): Promise<ToolGuardDecision | undefined> {
  const bypass = ctx.permissionMode === 'bypassPermissions'
  const candidates: GuardCandidate[] = []

  for (const [index, rule] of rules.entries()) {
    if (!appliesToAgent(rule, ctx)) continue
    const hit = await matchRule(rule, ctx)
    if (!hit) continue

    // The headless override is evaluated independently of the bypass skip: an unattended turn has
    // no responder in any mode, so its denials hold under bypassPermissions too (per-rule opt-out
    // excepted). A matching headless override supersedes the rule's own interactive effect.
    if (rule.headless && matchesHeadlessPredicate(rule.headless.predicate, ctx.interaction)) {
      if (!(bypass && rule.headless.skipHeadlessDenyInBypass)) {
        candidates.push({ effect: 'deny', reason: rule.headless.reason, ruleId: rule.id, index })
      }
      continue
    }

    if (rule.effect === undefined) continue
    if (bypass && rule.bypassBehavior === 'skipInteractiveEffect') continue
    const reason = typeof rule.reason === 'function' ? rule.reason(hit, ctx) : rule.reason
    candidates.push({ effect: rule.effect, reason, ruleId: rule.id, index })
  }

  if (candidates.length === 0) return undefined
  candidates.sort((a, b) => {
    if (a.effect !== b.effect) return a.effect === 'deny' ? -1 : 1
    return a.index - b.index
  })
  const { effect, reason, ruleId } = candidates[0]
  return { effect, reason, ruleId }
}

/** Structural table validation, asserted by tests so an invalid rule cannot ship silently. */
export function validateToolGuardRules(rules: readonly ToolGuardRule[]): string[] {
  const problems: string[] = []
  const seen = new Set<string>()
  for (const rule of rules) {
    if (seen.has(rule.id)) problems.push(`duplicate rule id: ${rule.id}`)
    seen.add(rule.id)
    if (!rule.match.tool && !rule.match.when) {
      problems.push(`rule ${rule.id} matches nothing (no tool, no condition)`)
    }
    if (rule.effect === undefined && !rule.headless) {
      problems.push(`rule ${rule.id} has neither an effect nor a headless override`)
    }
    if (rule.effect !== undefined && rule.headless?.skipHeadlessDenyInBypass && rule.bypassBehavior === 'enforce') {
      problems.push(`rule ${rule.id} enforces its effect under bypass but skips its headless deny there`)
    }
  }
  return problems
}
