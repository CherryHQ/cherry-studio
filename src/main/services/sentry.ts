import process from 'node:process'
import { Writable } from 'node:stream'

import * as Sentry from '@sentry/electron/main'
import winston from 'winston'

import { loggerService } from '@logger'
import { isSensitiveKey, REDACTED, redactSecretText } from '@shared/utils/redaction'
import { getSentryBuildContext, getSentryLogError } from '@shared/utils/sentry'

import { name, version } from '../../../package.json'

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
  const buildContext = getSentryBuildContext(name, version, __APP_EDITION__)

  Sentry.init({
    release: buildContext.release,
    initialScope: { tags: { ...buildContext.tags, 'event.process': 'main' } },
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
    integrations: (integrations) => [
      ...integrations.filter(
        (integration) =>
          integration.name !== 'ElectronNet' &&
          integration.name !== 'NodeFetch' &&
          integration.name !== 'SentryMinidump' &&
          integration.name !== 'LocalVariables' &&
          integration.name !== 'MainProcessSession' &&
          integration.name !== 'RendererEventLoopBlock'
      ),
      Sentry.dedupeIntegration()
    ],
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

export function attachSentryLogTransport(): () => void {
  const baseLogger = loggerService.getBaseLogger()
  const stream = new Writable({
    objectMode: true,
    write(info: Record<string, unknown>, _encoding, callback) {
      try {
        if (reportingEnabled && !import.meta.env.DEV && info.process !== 'renderer') {
          const report = getSentryLogError(info)
          if (report) Sentry.captureException(report.error, report.context)
        }
      } catch (error) {
        logger.warn('Failed to report logged error', error instanceof Error ? error : { error })
      }
      callback()
    }
  })
  const transport = new winston.transports.Stream({ level: 'error', stream })
  baseLogger.add(transport)
  return () => {
    baseLogger.remove(transport)
    transport.destroy()
    stream.destroy()
    setSentryReportingEnabled(false)
  }
}
