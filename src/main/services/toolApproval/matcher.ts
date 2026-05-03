/**
 * Tool-agnostic rule matcher.
 *
 * Three checks in order:
 *   1. Tool name matches: exact, or `mcp__server` matches any `mcp__server__*`.
 *   2. Scope matches: if `rule.scope.cwd` set, must equal `ctx.cwd`.
 *   3. Content matches: if `rule.ruleContent` undefined → match. Else delegate
 *      to the per-tool ContentMatcher registered under `toolName`. If no
 *      matcher is registered, fail closed (return false) — we can't verify
 *      the content, so refuse to assume a match.
 *
 * Each tool with content semantics (shell uses bash patterns, fs__patch
 * uses path globs) registers its matcher at startup.
 */

import type { PermissionContext, PermissionRule } from './types'

export type ContentMatcher = (input: unknown, ruleContent: string, ctx: PermissionContext) => boolean

export interface MatcherRegistry {
  register(toolName: string, matcher: ContentMatcher): void
  get(toolName: string): ContentMatcher | undefined
}

export function createMatcherRegistry(): MatcherRegistry {
  const matchers = new Map<string, ContentMatcher>()
  return {
    register: (toolName, matcher) => {
      matchers.set(toolName, matcher)
    },
    get: (toolName) => matchers.get(toolName)
  }
}

/**
 * Process-wide singleton consumed by the central pipeline. Tools register
 * their content matcher here at boot (alongside their `ToolEntry`).
 * Tests construct fresh registries via `createMatcherRegistry()` and
 * inject them via `checkToolPermission`'s `deps`.
 */
export const matcherRegistry: MatcherRegistry = createMatcherRegistry()

export function toolMatchesRule(
  toolName: string,
  input: unknown,
  rule: PermissionRule,
  ctx: PermissionContext,
  registry: MatcherRegistry
): boolean {
  if (!toolNameMatches(toolName, rule.toolName)) return false

  if (rule.scope?.cwd !== undefined) {
    if (ctx.cwd !== rule.scope.cwd) return false
  }

  if (rule.ruleContent === undefined) return true

  const matcher = registry.get(toolName)
  if (!matcher) return false
  return matcher(input, rule.ruleContent, ctx)
}

function toolNameMatches(actual: string, ruleName: string): boolean {
  if (actual === ruleName) return true
  // MCP server-wide rule: `mcp__server` matches any `mcp__server__<tool>`.
  if (ruleName.startsWith('mcp__') && actual.startsWith(`${ruleName}__`)) return true
  return false
}
