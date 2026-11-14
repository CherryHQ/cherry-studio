import {
  browserApiErrorsIntegration,
  captureException,
  captureEvent,
  dedupeIntegration,
  eventFiltersIntegration,
  functionToStringIntegration,
  globalHandlersIntegration,
  init,
  linkedErrorsIntegration,
  scopeToMainIntegration
} from '@sentry/electron/renderer'

import { hasReportingOwner, isCancellation } from '@shared/utils/errorReporting'
import { getSentryBuildContext, getSentryLogContext, sanitizeSentryEvent } from '@shared/utils/sentry'

import { name, version } from '../../../package.json'
import { loggerService, resolveWindowSourceFromMeta } from './LoggerService'

/**
 * Renderer capture has no DSN: events travel over IPC and are gated by the main
 * process consent check. Only default-session windows carry the bridge preload —
 * a window opened with its own `partition` would silently report nothing.
 */
export function initSentry(): void {
  if (import.meta.env.DEV) return
  const buildContext = getSentryBuildContext(name, version, __APP_EDITION__)
  const windowSource = resolveWindowSourceFromMeta(document) || 'UNKNOWN'

  init({
    release: buildContext.release,
    defaultIntegrations: false,
    integrations: [
      eventFiltersIntegration(),
      functionToStringIntegration(),
      browserApiErrorsIntegration(),
      globalHandlersIntegration(),
      linkedErrorsIntegration(),
      dedupeIntegration(),
      scopeToMainIntegration()
    ],
    beforeSend: (event, hint) => {
      if (hasReportingOwner(hint?.originalException) || isCancellation(hint?.originalException)) return null
      return sanitizeSentryEvent({
        ...event,
        tags: { ...event.tags, ...buildContext.tags, window: windowSource, 'event.process': 'renderer' }
      })
    },
    maxBreadcrumbs: 0,
    sendClientReports: false,
    sendDefaultPii: false
  })
  loggerService.setErrorReporter(({ error, entry }) => {
    const context = getSentryLogContext(entry)
    if (!context) return
    context.tags['capture.source'] = 'log'
    if (error) captureException(error, context)
    else captureEvent({ ...context, level: 'error', message: context.tags.operation ?? context.tags['failure.reason'] })
  })
}
