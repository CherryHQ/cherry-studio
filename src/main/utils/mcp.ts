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
