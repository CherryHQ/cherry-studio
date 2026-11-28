import { t } from '@main/i18n'

/** Facts from the final truncated response, never inferred from visible text length. */
export interface PiOutputLimitDiagnostic {
  configuredMaxTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

function tokenCount(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? String(Math.floor(value))
    : t('agent.session.pi.output_limit_unknown')
}

export function formatPiOutputLimitDiagnostic(details: PiOutputLimitDiagnostic): string {
  const reasoning =
    details.reasoningTokens === undefined
      ? ''
      : t('agent.session.pi.output_limit_reasoning', { count: tokenCount(details.reasoningTokens) })
  return t('agent.session.pi.output_limit_diagnostic', {
    configured: tokenCount(details.configuredMaxTokens),
    output: tokenCount(details.outputTokens),
    reasoning
  })
}
