import { RequestError } from '@agentclientprotocol/sdk'

import { t } from '@main/i18n'
import { redactSecretText, redactSecretTokens } from '@shared/utils/redaction'

export function acpError(error: unknown, stderr?: string): unknown {
  if (!(error instanceof Error)) return error
  const data = error instanceof RequestError ? error.data : undefined
  let detail =
    typeof data === 'string'
      ? data
      : data && typeof data === 'object'
        ? 'details' in data
          ? data.details
          : 'message' in data
            ? data.message
            : undefined
        : undefined
  if (typeof detail !== 'string' && /^(?:ACP connection closed|Local agent process exited)$/.test(error.message))
    detail = stderr
  if (typeof detail !== 'string' || !detail.trim()) return error
  const diagnostic = redactSecretTokens(redactSecretText(detail)).slice(-4000)
  const message =
    /no model selected|(?:no|missing|provide|didn't provide).*api.?key|api.?key.*(?:missing|required|not set)/i.test(
      detail
    )
      ? t('local_agent.configuration_required')
      : error.message
  return error instanceof RequestError
    ? new RequestError(error.code, `${message}\n${diagnostic}`)
    : new Error(`${message}\n${diagnostic}`)
}
