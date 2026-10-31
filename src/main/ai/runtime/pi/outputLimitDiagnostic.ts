/** Facts from the final truncated response, never inferred from visible text length. */
export interface PiOutputLimitDiagnostic {
  configuredMaxTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

function tokenCount(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? String(Math.floor(value)) : 'unknown'
}

export function formatPiOutputLimitDiagnostic(details: PiOutputLimitDiagnostic): string {
  const reasoning =
    details.reasoningTokens === undefined
      ? ''
      : `; provider-reported reasoning tokens: ${tokenCount(details.reasoningTokens)}`
  return `Response truncated (stopReason: length). Configured maximum output: ${tokenCount(details.configuredMaxTokens)} tokens; provider-reported output tokens: ${tokenCount(details.outputTokens)}${reasoning}. The reply may be incomplete or empty. Continue the turn, or review Settings > Providers > model edit > Max output tokens. Changing this model setting affects all sessions using it and can increase cost and latency; use a limit supported by your provider. No output limit was increased automatically.`
}
