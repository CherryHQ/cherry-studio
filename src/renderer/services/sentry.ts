import { captureException, init } from '@sentry/electron/renderer'

import { getSentryBuildContext, getSentryLogContext, sanitizeSentryEvent } from '@shared/utils/sentry'

import { name, version } from '../../../package.json'
import { loggerService, resolveWindowSourceFromMeta } from './LoggerService'

export function initSentry(): void {
  if (import.meta.env.DEV) return
  const buildContext = getSentryBuildContext(name, version, __APP_EDITION__)
  const windowSource = resolveWindowSourceFromMeta(document) || 'UNKNOWN'

  init({
    release: buildContext.release,
    beforeSend: (event) =>
      sanitizeSentryEvent({
        ...event,
        tags: { ...event.tags, ...buildContext.tags, window: windowSource, 'event.process': 'renderer' }
      }),
    maxBreadcrumbs: 0,
    sendClientReports: false,
    sendDefaultPii: false
  })
  loggerService.setErrorReporter((error, entry) => {
    const context = getSentryLogContext(entry)
    if (context) captureException(error, context)
  })
}
