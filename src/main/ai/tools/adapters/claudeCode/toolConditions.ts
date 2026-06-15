/**
 * Main-side runtime gating for Claude Code tools.
 *
 * The shared registry (`@shared/ai/claudecode/toolRegistry`) holds static tool data — exposure,
 * dependencies, category, display. The per-tool *enable predicates* live here because they compute
 * from the raw session context (file system, channels) which only main can read. The disallowed set
 * is derived from the static data + these predicates + a runtime context.
 */

import fs from 'node:fs'
import path from 'node:path'

import { CLAUDE_TOOL_DEFS } from '@shared/ai/claudecode/toolRegistry'

/** Raw session context the enable-predicates compute from (not pre-digested per-condition flags). */
export interface ClaudeToolContext {
  /** Session workspace directory. */
  cwd: string
  /** The agent's channels (pre-fetched — channel lookup is async; predicates read the list). */
  channels: readonly unknown[]
}

function dirHasGit(cwd: string): boolean {
  try {
    return fs.existsSync(path.join(cwd, '.git'))
  } catch {
    return false
  }
}

/**
 * Per-tool enable predicate over the raw session context. Only condition-gated tools appear here;
 * any tool absent from this table has no runtime gate. Table-driven: the predicate function is the
 * gate (no string condition labels / switch).
 */
const TOOL_ENABLE_PREDICATES: Record<string, (ctx: ClaudeToolContext) => boolean> = {
  EnterWorktree: (ctx) => dirHasGit(ctx.cwd),
  ExitWorktree: (ctx) => dirHasGit(ctx.cwd),
  mcp__claw__notify: (ctx) => ctx.channels.length > 0,
  mcp__claw__config: (ctx) => ctx.channels.length > 0
}

/**
 * Derive the SDK `disallowedTools` set from each tool's declarations:
 * - `exposure: 'disabled'`            → always blocked
 * - `exposure: 'user'` + user opt-out → blocked
 * - enable predicate returns false    → blocked (only evaluated when `ctx` is supplied)
 * - any `dependsOn` target is blocked → blocked (propagated to a fixpoint)
 *
 * Blocked tools are removed from the model's context entirely (hard block). `ctx` is optional:
 * without it, predicate-gated tools are treated as enabled (the policy layer before runtime facts
 * are known).
 */
export function resolveDisallowedTools(
  agent: { disabledTools?: readonly string[] | null },
  ctx?: ClaudeToolContext
): string[] {
  const userDisabled = new Set(agent.disabledTools ?? [])
  const registeredToolNames = new Set(CLAUDE_TOOL_DEFS.map((def) => def.name))
  const blocked = new Set<string>()

  for (const def of CLAUDE_TOOL_DEFS) {
    if (def.exposure === 'disabled') {
      blocked.add(def.name)
      continue
    }
    if (def.exposure === 'user' && userDisabled.has(def.name)) {
      blocked.add(def.name)
      continue
    }
    const predicate = TOOL_ENABLE_PREDICATES[def.name]
    if (predicate && ctx && !predicate(ctx)) blocked.add(def.name)
  }

  // Propagate dependencies: a tool whose dependency is blocked is blocked too. Loop to a fixpoint
  // so transitive chains resolve (cheap — the dependency graph is tiny).
  let changed = true
  while (changed) {
    changed = false
    for (const def of CLAUDE_TOOL_DEFS) {
      if (blocked.has(def.name)) continue
      if (def.dependsOn?.some((dep) => blocked.has(dep))) {
        blocked.add(def.name)
        changed = true
      }
    }
  }

  for (const toolName of userDisabled) {
    if (toolName.startsWith('mcp__') && !registeredToolNames.has(toolName)) blocked.add(toolName)
  }

  return [...blocked]
}
