export function isAbortError(error: unknown): boolean {
  return !!(error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'AbortError')
}
