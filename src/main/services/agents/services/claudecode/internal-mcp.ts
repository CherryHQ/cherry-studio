import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

/**
 * HTTP-based MCP server config (connects over network).
 */
export type InternalMcpHttpServerConfig = {
  type: 'http'
  url: string
  headers?: Record<string, string>
}

/**
 * In-memory MCP server config (runs in-process via McpServer instance).
 */
export type InternalMcpInMemServerConfig = {
  type: 'inmem'
  instance: McpServer
}

/**
 * Configuration for an internal MCP server injected by agent services.
 * These get merged into the SDK's mcpServers option alongside user-configured MCPs.
 */
export type InternalMcpServerConfig = InternalMcpHttpServerConfig | InternalMcpInMemServerConfig
