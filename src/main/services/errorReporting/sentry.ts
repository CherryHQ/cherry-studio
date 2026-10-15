import * as Sentry from '@sentry/electron/main'

import { application } from '@application'
import { getClientId } from '@main/utils/systemInfo'
import { getSentryBuildContext, getSentryLogContext, sanitizeSentryEvent } from '@shared/utils/sentry'

import { dependencies, devDependencies, name, version } from '../../../../package.json'

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

// Read current consent without instantiating services during preboot.
// An existing preference store may still be initializing or already stopped.
function consentGranted(): boolean {
  return application.getExisting('ErrorReportingService')?.enabled === true
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
    beforeSend: (event, hint) => {
      const filtered = application.getExisting('ErrorReportingService')?.filterEvent(event, hint)
      if (!filtered) return null
      const runtime = filtered.tags?.['failure.runtime']
      const runtimeVersion =
        runtime === 'claude-code'
          ? dependencies['@anthropic-ai/claude-agent-sdk']
          : runtime === 'pi'
            ? dependencies['@earendil-works/pi-coding-agent']
            : runtime === 'ai-sdk'
              ? devDependencies.ai
              : undefined
      return sanitizeSentryEvent({
        ...filtered,
        tags: { ...filtered.tags, ...(runtimeVersion ? { 'runtime.version': runtimeVersion } : {}) },
        user: { ...filtered.user, id: getClientId() }
      })
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

export function captureLoggedError(info: Record<string, unknown>): void {
  const context = getSentryLogContext(info)
  if (!context) return
  context.tags['capture.source'] = 'log'
  if (typeof info.stack === 'string') {
    const error = new Error(typeof info.errorMessage === 'string' ? info.errorMessage : 'Operation failed')
    error.name =
      typeof info.name === 'string' ? info.name : typeof info.errorName === 'string' ? info.errorName : 'Error'
    error.stack = info.stack
    Sentry.captureException(error, context)
  } else {
    Sentry.captureEvent({
      ...context,
      level: 'error',
      message: context.tags.operation ?? context.tags['failure.reason']
    })
  }
}
