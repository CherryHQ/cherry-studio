export type SignInPhase = 'discovery' | 'authorization' | 'callback' | 'exchange' | 'persist'

export type SignInFailureReason =
  | 'network'
  | 'request_timeout'
  | 'callback_timeout'
  | 'browser_open_failed'
  | 'http_error'
  | 'authorization_denied'
  | 'callback_failed'
  | 'missing_code'
  | 'callback_unavailable'
  | 'invalid_response'
  | 'already_in_progress'
  | 'provider_not_registered'
  | 'configuration_missing'
  | 'service_unavailable'
  | 'upgrade_required'
  | 'unknown'

export interface SignInFailure {
  reason: SignInFailureReason
  phase?: SignInPhase
  httpStatus?: number
}

export function normalizeSignInFailure(data: unknown): SignInFailure | undefined {
  if (!data || typeof data !== 'object') return undefined
  const { reason, phase, httpStatus } = data as Record<string, unknown>
  switch (reason) {
    case 'network':
    case 'request_timeout':
    case 'callback_timeout':
    case 'browser_open_failed':
    case 'http_error':
    case 'authorization_denied':
    case 'callback_failed':
    case 'missing_code':
    case 'callback_unavailable':
    case 'invalid_response':
    case 'already_in_progress':
    case 'provider_not_registered':
    case 'configuration_missing':
    case 'service_unavailable':
    case 'upgrade_required':
    case 'unknown':
      break
    default:
      return undefined
  }
  const failure: SignInFailure = { reason }
  if (
    phase === 'discovery' ||
    phase === 'authorization' ||
    phase === 'callback' ||
    phase === 'exchange' ||
    phase === 'persist'
  ) {
    failure.phase = phase
  }
  if (typeof httpStatus === 'number' && Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599) {
    failure.httpStatus = httpStatus
  }
  return failure
}
