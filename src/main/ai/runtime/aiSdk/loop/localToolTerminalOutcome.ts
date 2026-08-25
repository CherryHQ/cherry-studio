/**
 * Process-local provenance for terminal failures produced by trusted local tools.
 * The WeakSet brand stays off the wire shape, so provider and MCP outputs cannot
 * forge a loop-stopping result by returning matching JSON.
 */

export interface TerminalToolFailure {
  error: string
  userMessage?: string
  i18nKey?: string
}

const trustedTerminalFailures = new WeakSet<object>()

type TerminalFailureOutput = {
  terminal: true
  retryable: false
  error: string
  userMessage?: unknown
  i18nKey?: unknown
}

function isTerminalFailureOutput(output: unknown): output is TerminalFailureOutput {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) return false

  const candidate = output as Record<string, unknown>
  return candidate.terminal === true && candidate.retryable === false && typeof candidate.error === 'string'
}

/** Preserve output identity and brand it only when it has the terminal failure shape. */
export function markTrustedLocalToolTerminalFailure<T>(output: T): T {
  if (isTerminalFailureOutput(output)) trustedTerminalFailures.add(output)
  return output
}

export function getTrustedLocalToolTerminalFailure(output: unknown): TerminalToolFailure | undefined {
  if (!isTerminalFailureOutput(output) || !trustedTerminalFailures.has(output)) return undefined

  return {
    error: output.error,
    ...(typeof output.userMessage === 'string' && { userMessage: output.userMessage }),
    ...(typeof output.i18nKey === 'string' && { i18nKey: output.i18nKey })
  }
}
