/**
 * The macOS screen-recording (TCC) permission gate.
 *
 * Lives outside `services/screenshot` on purpose: this asks the OS about the whole
 * process, not about the capture feature, and any future screen consumer needs the
 * same answers. Keeping it here also lets `ipc/handlers/system.ts` answer a permission
 * query without importing the screenshot barrel, which would pull the overlay service,
 * OCR and media-protocol modules into every app launch.
 */

import { loggerService } from '@logger'
import { isMac } from '@main/core/platform'
import { shell, systemPreferences } from 'electron'

const logger = loggerService.withContext('screenCapturePermission')

export type ScreenCapturePermissionStatus = 'authorized' | 'not-determined' | 'denied' | 'restricted'

/** macOS System Settings pane for screen recording. */
const SCREEN_CAPTURE_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'

/**
 * Read the screen-recording permission without prompting.
 *
 * Electron's status is the source of truth here because it is the only one that
 * distinguishes 'not-determined' — the native `CGPreflightScreenCaptureAccess`
 * used by the request side is a bool and cannot express it.
 *
 * 'restricted' identifies a policy restriction that a permission prompt cannot fix.
 */
export function getScreenCapturePermissionStatus(): ScreenCapturePermissionStatus {
  if (!isMac) return 'authorized'
  const status = systemPreferences.getMediaAccessStatus('screen')
  if (status === 'granted') return 'authorized'
  if (status === 'not-determined') return 'not-determined'
  if (status === 'restricted') return 'restricted'
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
