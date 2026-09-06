import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export function successResponse(text: string): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    isError: false
  }
}

export function imageResponse(base64: string, mimeType = 'image/png'): CallToolResult {
  return {
    content: [{ type: 'image', data: base64, mimeType }],
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
