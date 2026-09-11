import { captureException, init } from '@sentry/electron/renderer'

import { isSensitiveKey, REDACTED, redactSecretText } from '@shared/utils/redaction'
import { getSentryBuildContext, getSentryLogError } from '@shared/utils/sentry'

import { name, version } from '../../../package.json'
import { loggerService, resolveWindowSourceFromMeta } from './LoggerService'

function sanitizeEvent<T>(event: T): T {
  return JSON.parse(
    JSON.stringify(event, (key, value) => {
      if (isSensitiveKey(key)) return REDACTED
      return typeof value === 'string' ? redactSecretText(value, ['code']) : value
    })
  ) as T
}

export function initSentry(): void {
  if (import.meta.env.DEV) return
  const buildContext = getSentryBuildContext(name, version, __APP_EDITION__)
  const windowSource = resolveWindowSourceFromMeta(document) || 'UNKNOWN'

  init({
    release: buildContext.release,
    beforeSend: (event) =>
      sanitizeEvent({
        ...event,
        tags: { ...event.tags, ...buildContext.tags, window: windowSource, 'event.process': 'renderer' }
      }),
    maxBreadcrumbs: 0,
    sendClientReports: false,
    sendDefaultPii: false
  })
  loggerService.setErrorReporter((entry) => {
    const report = getSentryLogError(entry)
    if (report) captureException(report.error, report.context)
  })
}
