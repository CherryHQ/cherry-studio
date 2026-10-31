/**
 * Dependency-light error → string helpers.
 *
 * This module sits on every window's first-screen graph through the fatal
 * fallbacks (ErrorBoundary / WindowFatalFallback / RouteErrorFallback), so it
 * must never import the heavy error-classification bucket (zod, axios, ai,
 * agent schemas) — that lives in `./error`. Guarded by import-graph probes in
 * `__tests__/errorDetails.test.ts`.
 */
export function getErrorDetails(err: any, seen = new WeakSet()): any {
  if (err === null || typeof err !== 'object') {
    return err
  }

  // Error fallbacks must stay serializable even when a cause points back to its parent.
  if (seen.has(err)) return '[Circular]'

  seen.add(err)
  const result: any = {}

  // Get all enumerable properties, including those from the prototype chain
  const allProps = new Set([...Object.getOwnPropertyNames(err), ...Object.keys(err)])

  for (const prop of allProps) {
    try {
      const value = err[prop]
      // Skip function properties
      if (typeof value === 'function') continue
      // Recursively process nested objects
      result[prop] = getErrorDetails(value, seen)
    } catch (e) {
      result[prop] = '<Unable to access property>'
    }
  }

  seen.delete(err)
  return result
}

export function formatErrorDetails(error: unknown): string {
  const detailedError = getErrorDetails(error)
  delete detailedError?.headers
  delete detailedError?.stack
  delete detailedError?.request_id

  // A falsy/empty error (nullish, empty string, `throw undefined`, empty rejection)
  // has no detail to show — the caller's Alert still renders its generic message.
  if (!detailedError) {
    return ''
  }

  const formattedJson = JSON.stringify(detailedError, null, 2)
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n')
  return detailedError.message ? detailedError.message : `Error Details:\n${formattedJson}`
}
