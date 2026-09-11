import { init } from '@sentry/electron/renderer'
import { isSensitiveKey, REDACTED, redactSecretText } from '@shared/utils/redaction'

function sanitizeEvent<T>(event: T): T {
  return JSON.parse(
    JSON.stringify(event, (key, value) => {
      if (isSensitiveKey(key)) return REDACTED
      return typeof value === 'string' ? redactSecretText(value, ['code']) : value
    })
  ) as T
}

export function initSentry(): void {
  if (!__SENTRY_ENABLED__) return

  init({
    beforeSend: sanitizeEvent,
    maxBreadcrumbs: 0,
    sendClientReports: false,
    sendDefaultPii: false
  })
}
