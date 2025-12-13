import { loggerService } from '@logger'
import { transliterate } from 'transliteration'

const logger = loggerService.withContext('Utils:MCP')

/**
 * Transliterates non-ASCII text (including CJK characters) to ASCII-compatible format.
 *
 * Converts input text to lowercase ASCII representation, replacing spaces with underscores
 * and removing special characters. Unknown or special characters are replaced with underscores.
 *
 * @param text - The input string to transliterate, may contain Unicode characters including CJK
 * @returns A lowercase ASCII string with spaces converted to underscores and special characters removed,
 *          preserving only alphanumeric characters, underscores, and hyphens
 *
 * @example
 * ```typescript
 * transliterateToAscii("Hello World") // returns "hello_world"
 * transliterateToAscii("你好世界") // returns transliterated version with underscores
 * transliterateToAscii("Café-123") // returns "cafe-123"
 * ```
 */
function transliterateToAscii(text: string): string {
  // Input validation
  if (!text || typeof text !== 'string') {
    logger.warn('Invalid input to transliterateToAscii', { text })
    return ''
  }

  try {
    // Use transliteration library which supports CJK (Chinese, Japanese, Korean)
    const result = transliterate(text, {
      // Unknown/special characters become underscores
      unknown: '_',
      ignore: []
    })

    logger.debug('Transliteration successful', { input: text, output: result })

    // Convert to lowercase, remove spaces, and clean up special chars
    // Only preserve a-z, 0-9, underscores, and hyphens (OpenAI/Anthropic API compatible)
    return result
      .toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9_-]/g, '_')
  } catch (error) {
    logger.error('Transliteration failed, falling back to ASCII-only mode', { text, error })
    // Fallback: keep only ASCII alphanumeric and convert everything else to underscores
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
  }
}

export function buildFunctionCallToolName(serverName: string, toolName: string, serverId?: string) {
  // Input validation
  if (!serverName || typeof serverName !== 'string') {
    logger.warn('Invalid serverName provided', { serverName })
    serverName = 'server'
  }
  if (!toolName || typeof toolName !== 'string') {
    logger.warn('Invalid toolName provided', { toolName })
    toolName = 'tool'
  }

  // First, transliterate non-ASCII characters to ASCII
  const transliteratedServer = transliterateToAscii(serverName.trim())
  const transliteratedTool = transliterateToAscii(toolName.trim())

  const sanitizedServer = transliteratedServer.replace(/-/g, '_')
  const sanitizedTool = transliteratedTool.replace(/-/g, '_')

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

  // Replace invalid characters with underscores
  // Keep only a-z, 0-9, underscores, dashes (OpenAI/Anthropic API compatible)
  name = name.replace(/[^a-z0-9_-]/g, '_')

  // Ensure name starts with a letter or underscore (AI model requirement)
  if (!/^[a-z_]/.test(name)) {
    name = `tool_${name}`
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
