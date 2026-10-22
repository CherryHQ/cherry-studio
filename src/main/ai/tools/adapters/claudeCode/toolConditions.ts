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

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { planClaudeMcpToolNames } from '@main/ai/mcp/mcpToolNames'
import { CLAUDE_TOOL_DEFS } from '@shared/ai/claudecode/toolRegistry'
import { buildClaudeMcpToolName, buildClaudeMcpWildcard } from '@shared/ai/claudecode/toolRules'

/** Raw session context the enable-predicates compute from (not pre-digested per-condition flags). */
export interface ClaudeToolContext {
  /** Session workspace directory. */
  cwd: string
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
  ExitWorktree: (ctx) => dirHasGit(ctx.cwd)
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
  agent: { disabledTools?: readonly string[] | null; mcps?: readonly string[] | null },
  ctx?: ClaudeToolContext,
  boundedMcpToolNames = false
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

  if (!boundedMcpToolNames) return [...blocked]
  const serverPlans = (agent.mcps ?? []).flatMap((mcpId) => {
    const server = mcpServerService.findByIdOrName(mcpId)
    if (!server) return []
    return [
      {
        server,
        mcpId,
        plan: planClaudeMcpToolNames({ serverId: server.id, sdkServerKey: mcpId }, []),
        tools: application.get('McpCatalogService').listTools(server.id)
      }
    ]
  })

  const translated = [...blocked].flatMap((rule) => {
    if (rule === 'mcp__*' || !rule.startsWith('mcp__') || registeredToolNames.has(rule)) return [rule]
    const delimiter = rule.indexOf('__', 'mcp__'.length)
    const segment = rule.slice('mcp__'.length, delimiter === -1 ? undefined : delimiter)
    const tail = delimiter === -1 ? undefined : rule.slice(delimiter + 2)
    // Canonical ownership must be settled across all mounts before considering display aliases.
    const owner =
      serverPlans.find(({ server }) => server.id === segment) ??
      serverPlans.find(({ mcpId }) => mcpId === segment) ??
      serverPlans.find(({ server }) => server.name === segment) ??
      serverPlans.find(
        ({ server, tools }) =>
          tools.some((tool) => rule === buildClaudeMcpToolName(server.name, tool.name)) ||
          buildClaudeMcpWildcard(server.name) === `mcp__${segment}__*`
      )
    if (!owner || tail === '') return [rule]
    const { server, plan, tools } = owner
    const allocated = (name: string) => `mcp__${plan.serverKey}__${plan.toolName(name)}`
    const compatibilityTool = tools.find((tool) => rule === buildClaudeMcpToolName(server.name, tool.name))
    if (compatibilityTool && !tools.some((tool) => tool.name === tail)) return [allocated(compatibilityTool.name)]
    if (tail === undefined || tail === '*') return [`mcp__${plan.serverKey}__*`]
    if (!tail.includes('*')) return [allocated(tail)]
    const pattern = new RegExp(
      `^${rule
        .split('*')
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*')}$`
    )
    return tools
      .filter(
        (tool) =>
          pattern.test(`mcp__${segment}__${tool.name}`) || pattern.test(buildClaudeMcpToolName(server.name, tool.name))
      )
      .map((tool) => allocated(tool.name))
  })
  return [...new Set(translated)]
}
