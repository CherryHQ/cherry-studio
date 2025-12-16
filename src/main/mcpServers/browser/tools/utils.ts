export function successResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    isError: false
  }
}

export function errorResponse(error: Error) {
  return {
    content: [{ type: 'text', text: error.message }],
    isError: true
  }
}
