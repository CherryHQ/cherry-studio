import type { SerializedError } from '@renderer/types/error'
import { getSafeProviderErrorMessage, stripClaudeCodeRejectionPrefix } from '@shared/ai/providerError'
import { CHERRY_CLOUD_PROVIDER_ID } from '@shared/data/presets/cherryai'
import type { ErrorCategory } from '@shared/utils/errorCategory'

import { providerErrorText } from './error'

/** Provider wording is presentation only; structured classification owns quota identity. */
export function getCherryCloudErrorPresentation(
  error: SerializedError | undefined,
  providerId: string | undefined,
  category: ErrorCategory
): { quota: boolean; text: string } {
  if (providerId !== CHERRY_CLOUD_PROVIDER_ID) return { quota: false, text: '' }
  const text = stripClaudeCodeRejectionPrefix(
    providerErrorText(error) ||
      getSafeProviderErrorMessage({ responseBody: error?.message?.replace(/^\s*\d{3}:\s*/, '') })
  )
  return {
    quota: category === 'quota',
    text
  }
}
