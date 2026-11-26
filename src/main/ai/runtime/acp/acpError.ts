import { formatAcpError } from '@cherrystudio/agent-runtime-acp/v1'
import { t } from '@main/i18n'
import { redactSecretText, redactSecretTokens } from '@shared/utils/redaction'

export function acpError(error: unknown, stderr?: string): unknown {
  return formatAcpError(error, stderr, (originalMessage, detail) => {
    const diagnostic = redactSecretTokens(redactSecretText(detail)).slice(-4000)
    const message =
      /no model selected|(?:no|missing|provide|didn't provide).*api.?key|api.?key.*(?:missing|required|not set)/i.test(
        detail
      )
        ? t('local_agent.configuration_required')
        : originalMessage
    return `${message}\n${diagnostic}`
  })
}
