import type { SerializedError } from '@renderer/types/error'
import {
  getProviderErrorCode,
  getSafeProviderErrorMessage,
  stripClaudeCodeRejectionPrefix
} from '@shared/ai/providerError'
import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { ErrorCategory } from '@shared/utils/errorCategory'

import { providerErrorText } from './error'

/**
 * `plan_quota`: Cloud's own plan refusal. `limited`: any other Cloud quota refusal, or a rate limit with text;
 * its text, when present, is shown as is.
 */
export type CherryCloudErrorKind = 'plan_quota' | 'limited' | null

const PLAN_QUOTA_CODE = 'QUOTA_EXHAUSTED'

const STATUS_PREFIX = /^\s*\d{3}:\s*/

function hasPlanQuotaCode(error: SerializedError | undefined): boolean {
  const lastError = error?.lastError
  const terminal = lastError && typeof lastError === 'object' && !Array.isArray(lastError) ? lastError : error
  if (terminal?.providerErrorCode === PLAN_QUOTA_CODE) return true
  // Pi agent runs surface the raw body as `429: {…}` instead of a serialized API error.
  return getProviderErrorCode(error?.message?.replace(STATUS_PREFIX, '')) === PLAN_QUOTA_CODE
}

/** Provider wording is presentation only; the server's code owns plan-quota identity. */
export function getCherryCloudErrorPresentation(
  error: SerializedError | undefined,
  providerId: string | undefined,
  category: ErrorCategory
): { kind: CherryCloudErrorKind; text: string } {
  if (providerId !== CHERRY_CLOUD_PROVIDER_ID) return { kind: null, text: '' }
  const text = stripClaudeCodeRejectionPrefix(
    providerErrorText(error) ||
      getSafeProviderErrorMessage({ responseBody: error?.message?.replace(STATUS_PREFIX, '') })
  )
  // Upstream AMD 429s may say "quota" too, so only the Cloud code earns the plan heading.
  if (category === 'quota' && hasPlanQuotaCode(error)) return { kind: 'plan_quota', text }
  // A textless quota refusal still must not offer billing or provider settings.
  if (category === 'quota' || (category === 'rate_limit' && text)) return { kind: 'limited', text }
  return { kind: null, text }
}
