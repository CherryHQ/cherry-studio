import { loggerService } from '@logger'
import type * as NodeScreenshotsModule from 'node-screenshots'

import { ScreenCaptureError } from './types'

const logger = loggerService.withContext('nativeCaptureBackend')

let cached: typeof NodeScreenshotsModule | null = null

/**
 * The single load point for the native capture backend.
 *
 * Two reasons this is its own module rather than a helper inside screenCapture:
 *
 * 1. **Lazy** — `screenCapture` is reached through the package barrel by the
 *    `system.*` permission routes, i.e. on every app start regardless of whether
 *    capture is enabled. A top-level import would let a missing or
 *    arch-mismatched `.node` crash the main process before any error handling ran.
 * 2. **Mockable** — `require` is invisible to `vi.mock` (Vitest only intercepts
 *    `import`). Confining it here lets tests mock this module instead, which is
 *    an ESM import from every consumer's point of view.
 *
 * `require` rather than `await import` keeps callers synchronous — display and
 * window enumeration have no asynchronous form in the backend.
 */
export function loadNativeCaptureBackend(): typeof NodeScreenshotsModule {
  if (!cached) {
    try {
      cached = require('node-screenshots') as typeof NodeScreenshotsModule
    } catch (error) {
      logger.error('Failed to load the native screen capture backend', error as Error)
      throw new ScreenCaptureError('Screen capture backend is unavailable', { cause: error })
    }
  }
  return cached
}

/**
 * Absolute path of the native backend, for a worker that cannot resolve it itself.
 *
 * A `worker_threads` worker spawned from an eval'd source string has no module
 * path to resolve `node-screenshots` against, and the packaged app moves it into
 * `app.asar.unpacked`. Resolving here — in the process that already loads it
 * successfully — sidesteps both.
 */
export function nativeCaptureBackendPath(): string {
  try {
    return require.resolve('node-screenshots')
  } catch (error) {
    logger.error('Failed to resolve the native screen capture backend', error as Error)
    throw new ScreenCaptureError('Screen capture backend is unavailable', { cause: error })
  }
}
