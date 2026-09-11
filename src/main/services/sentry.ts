import process from 'node:process'

import * as Sentry from '@sentry/electron/main'

import { loggerService } from '@logger'
import { isSensitiveKey, REDACTED, redactSecretText } from '@shared/utils/redaction'

const logger = loggerService.withContext('Sentry')
const SENTRY_DSN = 'https://194ceab3bd44e686bd3ebda9de3c20fd@o4509184559218688.ingest.us.sentry.io/4509184569442304'

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
  if (import.meta.env.DEV) return

  Sentry.init({
    dsn: SENTRY_DSN,
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
