import { isDeepStrictEqual } from 'node:util'

import type { CallToolResult } from '@modelcontextprotocol/server'

/** Serve an AI-SDK text/json tool output as MCP text content; the inverse of `mcpResultToModelOutput`. */
export function modelOutputToMcpResult(
  output: { type: 'text'; value: string } | { type: 'json'; value: unknown }
): CallToolResult {
  return { content: [{ type: 'text', text: output.type === 'text' ? output.value : JSON.stringify(output.value) }] }
}

/** v1 accepts only objects in structuredContent; its text fallback carries other JSON values. */
export function mcpLegacyResult(result: CallToolResult) {
  const { structuredContent, ...rest } = result
  const legacy: CallToolResult = { ...rest, content: mcpModelContent(result) }

  if (structuredContent !== null && typeof structuredContent === 'object' && !Array.isArray(structuredContent)) {
    legacy.structuredContent = structuredContent
  }

  return legacy
}

/** Include structured results in model-visible content without repeating a server's JSON text fallback. */
export function mcpModelContent<T extends { type: string }>(result: {
  content: T[]
  structuredContent?: unknown
}): Array<T | { type: 'text'; text: string }> {
  if (result.structuredContent === undefined) return result.content

  const alreadyIncluded = result.content.some((part) => {
    if (part.type !== 'text' || !('text' in part) || typeof part.text !== 'string') return false

    try {
      return isDeepStrictEqual(JSON.parse(part.text), result.structuredContent)
    } catch {
      return false
    }
  })

  return alreadyIncluded
    ? result.content
    : [...result.content, { type: 'text', text: JSON.stringify(result.structuredContent) }]
}
