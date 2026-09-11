import { Writable } from 'node:stream'

import * as Sentry from '@sentry/electron/main'
import winston from 'winston'

import { application } from '@application'
import { loggerService } from '@logger'
import { isDataCollectionConsented } from '@main/utils/privacyConsent'
import { getSentryBuildContext, getSentryLogContext, sanitizeSentryEvent } from '@shared/utils/sentry'

import { name, version } from '../../../package.json'

const logger = loggerService.withContext('Sentry')
const SENTRY_DSN = 'https://194ceab3bd44e686bd3ebda9de3c20fd@o4509184559218688.ingest.us.sentry.io/4509184569442304'

/**
 * Allowlist rather than a filter over the SDK defaults: an integration added or
 * renamed by an upgrade stays off until it is reviewed and listed here.
 * Deliberately absent — SentryMinidump (native process memory), LocalVariables
 * (stack-frame values), ElectronNet / NodeFetch (tracing-only, and they record
 * provider URLs), ChildProcess, Console, ElectronBreadcrumbs, Screenshots,
 * MainProcessSession, RendererEventLoopBlock.
 */
function allowedIntegrations() {
  return [
    Sentry.onUncaughtExceptionIntegration(),
    Sentry.onUnhandledRejectionIntegration(),
    Sentry.eventFiltersIntegration(),
    Sentry.dedupeIntegration(),
    Sentry.functionToStringIntegration(),
    Sentry.linkedErrorsIntegration(),
    Sentry.contextLinesIntegration(),
    Sentry.electronContextIntegration(),
    Sentry.nodeContextIntegration({ cloudResource: false }),
    Sentry.gpuContextIntegration(),
    Sentry.additionalContextIntegration(),
    // Injects the renderer↔main bridge preload; without it renderer capture is inert.
    Sentry.preloadInjectionIntegration(),
    // Strips usernames out of file paths — must run after context collection.
    Sentry.normalizePathsIntegration()
  ]
}

/**
 * Read consent at send time instead of caching it: the preference is the single
 * source of truth, and a stale copy here would be a privacy bug. Returns false
 * during preboot, when no preference store exists yet.
 */
function consentGranted(): boolean {
  const preferenceService = application.getExisting('PreferenceService')
  if (!preferenceService) return false

  return isDataCollectionConsented(
    preferenceService.get('app.privacy.data_collection.enabled'),
    preferenceService.get('app.privacy.policy_version')
  )
}

export function initSentry(): void {
  if (import.meta.env.DEV) return
  const buildContext = getSentryBuildContext(name, version, __APP_EDITION__)

  Sentry.init({
    dsn: SENTRY_DSN,
    release: buildContext.release,
    initialScope: { tags: { ...buildContext.tags, 'event.process': 'main' } },
    maxBreadcrumbs: 0,
    sendClientReports: false,
    sendDefaultPii: false,
    skipOpenTelemetrySetup: true,
    tracePropagationTargets: [],
    beforeSend: (event) => (consentGranted() ? sanitizeSentryEvent(event) : null),
    defaultIntegrations: false,
    integrations: allowedIntegrations(),
    // Not the SDK's offline transport: queueing envelopes on disk would persist
    // reports the user has not consented to send.
    transport: (options) => {
      const transport = Sentry.makeElectronTransport(options)
      return {
        flush: (timeout) => transport.flush(timeout),
        send: (envelope) => (consentGranted() ? transport.send(envelope) : Promise.resolve({ statusCode: 200 }))
      }
    }
  })
}

export function attachSentryLogTransport(): () => void {
  const baseLogger = loggerService.getBaseLogger()
  const stream = new Writable({
    objectMode: true,
    write(info: Record<string, unknown>, _encoding, callback) {
      try {
        if (consentGranted() && !import.meta.env.DEV && info.process !== 'renderer') {
          const context = getSentryLogContext(info)
          if (context) {
            const error = new Error(typeof info.errorMessage === 'string' ? info.errorMessage : 'Operation failed')
            error.name = typeof info.name === 'string' ? info.name : 'Error'
            error.stack = info.stack as string
            Sentry.captureException(error, context)
          }
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
  }
}
