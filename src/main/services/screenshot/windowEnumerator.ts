import { Worker } from 'node:worker_threads'

import { loggerService } from '@logger'
import { DIAGNOSTICS_ENABLED } from '@main/core/diagnostics'

import { nativeCaptureBackendPath } from './nativeCaptureBackend'
import type { RawWindowInfo } from './types'

const logger = loggerService.withContext('windowEnumerator')

/** The subset of the native `Window` class this module reads. */
type NativeWindow = {
  pid(): number
  title(): string
  x(): number
  y(): number
  width(): number
  height(): number
  isMinimized(): boolean
}

/**
 * One window's snap-relevant properties, or null if it closed mid-enumeration.
 *
 * Every accessor re-queries the OS window list, so a window that disappears between
 * the enumeration and a property read throws. Transient windows (menus, tooltips)
 * close constantly, so skipping the individual window is the only viable answer —
 * aborting would make the hit-test list fail at random.
 *
 * Baked into the worker source below via `.toString()`, so the tested function and
 * the shipped one cannot drift.
 */
export function readWindowInfo(w: NativeWindow): RawWindowInfo | null {
  try {
    return {
      pid: w.pid(),
      title: w.title(),
      x: w.x(),
      y: w.y(),
      width: w.width(),
      height: w.height(),
      isMinimized: w.isMinimized()
    }
  } catch {
    return null
  }
}

/**
 * Window enumeration, as an eval'd `worker_threads` source string.
 *
 * A string rather than a file entry because electron-vite builds the main process
 * as a single bundle (`inlineDynamicImports: true`), which Rollup forbids combining
 * with multiple inputs — the inference and tool-exec workers take the same shape.
 * The native backend's path arrives through `workerData`: an eval'd worker has no
 * module path of its own to resolve it against.
 *
 * Every property accessor in the backend re-queries the whole OS window list, so
 * this loop is hundreds of milliseconds of work with a normal working set. That is
 * the entire reason it runs here: on the main thread it blocks Chromium's browser
 * UI thread, which routes input events to the overlay's renderer, so the overlay
 * would be painted but unable to respond to the drag the user is already making.
 */
const enumeratorSource = `
const { parentPort, workerData } = require('node:worker_threads')
const readWindowInfo = ${readWindowInfo.toString()}

// Wall clock, so the main thread can measure how long this worker took to boot.
// performance.now() cannot: each thread's origin is its own start.
const startedAt = Date.now()

try {
  const t0 = performance.now()
  const { Window } = require(workerData.backendPath)
  const loadMs = performance.now() - t0

  const t1 = performance.now()
  const windows = []
  for (const w of Window.all()) {
    const info = readWindowInfo(w)
    if (info) windows.push(info)
  }
  parentPort.postMessage({ ok: true, windows, startedAt, loadMs, enumMs: performance.now() - t1 })
} catch (error) {
  parentPort.postMessage({ ok: false, message: String((error && error.message) || error) })
}
`

/**
 * All windows, front-to-back, enumerated off the main thread.
 *
 * Degrades to an empty list rather than throwing: the only consumer is hover-to-snap,
 * which falls back to snapping to the whole display, and a capture session must not
 * fail because an optional convenience could not be computed.
 */
export function listWindowsOffThread(): Promise<RawWindowInfo[]> {
  let backendPath: string
  try {
    backendPath = nativeCaptureBackendPath()
  } catch (error) {
    logger.warn('Skipping snap targets: the native backend could not be resolved', error as Error)
    return Promise.resolve([])
  }

  return new Promise((resolve) => {
    const t0 = performance.now()
    const t0Wall = Date.now()
    try {
      const worker = new Worker(enumeratorSource, { eval: true, workerData: { backendPath } })
      const spawnMs = performance.now() - t0
      // A capture session is short-lived and this result is optional; it must never
      // be the reason the app stays alive on quit.
      worker.unref()

      worker.on(
        'message',
        (
          message:
            | { ok: true; windows: RawWindowInfo[]; startedAt: number; loadMs: number; enumMs: number }
            | { ok: false; message: string }
        ) => {
          if (message.ok) {
            if (DIAGNOSTICS_ENABLED) {
              // Splits the wall clock five ways, so a slow run names its own cause:
              // `boot` = spawning the thread, `load` = the native binding, `enum` =
              // the OS queries, `dispatch` = the main thread getting round to the
              // reply. A large `dispatch` is a scheduling problem, not a native one.
              const total = performance.now() - t0
              const bootMs = message.startedAt - t0Wall
              logger.info(
                `[Diagnostics/screenshot] enumerator total=${total.toFixed(0)}ms ` +
                  `spawn=${spawnMs.toFixed(0)}ms boot=${bootMs.toFixed(0)}ms ` +
                  `load=${message.loadMs.toFixed(0)}ms enum=${message.enumMs.toFixed(0)}ms ` +
                  `dispatch=${(total - bootMs - message.loadMs - message.enumMs).toFixed(0)}ms`
              )
            }
            resolve(message.windows)
          } else {
            logger.warn('Skipping snap targets: the enumerator worker failed', new Error(message.message))
            resolve([])
          }
          void worker.terminate()
        }
      )
      worker.on('error', (error) => {
        logger.warn('Skipping snap targets: the enumerator worker errored', error)
        resolve([])
      })
      // Covers a worker that dies without reporting — otherwise the caller waits forever.
      // Fires after a successful `message` too, where resolving again is a no-op.
      worker.on('exit', () => resolve([]))
    } catch (error) {
      logger.warn('Skipping snap targets: the enumerator worker could not be spawned', error as Error)
      resolve([])
    }
  })
}
