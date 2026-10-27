import {
  browserApiErrorsIntegration,
  captureException,
  eventFiltersIntegration,
  functionToStringIntegration,
  globalHandlersIntegration,
  init,
  linkedErrorsIntegration,
  scopeToMainIntegration
} from '@sentry/electron/renderer'

import { getSentryBuildContext, sanitizeSentryEvent } from '@shared/utils/sentry'

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
      scopeToMainIntegration()
    ],
    beforeSend: (event) =>
      sanitizeSentryEvent({
        ...event,
        tags: { ...event.tags, ...buildContext.tags, window: windowSource, 'event.process': 'renderer' }
      }),
    maxBreadcrumbs: 0,
    sendClientReports: false,
    sendDefaultPii: false
  })
}

export function reportRenderFailure(error: Error, componentStack?: string | null): void {
  if (import.meta.env.DEV) return
  try {
    captureException(error, { tags: { 'failure.kind': 'render' }, extra: { componentStack } })
  } catch (reportError) {
    loggerService.withContext('Sentry').warn('Failed to report render failure', reportError as Error)
  }
}
