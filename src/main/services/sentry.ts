import * as Sentry from '@sentry/electron/main'

import { application } from '@application'
import { loggerService } from '@logger'
import { isDataCollectionConsented } from '@main/utils/privacyConsent'
import { getClientId } from '@main/utils/systemInfo'
import { getSentryBuildContext, sanitizeSentryEvent } from '@shared/utils/sentry'

import { name, version } from '../../../package.json'
import { SentryEventFilter } from './SentryEventFilter'

const logger = loggerService.withContext('Sentry')
const SENTRY_DSN = 'https://194ceab3bd44e686bd3ebda9de3c20fd@o4509184559218688.ingest.us.sentry.io/4509184569442304'

/**
 * Allowlist rather than a filter over the SDK defaults: an integration added or
 * renamed by an upgrade stays off until it is reviewed and listed here.
 * Deliberately absent — SentryMinidump (native process memory), LocalVariables
 * (stack-frame values), ElectronNet / NodeFetch (tracing-only, and they record
 * provider URLs), Console, ElectronBreadcrumbs, Screenshots,
 * MainProcessSession, RendererEventLoopBlock.
 */
function allowedIntegrations() {
  return [
    Sentry.onUncaughtExceptionIntegration(),
    Sentry.onUnhandledRejectionIntegration(),
    Sentry.eventFiltersIntegration(),
    Sentry.childProcessIntegration({
      breadcrumbs: false,
      events: ['crashed', 'oom', 'launch-failed', 'integrity-failure'],
      captureWorkerErrors: false,
      includeChildProcessArgs: false
    }),
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

// Read current consent without instantiating services during preboot.
// An existing preference store may still be initializing or already stopped.
function consentGranted(): boolean {
  const preferenceService = application.getExisting('PreferenceService')
  if (!preferenceService?.isReady) return false

  return isDataCollectionConsented(
    preferenceService.get('app.privacy.data_collection.enabled'),
    preferenceService.get('app.privacy.policy_version')
  )
}

export function initSentry(): void {
  if (import.meta.env.DEV) return
  const buildContext = getSentryBuildContext(name, version, __APP_EDITION__)
  const eventFilter = new SentryEventFilter()

  Sentry.init({
    dsn: SENTRY_DSN,
    release: buildContext.release,
    initialScope: { tags: { ...buildContext.tags, 'event.process': 'main' } },
    maxBreadcrumbs: 0,
    sendClientReports: false,
    sendDefaultPii: false,
    skipOpenTelemetrySetup: true,
    tracePropagationTargets: [],
    beforeSend: (event) => {
      if (!consentGranted()) return null
      const sanitized = sanitizeSentryEvent(event)
      if (!eventFilter.allow(sanitized)) return null
      return { ...sanitized, user: { ...sanitized.user, id: getClientId() } }
    },
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

export async function reportStartupFailure(error: unknown, service?: string): Promise<void> {
  if (import.meta.env.DEV) return
  try {
    if (!consentGranted()) return
    Sentry.captureException(error, { level: 'fatal', tags: { 'failure.kind': 'startup', service } })
    await Sentry.flush(2000)
  } catch (reportError) {
    logger.warn('Failed to report startup failure', reportError as Error)
  }
}

export function reportUnexpectedFailure(error: unknown): void {
  if (import.meta.env.DEV) return
  try {
    if (!consentGranted()) return
    Sentry.captureException(error, { tags: { 'failure.kind': 'unexpected' } })
  } catch (reportError) {
    logger.warn('Failed to report unexpected failure', reportError as Error)
  }
}
