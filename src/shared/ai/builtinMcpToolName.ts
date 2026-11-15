import type { AgentType } from '@shared/data/types/agent'

export type BuiltinMcpServerName = 'cherry-tools' | 'agent-memory' | 'skills'

export function buildBuiltinMcpToolName(
  runtime: AgentType,
  tool: { serverName: BuiltinMcpServerName; toolName: string }
): string {
  const id = `mcp__${tool.serverName}__${tool.toolName}`
  return runtime === 'claude-code' ? id : id.replace(/[^A-Za-z0-9_]/g, '_')
}
