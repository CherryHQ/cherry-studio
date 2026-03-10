/**
 * Configuration for an internal MCP server injected by agent services.
 * These get merged into the SDK's mcpServers option alongside user-configured MCPs.
 */
export type InternalMcpServerConfig = {
  type: 'http'
  url: string
  headers?: Record<string, string>
}
