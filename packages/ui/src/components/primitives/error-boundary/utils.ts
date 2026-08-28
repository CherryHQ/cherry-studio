// Utility functions for ErrorBoundary component

export function formatErrorMessage(error: Error): string {
  if (error.message) {
    return error.message
  }
  return error.toString()
}
