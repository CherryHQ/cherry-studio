export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

export function successResponse(text: string) {
  return {
    content: [{ type: 'text' as const, text }],
    isError: false
  }
}

export function imageResponse(base64: string, mimeType = 'image/png') {
  return {
    content: [{ type: 'image' as const, data: base64, mimeType }],
    isError: false
  }
}

export function errorResponse(error: Error | string) {
  const message = error instanceof Error ? error.message : error
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true
  }
}
