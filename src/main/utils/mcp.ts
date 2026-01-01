/**
 * Builds a valid JavaScript function name for MCP tool calls.
 * Format: mcp__{server_name}__{tool_name}
 *
 * @param serverName - The MCP server name
 * @param toolName - The tool name from the server
 * @returns A valid JS identifier in format mcp__{server}__{tool}, max 63 chars
 */
export function buildFunctionCallToolName(serverName: string, toolName: string): string {
  // Sanitize to valid JS identifier chars (alphanumeric + underscore only)
  const sanitize = (str: string): string =>
    str
      .trim()
      .replace(/[^a-zA-Z0-9]/g, '_') // Replace all non-alphanumeric with underscore
      .replace(/_{2,}/g, '_') // Collapse multiple underscores
      .replace(/^_+|_+$/g, '') // Trim leading/trailing underscores

  const server = sanitize(serverName).slice(0, 20) // Keep server name short
  const tool = sanitize(toolName).slice(0, 35) // More room for tool name

  let name = `mcp__${server}__${tool}`

  // Ensure max 63 chars and clean trailing underscores
  if (name.length > 63) {
    name = name.slice(0, 63).replace(/_+$/, '')
  }

  return name
}
