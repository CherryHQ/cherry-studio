// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Abort classification receives caught filesystem and request failures; recognize the name field without assuming every rejection is an Error instance.
export function isAbortError(error: unknown): boolean {
  return !!(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Main-process catches can contain arbitrary rejection values or malformed Error.message fields; conversion failures must not replace the caller's error response.
export function getErrorMessage(error: unknown, fallback: string): string {
  try {
    return String(error instanceof Error ? error.message : error)
  } catch {
    return fallback
  }
}
