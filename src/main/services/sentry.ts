import process from 'node:process'

import { loggerService } from '@logger'
import * as Sentry from '@sentry/electron/main'
import { isSensitiveKey, REDACTED, redactSecretText } from '@shared/utils/redaction'

const logger = loggerService.withContext('Sentry')

let reportingEnabled = false

function sanitizeEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  return JSON.parse(
    JSON.stringify(event, (key, value) => {
      if (isSensitiveKey(key)) return REDACTED
      return typeof value === 'string' ? redactSecretText(value, ['code']) : value
    })
  ) as Sentry.ErrorEvent
}

export function initSentry(): void {
  const dsn = import.meta.env.MAIN_VITE_SENTRY_DSN?.trim()
  if (!dsn) {
    logger.info('Sentry is disabled because no DSN is configured')
    return
  }

  Sentry.init({
    dsn,
    maxBreadcrumbs: 0,
    sendClientReports: false,
    sendDefaultPii: false,
    skipOpenTelemetrySetup: true,
    tracePropagationTargets: [],
    onFatalError: (error) => {
      logger.error('Fatal main-process error; exiting after Sentry flush', error)
      process.exit(1)
    },
    beforeSend: (event) => (reportingEnabled ? sanitizeEvent(event) : null),
    integrations: (integrations) =>
      integrations.filter(
        (integration) =>
          integration.name !== 'ElectronNet' &&
          integration.name !== 'NodeFetch' &&
          integration.name !== 'SentryMinidump' &&
          integration.name !== 'LocalVariables' &&
          integration.name !== 'MainProcessSession'
      ),
    transport: (options) => {
      const transport = Sentry.makeElectronTransport(options)
      return {
        flush: (timeout) => transport.flush(timeout),
        send: (envelope) => (reportingEnabled ? transport.send(envelope) : Promise.resolve({ statusCode: 200 }))
      }
    }
  })
}

export function setSentryReportingEnabled(enabled: boolean): void {
  reportingEnabled = enabled
}
