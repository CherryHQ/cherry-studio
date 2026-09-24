import { isDeepStrictEqual } from 'node:util'

import type { McpCallToolResponse } from './types'

/** v1 accepts only objects in structuredContent; its text fallback carries other JSON values. */
export function mcpLegacyResult(result: McpCallToolResponse) {
  const { structuredContent, ...rest } = result
  return {
    ...rest,
    content: mcpModelContent(result),
    ...(structuredContent !== null && typeof structuredContent === 'object' && !Array.isArray(structuredContent)
      ? { structuredContent: structuredContent as Record<string, unknown> }
      : {})
  }
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
