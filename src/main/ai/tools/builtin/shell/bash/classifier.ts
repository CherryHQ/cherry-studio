/**
 * Bash command classifier — Layer 3 of the central permission pipeline.
 *
 * Consumes a parsed `BashAst` and emits a `PermissionDecision`:
 *
 *   parse failure | denylist hit       → 'deny'
 *   command substitution present       → 'ask' (hidden inner command)
 *   every command allowlisted           → 'allow'
 *   otherwise                           → 'passthrough' (defer to rules)
 *
 * Worst-of for compound commands: any 'deny' wins over everything; any
 * 'passthrough' wins over 'allow'; 'ask' from substitution is overridden
 * by 'deny' but trumps 'passthrough'/'allow'.
 *
 * For 'ask' / 'passthrough' decisions, the classifier suggests a default
 * rule pattern the renderer's "Allow always" affordance can offer.
 */

import type { PermissionDecision } from '@main/services/toolApproval/types'

import { SHELL_EXEC_TOOL_NAME } from '../exec'
import { isAllowed } from './allowlist'
import { isDenied } from './denylist'
import type { BashAst, SimpleCommand } from './parser'
import { stripWrappers } from './wrappers'

type CommandVerdict = 'allow' | 'deny' | 'passthrough'

export function classifyBash(ast: BashAst): PermissionDecision {
  if (ast.hasUnknown) {
    return { behavior: 'deny', reason: 'Could not parse bash command; refusing to run.' }
  }

  let aggregate: CommandVerdict = 'allow'
  for (const raw of ast.commands) {
    const stripped = stripWrappers(raw)
    if (!stripped) {
      // Wrapper with no payload → can't classify → fail closed.
      return { behavior: 'deny', reason: `Could not interpret '${raw.name}' wrapper without an inner command.` }
    }
    if (isDenied(stripped)) {
      return { behavior: 'deny', reason: `'${stripped.name}' is on the denylist.` }
    }
    if (!isAllowed(stripped)) aggregate = 'passthrough'
  }

  // 'deny' has already short-circuited above. Substitution downgrades
  // 'allow' (and 'passthrough') to 'ask': we can't see the substituted
  // command's classification, so we won't honor a blanket allow rule
  // either — force the user to look at it.
  if (ast.hasCommandSubstitution) {
    return {
      behavior: 'ask',
      reason: 'Command contains a substitution ($(...) or backticks); please review.',
      suggestedRule: { toolName: SHELL_EXEC_TOOL_NAME, ruleContent: ast.source.trim() }
    }
  }

  if (aggregate === 'allow') return { behavior: 'allow' }
  return {
    behavior: 'passthrough',
    suggestedRule: { toolName: SHELL_EXEC_TOOL_NAME, ruleContent: suggestPattern(ast.commands) }
  }
}

/**
 * Suggest a sensible "Allow always" pattern. For a single simple command,
 * use `<name> <subcommand>:*` so future invocations with different args
 * still match. For pipelines / multi-command, fall back to the literal
 * source (the user can edit before saving).
 */
function suggestPattern(commands: SimpleCommand[]): string {
  if (commands.length === 1) {
    const c = commands[0]
    const head = c.args[0]
    // Subcommand-shaped tools: include the subcommand in the pattern.
    if (head && /^[a-z][a-z0-9_-]*$/i.test(head)) {
      return `${c.name} ${head}:*`
    }
    return `${c.name}:*`
  }
  return commands.map((c) => [c.name, ...c.args].join(' ')).join(' && ')
}
