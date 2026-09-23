import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export function successResponse(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    isError: false
  }
}

export function errorResponse(error: Error | string): CallToolResult {
  const message = error instanceof Error ? error.message : error
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  }
}
