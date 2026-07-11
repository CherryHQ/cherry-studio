/**
 * Dependency-light error → string helpers.
 *
 * This module sits on every window's first-screen graph through the fatal
 * fallbacks (ErrorBoundary / WindowFatalFallback / RouteErrorFallback), so it
 * must never import the heavy error-classification bucket (zod, axios, ai,
 * agent schemas) — that lives in `./error`. Guarded by import-graph probes in
 * `__tests__/errorDetails.test.ts`.
 */
import { loggerService } from '@logger'

const logger = loggerService.withContext('Utils:errorDetails')

export function getErrorDetails(err: any, seen = new WeakSet()): any {
  // Handle circular references
  if (err === null || typeof err !== 'object' || seen.has(err)) {
    return err
  }

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

  return result
}

export function formatErrorDetails(error: unknown): string {
  const detailedError = getErrorDetails(error)
  delete detailedError?.headers
  delete detailedError?.stack
  delete detailedError?.request_id

  if (detailedError) {
    const formattedJson = JSON.stringify(detailedError, null, 2)
      .split('\n')
      .map((line) => `  ${line}`)
      .join('\n')
    return detailedError.message ? detailedError.message : `Error Details:\n${formattedJson}`
  } else {
    logger.warn('Get detailed error failed.')
    return ''
  }
}
