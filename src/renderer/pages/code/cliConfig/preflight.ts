import type { ClaudePreflightResult } from '@shared/ipc/schemas/codeCli'

export class ClaudeConfigPreflightError extends Error {
  constructor(
    readonly category: Exclude<ClaudePreflightResult['category'], 'ok'>,
    readonly statusCode: number | null
  ) {
    super(`Claude Code endpoint preflight failed: ${category}${statusCode === null ? '' : ` (HTTP ${statusCode})`}`)
    this.name = 'ClaudeConfigPreflightError'
  }
}

export function cliConfigApplyErrorKey(error: unknown): string {
  if (!(error instanceof ClaudeConfigPreflightError)) return 'code.apply_failed'

  switch (error.category) {
    case 'route':
      return 'code.claude_preflight.route_error'
    case 'authentication':
      return 'code.claude_preflight.authentication_error'
    case 'model':
      return 'code.claude_preflight.model_error'
    case 'service':
      return 'code.claude_preflight.service_error'
  }
}
