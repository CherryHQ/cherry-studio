import { getToolName, isToolUIPart, type UIMessage } from 'ai'

import { CHERRY_MCP_SERVER } from '@main/ai/toolApproval/builtinToolPolicyRegistry'
import { trackMainProductEvent } from '@main/services/productAnalytics'
import { CLAUDE_TOOL_DEFS } from '@shared/ai/claudecode/toolRegistry'
import { PI_BUILTIN_TOOLS, PI_TOOL_CALL_TOOL_NAME } from '@shared/ai/piBuiltinTools'

/** Static label for a Computer Use application approval; the application itself is never reported. */
export const COMPUTER_USE_APP_APPROVAL = 'computer_use_app'

const PI_META_TOOLS = [
  'AskUserQuestion',
  'todo_write',
  'get_goal',
  'create_goal',
  'update_goal',
  'subagent',
  'message_subagent',
  'stop_subagent'
]

const BUILTIN_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...CLAUDE_TOOL_DEFS.map((def) => def.name),
  ...PI_BUILTIN_TOOLS.map((tool) => tool.name),
  PI_TOOL_CALL_TOOL_NAME,
  ...PI_META_TOOLS,
  'Skill',
  COMPUTER_USE_APP_APPROVAL
])

// Pi rewrites MCP names to [A-Za-z0-9_], so built-in servers also appear with underscores.
const BUILTIN_MCP_SERVERS: ReadonlySet<string> = new Set(
  Object.values(CHERRY_MCP_SERVER).flatMap((server) => [server, server.replace(/[^A-Za-z0-9_]/g, '_')])
)

const SUBAGENT_TOOLS = new Set(['Task', 'Agent', 'subagent'])
const STATIC_TOOL_NAME = /^[A-Za-z0-9_.:-]{1,80}$/
// Chat wire ids end in a digest of the server id and slug its display name, so a match proves nothing.
const MCP_WIRE_ID_DIGEST = /_[0-9a-f]{20}$/

/** A reportable tool name: built-in names as-is, user MCP tools as 'mcp_custom', anything else 'other'. */
export function analyticsToolName(name: string): string {
  if (BUILTIN_TOOL_NAMES.has(name)) return name
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
  if (mcp) {
    const trusted = BUILTIN_MCP_SERVERS.has(mcp[1]) && !MCP_WIRE_ID_DIGEST.test(name) && STATIC_TOOL_NAME.test(name)
    return trusted ? name : 'mcp_custom'
  }
  return 'other'
}

export type AgentTurnToolSummary = {
  toolCallCount: number
  toolErrorCount: number
  subagentCount: number
  skillCount: number
  tools: Record<`tool:${string}`, number>
}

export function summarizeAgentTurnTools(parts: UIMessage['parts'] | undefined): AgentTurnToolSummary {
  const summary: AgentTurnToolSummary = {
    toolCallCount: 0,
    toolErrorCount: 0,
    subagentCount: 0,
    skillCount: 0,
    tools: {}
  }
  for (const part of parts ?? []) {
    if (!isToolUIPart(part)) continue
    const name = getToolName(part)
    const key = `tool:${analyticsToolName(name)}` as const
    summary.toolCallCount += 1
    summary.tools[key] = (summary.tools[key] ?? 0) + 1
    if (part.state === 'output-error') summary.toolErrorCount += 1
    if (SUBAGENT_TOOLS.has(name)) summary.subagentCount += 1
    if (name === 'Skill') summary.skillCount += 1
  }
  return summary
}

/** A user's answer to a tool approval, or 'aborted' when the turn ended without one. */
export function trackToolApproval(
  surface: 'agent' | 'chat',
  toolName: string,
  decision: { approved: boolean; applicationScope?: 'always' | 'session' | 'reject' } | 'aborted',
  registeredAt?: number
): void {
  trackMainProductEvent({
    event: 'tool_approval',
    surface,
    decision:
      decision === 'aborted'
        ? 'aborted'
        : !decision.approved
          ? 'denied'
          : decision.applicationScope === 'always' || decision.applicationScope === 'session'
            ? decision.applicationScope
            : 'approved',
    tool: analyticsToolName(toolName),
    ...(registeredAt !== undefined && { waitMs: Math.max(0, Date.now() - registeredAt) })
  })
}
