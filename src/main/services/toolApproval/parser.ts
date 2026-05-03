/**
 * Permission rule string ↔ object parser.
 *
 * Grammar:
 *   <ToolDisplayName>(<ruleContent>)        // pattern with content
 *   <ToolDisplayName>                        // whole-tool match (no parens)
 *   mcp__<server>__<tool>                    // MCP exact tool
 *   mcp__<server>                            // MCP server-wide
 *
 * Display names map to registry names so users author rules in compact /
 * familiar form (`Bash(git status)`) while storage uses canonical
 * registry names (`shell__exec`).
 *
 * Parser is strict by design:
 *   - empty content `Bash()` rejected — use `Bash` for whole-tool
 *   - case-sensitive display names
 *   - whitespace inside content preserved (semantic for bash patterns)
 *   - nested parens inside content allowed; only the OUTER pair is the
 *     envelope — implementation just requires `endsWith(')')` after the
 *     first `(`
 */
// TODO: SHARED
const DISPLAY_TO_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  Bash: 'shell__exec',
  Read: 'fs__read',
  Edit: 'fs__patch',
  Find: 'fs__find',
  Grep: 'fs__grep',
  Web: 'web__search',
  Kb: 'kb__search'
})

const REGISTRY_TO_DISPLAY: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(DISPLAY_TO_REGISTRY).map(([d, r]) => [r, d]))
)

export type ParsedRulePattern = { toolName: string; ruleContent?: string }
export type ParseResult = { ok: true; value: ParsedRulePattern } | { ok: false; error: string }

export function parsePermissionRuleString(s: string): ParseResult {
  const trimmed = s.trim()
  if (trimmed === '') return fail('Pattern is empty.')

  // mcp__* tool / server name — registry name passes through unchanged.
  if (trimmed.startsWith('mcp__')) {
    if (trimmed === 'mcp__') return fail('Malformed mcp prefix; expected `mcp__<server>` or `mcp__<server>__<tool>`.')
    if (trimmed.includes('(')) {
      return fail('MCP rules do not take a content pattern; use the fully-qualified tool name.')
    }
    return ok({ toolName: trimmed, ruleContent: undefined })
  }

  const parenIdx = trimmed.indexOf('(')
  if (parenIdx === -1) {
    if (/\s/.test(trimmed)) return fail('Tool name contains whitespace.')
    const registry = DISPLAY_TO_REGISTRY[trimmed]
    if (!registry) return fail(`Unknown tool: ${trimmed}`)
    return ok({ toolName: registry, ruleContent: undefined })
  }

  const display = trimmed.slice(0, parenIdx)
  if (/\s/.test(display)) return fail('Tool name contains whitespace.')
  const registry = DISPLAY_TO_REGISTRY[display]
  if (!registry) return fail(`Unknown tool: ${display}`)

  if (!trimmed.endsWith(')')) {
    if (!trimmed.includes(')', parenIdx + 1)) return fail('Missing closing parenthesis.')
    return fail('Trailing content after closing parenthesis.')
  }

  const content = trimmed.slice(parenIdx + 1, -1)
  if (content === '') {
    return fail('Empty content; use the whole-tool form (no parens) instead.')
  }
  return ok({ toolName: registry, ruleContent: content })
}

export function serializePermissionRuleString(rule: ParsedRulePattern): string {
  if (rule.toolName.startsWith('mcp__')) return rule.toolName
  const display = REGISTRY_TO_DISPLAY[rule.toolName]
  if (!display) {
    throw new Error(`No display alias for toolName: ${rule.toolName}`)
  }
  return rule.ruleContent === undefined ? display : `${display}(${rule.ruleContent})`
}

function ok(value: ParsedRulePattern): { ok: true; value: ParsedRulePattern } {
  return { ok: true, value }
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error }
}
