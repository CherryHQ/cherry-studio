import { loggerService } from '@logger'
import { isMac } from '@main/core/platform'
import { shell, systemPreferences } from 'electron'
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

export type ScreenCapturePermissionStatus = 'authorized' | 'not-determined' | 'denied'

/** macOS System Settings pane for screen recording. */
const SCREEN_CAPTURE_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

/**
 * Read the screen-recording permission without prompting.
 *
 * Electron's status is the source of truth here because it is the only one that
 * distinguishes 'not-determined' — the native `CGPreflightScreenCaptureAccess`
 * used by the request side is a bool and cannot express it.
 *
 * 'restricted' (MDM policy) folds into 'denied': the user cannot grant it, so
 * every caller must treat it exactly like a refusal.
 */
export function getScreenCapturePermissionStatus(): ScreenCapturePermissionStatus {
  if (!isMac) return 'authorized'
  const status = systemPreferences.getMediaAccessStatus('screen')
  if (status === 'granted') return 'authorized'
  if (status === 'not-determined') return 'not-determined'
  return 'denied'
}

/**
 * Trigger the macOS screen-recording prompt, then report the resulting state.
 *
 * Only the first call can prompt: once the user has answered, the OS never asks
 * again and the caller must guide them into System Settings instead. Returning
 * the re-read status is what lets the settings UI tell those cases apart, and it
 * is what makes repeat calls harmless.
 *
 * The native module is loaded dynamically and only on macOS — it declares
 * `os: ["darwin"]`, so on other platforms it is not installed at all. Its types
 * come from the ambient declaration next to this file, so this type-checks on
 * Linux CI where the package is absent.
 */
export async function requestScreenCapturePermission(): Promise<ScreenCapturePermissionStatus> {
  if (!isMac) return 'authorized'

  try {
    const { askForScreenCaptureAccess } = await import('node-mac-permissions')
    askForScreenCaptureAccess(false)
  } catch (error) {
    // Not installed (non-darwin) or failed to load — the caller still gets a
    // truthful status below and falls back to the System Settings deep link.
    logger.warn('Screen capture permission module unavailable', error as Error)
  }

  // Re-read rather than trusting the call: the prompt is async from the app's
  // point of view, and a second call never prompts at all.
  return getScreenCapturePermissionStatus()
}

/**
 * Open the Screen Recording pane in System Settings.
 *
 * Goes straight to `shell.openExternal` rather than through
 * `system.shell.open_website`: that route screens URLs against
 * `ALLOWED_EXTERNAL_PROTOCOLS` (http/https/mailto plus a few editor schemes) and
 * would silently drop this one. The scheme is a fixed constant here — no
 * renderer input reaches it — so widening the general allowlist for it would
 * trade a real security boundary for a single button.
 */
export function openScreenCaptureSettings(): void {
  if (!isMac) return
  void shell.openExternal(SCREEN_CAPTURE_SETTINGS_URL)
}

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
            // copyOutputData: passing false hands back a view of Rust-owned memory,
            // which crashes Electron (napi-rs/napi-rs#1346).
            buffer: image.toPngSync(true),
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
