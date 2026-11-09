import { AsyncLocalStorage } from 'node:async_hooks'

const suppressed = new AsyncLocalStorage<true>()

/** Suppress diagnostics for this operation and its async descendants, without changing global settings. */
export function withoutDiagnostics<T>(operation: () => T): T {
  return suppressed.run(true, operation)
}

export function areDiagnosticsSuppressed(): boolean {
  return suppressed.getStore() === true
}
