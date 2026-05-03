/**
 * Central permission pipeline.
 *
 * Five layers, evaluated in order:
 *   L1  shouldAutoApprove        → 'allow' (env override / bypass / built-in defaults)
 *   L2  deny rules               → 'deny'   (user-configured, walks all rules)
 *   L3  tool.checkPermissions    → 'allow' / 'deny' / 'ask' / 'passthrough'
 *   L4  allow rules              → 'allow'
 *   L5  default                  → 'ask'
 *
 * Deny ALWAYS wins over allow — at the rule level (L2 before L4) and at
 * the layer level (a tool hook returning 'deny' short-circuits before we
 * ever consult allow rules). This mirrors Claude Code's design.
 */

import { shouldAutoApprove } from '../../services/toolApproval/autoApprovePolicy'
import { type MatcherRegistry, toolMatchesRule } from './matcher'
import { loadRules } from './rules'
import type { PermissionContext, PermissionDecision } from './types'

export interface ToolRegistryLike {
  getByName(name: string): { checkPermissions?: ToolCheckPermissions } | undefined
}

export type ToolCheckPermissions = (
  input: unknown,
  ctx: PermissionContext
) => Promise<PermissionDecision> | PermissionDecision

export interface CheckToolPermissionDeps {
  matcherRegistry: MatcherRegistry
  toolRegistry: ToolRegistryLike
}

export async function checkToolPermission(
  toolName: string,
  input: unknown,
  ctx: PermissionContext,
  deps: CheckToolPermissionDeps
): Promise<PermissionDecision> {
  // L1: env override / bypass / built-in defaults
  if (shouldAutoApprove({ toolKind: ctx.toolKind, toolName })) {
    return { behavior: 'allow' }
  }

  const rules = await loadRules()

  // L2: deny rules (walk all; first match wins)
  for (const rule of rules) {
    if (rule.behavior !== 'deny') continue
    if (toolMatchesRule(toolName, input, rule, ctx, deps.matcherRegistry)) {
      return { behavior: 'deny', reason: `Denied by rule ${rule.id}` }
    }
  }

  // L3: tool-specific opinion. `passthrough` (or absence) means "no opinion".
  const entry = deps.toolRegistry.getByName(toolName)
  if (entry?.checkPermissions) {
    try {
      const decision = await entry.checkPermissions(input, ctx)
      if (decision.behavior !== 'passthrough') return decision
    } catch (err) {
      // Defensive: a buggy tool hook shouldn't crash the pipeline.
      // Fail safe → ask.
      return {
        behavior: 'ask',
        reason: `tool hook threw: ${err instanceof Error ? err.message : String(err)}`
      }
    }
  }

  // L4: allow rules
  for (const rule of rules) {
    if (rule.behavior !== 'allow') continue
    if (toolMatchesRule(toolName, input, rule, ctx, deps.matcherRegistry)) {
      return { behavior: 'allow' }
    }
  }

  // L5: default
  return { behavior: 'ask' }
}
