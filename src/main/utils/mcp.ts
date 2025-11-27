export function buildFunctionCallToolName(serverName: string, toolName: string, serverId?: string) {
  const sanitizedServer = serverName.trim().replace(/-/g, '_')
  const sanitizedTool = toolName.trim().replace(/-/g, '_')

  // Calculate suffix first to reserve space for it
  // Suffix format: "_" + 6 alphanumeric chars = 7 chars total
  let serverIdSuffix = ''
  if (serverId) {
    // Take the last 6 characters of the serverId for brevity
    serverIdSuffix = serverId.slice(-6).replace(/[^a-zA-Z0-9]/g, '')

    // Fallback: if suffix becomes empty (all non-alphanumeric chars), use a simple hash
    if (!serverIdSuffix) {
      const hash = serverId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
      serverIdSuffix = hash.toString(36).slice(-6) || 'x'
    }
  }

  // Reserve space for suffix when calculating max base name length
  const SUFFIX_LENGTH = serverIdSuffix ? serverIdSuffix.length + 1 : 0 // +1 for underscore
  const MAX_BASE_LENGTH = 63 - SUFFIX_LENGTH

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

  // Truncate base name BEFORE adding suffix to ensure suffix is never cut off
  if (name.length > MAX_BASE_LENGTH) {
    name = name.slice(0, MAX_BASE_LENGTH)
  }

  // Handle edge case: ensure we still have a valid name if truncation left invalid chars at edges
  if (name.endsWith('_') || name.endsWith('-')) {
    name = name.slice(0, -1)
  }

  // Now append the suffix - it will always fit within 63 chars
  if (serverIdSuffix) {
    name = `${name}_${serverIdSuffix}`
  }

  return name
}
