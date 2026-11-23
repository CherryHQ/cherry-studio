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

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Filesystem and database operations can reject arbitrary values; only a readable string code is needed for recovery or privacy-safe diagnostics.
export function getErrorCode(error: unknown): string | undefined {
  try {
    if (error === null || (typeof error !== 'object' && typeof error !== 'function')) return undefined

    // oxlint-disable-next-line anti-slop/no-reflect-get -- Read virtual Proxy codes without requiring a has trap; the surrounding catch contains unreadable properties.
    const code = Reflect.get(error, 'code')

    return typeof code === 'string' ? code : undefined
  } catch {
    return undefined
  }
}
