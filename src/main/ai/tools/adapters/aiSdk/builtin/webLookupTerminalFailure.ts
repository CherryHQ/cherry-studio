/**
 * Process-local provenance for terminal failures produced by Cherry Studio's builtin web tools.
 * A WeakSet keeps the marker off the JSON wire shape, so MCP/provider outputs cannot forge it and
 * the existing tool output schemas and renderer payloads remain unchanged.
 */

const trustedTerminalFailures = new WeakSet<object>()

function isTerminalFailure(output: unknown): output is object {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return false

  const candidate = output as Record<string, unknown>
  return candidate.terminal === true && candidate.retryable === false && typeof candidate.error === 'string'
}

export function markTrustedWebLookupTerminalFailure<T>(output: T): T {
  if (isTerminalFailure(output)) trustedTerminalFailures.add(output)
  return output
}

export function isTrustedWebLookupTerminalFailure(output: unknown): output is object {
  return isTerminalFailure(output) && trustedTerminalFailures.has(output)
}
