import { loggerService } from '@logger'
import { getScreenCapturePermissionStatus } from '@main/utils/screenCapturePermission'
import type { Monitor } from 'node-screenshots'

import { loadNativeCaptureBackend } from './nativeCaptureBackend'
import {
  type CaptureResult,
  type MonitorInfo,
  type RawWindowInfo,
  ScreenCaptureError,
  ScreenCapturePermissionError
} from './types'

const logger = loggerService.withContext('screenCapture')

/** All connected displays. */
export function listMonitors(): MonitorInfo[] {
  return getMonitorsOrThrow().map((m) => ({
    id: m.id(),
    name: m.name(),
    x: m.x(),
    y: m.y(),
    width: m.width(),
    height: m.height(),
    scaleFactor: m.scaleFactor(),
    isPrimary: m.isPrimary()
  }))
}

/**
 * All windows, front-to-back.
 *
 * Every property accessor re-queries the OS window list, so an individual
 * window can fail if it closes between enumeration and the property read.
 * Such a window is skipped rather than failing the whole enumeration —
 * transient windows (menus, tooltips) close constantly, and aborting on one
 * would make hit-test list construction fail at random.
 */
export function listWindows(): RawWindowInfo[] {
  const result: RawWindowInfo[] = []
  for (const w of loadNativeCaptureBackend().Window.all()) {
    try {
      result.push({
        pid: w.pid(),
        title: w.title(),
        appName: w.appName(),
        x: w.x(),
        y: w.y(),
        width: w.width(),
        height: w.height(),
        isMinimized: w.isMinimized()
      })
    } catch {
      // Expected when a window closes mid-enumeration.
    }
  }
  return result
}

/**
 * Capture every display, keyed by display id.
 *
 * Asynchronous and concurrent for two reasons: macOS can raise its screen-recording
 * prompt from inside the native call, and a blocked main process cannot even close
 * the overlay it is about to open; and a serial loop encoded one display's PNG before
 * the next was sampled, so the frozen frames came from visibly different instants.
 */
export async function captureAllMonitors(): Promise<Map<number, CaptureResult>> {
  const entries = await Promise.all(
    getMonitorsOrThrow().map(async (monitor): Promise<[number, CaptureResult]> => {
      try {
        const image = await monitor.captureImage()
        return [
          monitor.id(),
          {
            // Encodes on the libuv pool; the sync variant puts 150-400ms per 4K display
            // back on the thread this function exists to keep free.
            // copyOutputData: passing false hands back a view of Rust-owned memory,
            // which crashes Electron (napi-rs/napi-rs#1346).
            buffer: await image.toPng(true),
            width: image.width,
            height: image.height
          }
        ]
      } catch (error) {
        // Not a permission problem — the list was non-empty, so access was granted; blaming
        // permission would send the user to System Settings to fix an encoder fault.
        logger.error(`Failed to capture monitor ${monitor.id()}`, error as Error)
        throw new ScreenCaptureError(`Failed to capture display ${monitor.id()}`, { cause: error })
      }
    })
  )
  return new Map(entries)
}

/**
 * List displays, classifying failure by the actual permission state.
 *
 * On macOS an empty list is the shape a withheld permission takes, but only
 * when the OS also reports non-authorized — an empty list while authorized is
 * a real fault and must not be mislabeled.
 */
function getMonitorsOrThrow(): Monitor[] {
  let monitors: Monitor[]
  try {
    monitors = loadNativeCaptureBackend().Monitor.all()
  } catch (error) {
    // A backend that failed to load already threw ScreenCaptureError from
    // loadNativeCaptureBackend(); rethrow it untouched rather than relabeling it.
    if (error instanceof ScreenCaptureError) throw error
    if (getScreenCapturePermissionStatus() !== 'authorized') throw new ScreenCapturePermissionError()
    logger.error('Failed to list monitors', error as Error)
    throw new ScreenCaptureError('Failed to enumerate displays', { cause: error })
  }

  if (monitors.length === 0) {
    if (getScreenCapturePermissionStatus() !== 'authorized') throw new ScreenCapturePermissionError()
    throw new ScreenCaptureError('No displays reported while screen capture is authorized')
  }

  return monitors
}
