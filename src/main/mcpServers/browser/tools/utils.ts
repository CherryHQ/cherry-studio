export function successResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    isError: false
  }
}

export function errorResponse(error: Error | string) {
  const message = error instanceof Error ? error.message : error
  return {
    content: [{ type: 'text', text: message }],
    isError: true
  }
}
