import process from 'node:process'

import { app, crashReporter } from 'electron'

import { loggerService } from '@logger'
import { isDev } from '@main/core/platform'
import { isSelfHardenedSession } from '@main/core/security/selfHardenedSessions'
import type { AppErrorContext } from '@shared/types/appError'

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
 * Production process-error boundary.
 *
 * `uncaughtExceptionMonitor` only logs. It must not present UI and must not
 * call `preventDefault` — Node still exits, and that exit is the noninteractive
 * fatal boundary. A second renderer crash inside the force-exit window is the
 * same kind of boundary: the process leaves, so no fault is queued.
 * `unhandledRejection` leaves the process alive. Identical reasons are suppressed
 * for a short interval; a different fault, or the same fault after the interval,
 * can still be presented. Ordinary logger calls are not events. Presentation
 * never throws back into this handler, and it does not touch lifecycle services
 * that are not already constructed (`application.getExisting`).
 */
export const UNHANDLED_REJECTION_DEDUP_MS = 60_000
const UNHANDLED_REJECTION_RECENT_LIMIT = 50
const recentUnhandledRejections = new Map<string, number>()
const inFlightUnhandledRejections = new Set<string>()
let handoffModules:
  | Promise<{
      application: { getExisting(name: string): unknown }
      deliverToReadyMain: (channel: 'app.error.open', context: AppErrorContext) => boolean
    }>
  | undefined

function loadHandoffModules() {
  // Concurrent faults share one import. A second import of the same modules
  // must not fail closed while the first is still loading.
  handoffModules ??= Promise.all([import('@application'), import('@main/services/mainWindowNavigation')])
    .then(([appModule, navigation]) => ({
      application: appModule.application,
      deliverToReadyMain: navigation.deliverToReadyMain
    }))
    .catch((error: unknown) => {
      handoffModules = undefined
      throw error
    })
  return handoffModules
}

function rejectionMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'string') return reason
  return 'Unhandled promise rejection'
}

function rejectionSignature(reason: unknown): string {
  if (reason instanceof Error) return `${reason.name}:${reason.message}`.slice(0, 240)
  return rejectionMessage(reason).slice(0, 240)
}

function rememberPresentedRejection(signature: string, now: number): void {
  recentUnhandledRejections.delete(signature)
  recentUnhandledRejections.set(signature, now)
  for (const [key, at] of recentUnhandledRejections) {
    if (now - at >= UNHANDLED_REJECTION_DEDUP_MS) recentUnhandledRejections.delete(key)
  }
  while (recentUnhandledRejections.size > UNHANDLED_REJECTION_RECENT_LIMIT) {
    const oldest = recentUnhandledRejections.keys().next().value
    if (oldest === undefined) break
    recentUnhandledRejections.delete(oldest)
  }
}

/** Returns whether a ready main window accepted the fault. Deduped reasons return false. */
export async function presentProductionUnhandledRejection(reason: unknown, now = Date.now()): Promise<boolean> {
  const signature = rejectionSignature(reason)
  const last = recentUnhandledRejections.get(signature)
  if (last !== undefined && now - last < UNHANDLED_REJECTION_DEDUP_MS) return false
  if (inFlightUnhandledRejections.has(signature)) return false
  inFlightUnhandledRejections.add(signature)
  try {
    const { application, deliverToReadyMain } = await loadHandoffModules()
    if (!app.isReady()) return false
    if (!application.getExisting('WindowManager') || !application.getExisting('IpcApiService')) return false
    const message = rejectionMessage(reason).slice(0, 4000)
    const context: AppErrorContext = {
      id: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      source: 'main',
      operation: 'process.unhandledRejection',
      message,
      ...(reason instanceof Error ? { name: reason.name, ...(reason.stack ? { stack: reason.stack } : {}) } : {})
    }
    if (!deliverToReadyMain('app.error.open', context)) return false
    rememberPresentedRejection(signature, now)
    return true
  } catch (error) {
    logger.error('Unhandled rejection could not be presented', error as Error)
    return false
  } finally {
    inFlightUnhandledRejections.delete(signature)
  }
}

function installProcessErrorHandlers(): void {
  if (isDev) return

  process.on('uncaughtExceptionMonitor', (error) => {
    logger.error('Uncaught Exception:', error)
  })

  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled Rejection at: ${promise} reason: ${reason}`)
    void presentProductionUnhandledRejection(reason)
  })
}

/**
 * Register the `web-contents-created` handler that hardens every new
 * webContents with:
 *
 *   1. Response header filtering for values that Electron's `net.fetch`
 *      cannot convert to Web `Headers` without throwing.
 *
 *   2. A `Document-Policy: include-js-call-stacks-in-crash-reports`
 *      response header. This opts the document into the Chromium feature
 *      `DocumentPolicyIncludeJSCallStacksInCrashReports` that is enabled
 *      unconditionally in `preboot/chromiumFlags.ts`. Both halves
 *      (the feature flag and this header) are required — without the
 *      header, the feature flag alone has no effect.
 *
 *   3. An `unresponsive` listener that collects a JavaScript call stack
 *      from the stuck renderer (enabled by #2) and logs it. This is the
 *      primary diagnostic signal for "the UI froze" bug reports.
 */
function hardenWebContents(): void {
  app.on('web-contents-created', (_, webContents) => {
    // Owns every session's single `onHeadersReceived` slot EXCEPT the ones whose owner
    // installs its own: Electron keeps ONE listener per session, so two registrations are
    // not two policies, they are the later one. The second consumer this comment used to
    // forbid has appeared (mini apps re-deliver their CSP on this slot), so the two are
    // separated by session instead of by a coordinator — each is then the only writer on
    // the sessions it owns. `Document-Policy` is for OUR renderers' crash reports anyway.
    if (isSelfHardenedSession(webContents.session)) return
    webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...filterByteStringResponseHeaders(details.responseHeaders),
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

function filterByteStringResponseHeaders(headers: Record<string, string[]> | undefined): Record<string, string[]> {
  const filteredHeaders: Record<string, string[]> = {}

  for (const [name, values] of Object.entries(headers ?? {})) {
    const compatibleValues = values.filter((value) => {
      for (let index = 0; index < value.length; index++) {
        if (value.charCodeAt(index) > 0xff) return false
      }
      return true
    })

    if (compatibleValues.length > 0) {
      filteredHeaders[name] = compatibleValues
    }
  }

  return filteredHeaders
}
