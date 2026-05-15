import process from 'node:process'

import { loggerService } from '@logger'
import { isDev } from '@main/constant'
import { app, crashReporter } from 'electron'

const logger = loggerService.withContext('CrashTelemetry')

/**
 * Initialise the "crash & error diagnostic" subsystem.
 *
 * Runs during preboot, before `app.whenReady()`. Safe to call once.
 * Composed of three independent pieces that are grouped here because
 * they form one conceptual subsystem: how the app observes and reports
 * things going wrong.
 *
 * Timing contract:
 *   - Must run before `app.whenReady()` (so the Document-Policy header
 *     is in place before the first web contents is created).
 *   - Must run before any code that could plausibly throw after module
 *     load (so the process-level handlers are armed early).
 *   - Has no ordering relationship with other preboot modules.
 *
 * See core/preboot/README.md for the preboot membership criteria.
 */
export function initCrashTelemetry(): void {
  startCrashReporter()
  installProcessErrorHandlers()
  hardenWebContents()
}

/**
 * Enable the local Electron crash reporter. Reports are kept on disk only
 * (`uploadToServer: false`) and can be inspected via `app.getPath('crashDumps')`.
 */
function startCrashReporter(): void {
  crashReporter.start({
    companyName: 'CherryHQ',
    productName: 'CherryStudio',
    submitURL: '',
    uploadToServer: false
  })
}

/**
 * In production, install last-resort handlers for `uncaughtException` and
 * `unhandledRejection`. In dev, leave both unset so errors propagate to the
 * terminal with their full, unswallowed stack traces.
 */
function installProcessErrorHandlers(): void {
  if (isDev) return

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error)
  })

  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection at: ${promise} reason: ${reason}`)
  })
}

/**
 * Register the `web-contents-created` handler that hardens every new
 * webContents with:
 *
 *   1. A `Document-Policy: include-js-call-stacks-in-crash-reports`
 *      response header. This opts the document into the Chromium feature
 *      `DocumentPolicyIncludeJSCallStacksInCrashReports` that is enabled
 *      unconditionally in `preboot/chromiumFlags.ts`. Both halves
 *      (the feature flag and this header) are required — without the
 *      header, the feature flag alone has no effect.
 *
 *   2. An `unresponsive` listener that collects a JavaScript call stack
 *      from the stuck renderer (enabled by #1) and logs it. This is the
 *      primary diagnostic signal for "the UI froze" bug reports.
 */
function hardenWebContents(): void {
  app.on('web-contents-created', (_, webContents) => {
    webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Document-Policy': ['include-js-call-stacks-in-crash-reports']
        }
      })
    })

    webContents.on('unresponsive', async () => {
      logger.error('Renderer unresponsive start')
      const callStack = await webContents.mainFrame.collectJavaScriptCallStack()
      logger.error(`Renderer unresponsive js call stack\n ${callStack}`)
    })
  })
}
