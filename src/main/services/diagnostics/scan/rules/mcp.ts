import type { ScanRule } from '../types'

/** MCP server lifecycle failures. */
export const mcpRules: readonly ScanRule[] = [
  {
    id: 'mcp-connection-closed',
    domain: 'mcp',
    attribution: 'user-fixable',
    devMessage:
      'An MCP server dropped its connection or never started (JSON-RPC -32000 "Connection closed"); the server command is missing, crashed, or misconfigured.',
    modules: ['Mcp', 'McpServer', 'McpRuntimeService'],
    anchors: [/MCP error\s*-32000|-32000[\s\S]{0,60}Connection closed|Connection closed[\s\S]{0,60}MCP/i]
  }
]
