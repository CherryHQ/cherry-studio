export const ALLOWED_MCP_SERVER_COMMANDS = ['npx', 'uvx', 'uv', 'bunx', 'bun'] as const

const MCP_COMMAND_EXTENSION_REGEX = /\.(exe|cmd|bat|com)$/i

const normalizeCommand = (command: string): string => {
  const trimmed = command.trim().toLowerCase()
  if (!trimmed) {
    return trimmed
  }
  return trimmed.replace(MCP_COMMAND_EXTENSION_REGEX, '')
}

export const normalizeMcpCommand = (command: string): string => normalizeCommand(command)

export const isAllowedMcpCommand = (command?: string | null): boolean => {
  if (!command) {
    return false
  }
  const normalized = normalizeCommand(command)
  if (!normalized) {
    return false
  }
  return ALLOWED_MCP_SERVER_COMMANDS.includes(normalized as (typeof ALLOWED_MCP_SERVER_COMMANDS)[number])
}

export function buildFunctionCallToolName(serverName: string, toolName: string) {
  const sanitizedServer = serverName.trim().replace(/-/g, '_')
  const sanitizedTool = toolName.trim().replace(/-/g, '_')

  // Combine server name and tool name
  let name = sanitizedTool
  if (!sanitizedTool.includes(sanitizedServer.slice(0, 7))) {
    name = `${sanitizedServer.slice(0, 7) || ''}-${sanitizedTool || ''}`
  }

  // Replace invalid characters with underscores or dashes
  // Keep a-z, A-Z, 0-9, underscores and dashes
  name = name.replace(/[^a-zA-Z0-9_-]/g, '_')

  // Ensure name starts with a letter or underscore (for valid JavaScript identifier)
  if (!/^[a-zA-Z]/.test(name)) {
    name = `tool-${name}`
  }

  // Remove consecutive underscores/dashes (optional improvement)
  name = name.replace(/[_-]{2,}/g, '_')

  // Truncate to 63 characters maximum
  if (name.length > 63) {
    name = name.slice(0, 63)
  }

  // Handle edge case: ensure we still have a valid name if truncation left invalid chars at edges
  if (name.endsWith('_') || name.endsWith('-')) {
    name = name.slice(0, -1)
  }

  return name
}
